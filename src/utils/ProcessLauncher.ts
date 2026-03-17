import { execFile } from 'node:child_process';

import { getDockerConfig, type DockerConfigEntry } from '../config/AgentConfig';
import {
  buildSpawnCommandSpec,
  shellEscape,
  type SpawnCommandSpec,
} from './ShellSpawn';

export interface LaunchRequest {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface ProcessLaunchSpec extends SpawnCommandSpec {
  cwd?: string;
  env: NodeJS.ProcessEnv;
  mode: 'host' | 'docker';
}

interface BuildProcessLaunchSpecOptions {
  docker?: DockerConfigEntry;
  hostEnv?: NodeJS.ProcessEnv;
  onUnsupportedShell?: (userShell: string) => void;
  pathExists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
  useHostCwd?: boolean;
  userShell?: string;
}

interface ValidateDockerRuntimeOptions {
  docker?: DockerConfigEntry;
  execRunner?: ExecRunner;
  platform?: NodeJS.Platform;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecRunner = (file: string, args: readonly string[]) => Promise<ExecResult>;
export type ProcessLauncherConfigProvider = () => { docker: DockerConfigEntry };

const WINDOWS_DOCKER_ERROR = 'ACP Docker mode is not supported on Windows.';
const MISSING_CONTAINER_ERROR =
  'ACP Docker mode is enabled but no container name or ID is configured.';

export function buildProcessLaunchSpec(
  request: LaunchRequest,
  options: BuildProcessLaunchSpecOptions = {},
): ProcessLaunchSpec {
  const {
    docker = { enabled: false, container: '' },
    hostEnv = process.env,
    onUnsupportedShell,
    pathExists,
    platform = process.platform,
    useHostCwd = false,
    userShell,
  } = options;

  if (docker.enabled) {
    if (platform === 'win32') {
      throw new Error(WINDOWS_DOCKER_ERROR);
    }

    const container = docker.container.trim();
    if (!container) {
      throw new Error(MISSING_CONTAINER_ERROR);
    }

    const dockerArgs = ['exec', '-i'];
    if (request.cwd) {
      dockerArgs.push('-w', request.cwd);
    }

    for (const [key, value] of Object.entries(request.env || {})) {
      dockerArgs.push('-e', `${key}=${value}`);
    }

    const commandStr = [request.command, ...(request.args || [])]
      .map(shellEscape)
      .join(' ');

    dockerArgs.push(container, '/bin/sh', '-lc', commandStr);

    return {
      file: 'docker',
      args: dockerArgs,
      env: { ...hostEnv },
      mode: 'docker',
    };
  }

  const spawnSpec = buildSpawnCommandSpec(request.command, request.args || [], {
    onUnsupportedShell,
    pathExists,
    platform,
    userShell,
  });

  return {
    ...spawnSpec,
    cwd: useHostCwd ? request.cwd || undefined : undefined,
    env: { ...hostEnv, ...(request.env || {}) },
    mode: 'host',
  };
}

export async function validateDockerRuntime(
  cwd: string,
  options: ValidateDockerRuntimeOptions = {},
): Promise<void> {
  const {
    docker = { enabled: false, container: '' },
    execRunner = runExecFile,
    platform = process.platform,
  } = options;

  if (!docker.enabled) {
    return;
  }

  if (platform === 'win32') {
    throw new Error(WINDOWS_DOCKER_ERROR);
  }

  const container = docker.container.trim();
  if (!container) {
    throw new Error(MISSING_CONTAINER_ERROR);
  }

  try {
    await execRunner('docker', ['version', '--format', '{{.Client.Version}}']);
  } catch {
    throw new Error(
      'Docker CLI is not available on PATH or is not responding.',
    );
  }

  let inspectResult: ExecResult;
  try {
    inspectResult = await execRunner('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      container,
    ]);
  } catch {
    throw new Error(`Docker container "${container}" is not running or does not exist.`);
  }

  if (inspectResult.stdout.trim() !== 'true') {
    throw new Error(`Docker container "${container}" is not running.`);
  }

  try {
    await execRunner('docker', ['exec', container, 'test', '-d', cwd]);
  } catch {
    throw new Error(
      `Working directory "${cwd}" is not available inside Docker container "${container}". ` +
      'Mount the workspace at the same absolute path, or update acp.defaultWorkingDirectory.',
    );
  }
}

export class ProcessLauncher {
  constructor(
    private readonly configProvider: ProcessLauncherConfigProvider = () => ({
      docker: getDockerConfig(),
    }),
    private readonly execRunner: ExecRunner = runExecFile,
  ) {}

  buildSpawnSpec(
    request: LaunchRequest,
    options: Omit<BuildProcessLaunchSpecOptions, 'docker'> = {},
  ): ProcessLaunchSpec {
    return buildProcessLaunchSpec(request, {
      ...options,
      docker: this.configProvider().docker,
    });
  }

  async validateDockerRuntime(cwd: string): Promise<void> {
    await validateDockerRuntime(cwd, {
      docker: this.configProvider().docker,
      execRunner: this.execRunner,
    });
  }
}

async function runExecFile(file: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}
