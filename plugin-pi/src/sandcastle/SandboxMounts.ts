import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { BridgeConfig } from './BridgeConfig.js';

export function prepareCodexHome(repoDir: string): string {
  const codexHome = join(repoDir, '.sandcastle', 'codex-home');
  mkdirSync(codexHome, { recursive: true });
  const hostAuth = join(homedir(), '.codex', 'auth.json');
  const sandboxAuth = join(codexHome, 'auth.json');
  if (existsSync(hostAuth) && !existsSync(sandboxAuth)) {
    copyFileSync(hostAuth, sandboxAuth);
  }
  return codexHome;
}

export function prepareVibeHome(repoDir: string): string {
  const vibeHome = join(repoDir, '.sandcastle', 'vibe-home');
  mkdirSync(vibeHome, { recursive: true });
  const hostEnv = join(homedir(), '.vibe', '.env');
  const sandboxEnv = join(vibeHome, '.env');
  if (existsSync(hostEnv)) {
    copyFileSync(hostEnv, sandboxEnv);
  }
  return vibeHome;
}

export function codexAuthMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  return [{
    hostPath: prepareCodexHome(repoDir),
    sandboxPath: '/home/agent/.codex',
    readonly: false,
  }];
}

export function vibeAuthMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  return [{
    hostPath: prepareVibeHome(repoDir),
    sandboxPath: '/home/agent/.vibe',
    readonly: false,
  }];
}

export function agentsSkillsMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  const agentsDir = join(repoDir, '.agents');
  if (!existsSync(agentsDir)) {
    return [];
  }

  return [{
    hostPath: agentsDir,
    sandboxPath: '.agents',
    readonly: false,
  }];
}

export function gitWorktreeMounts(repoDir: string, branch: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  const gitDir = resolveGitCommonDir(repoDir);
  if (!gitDir) {
    return [];
  }

  const worktreeName = branch.replace(/\//g, '-');
  const overrideDir = join(repoDir, '.sandcastle', 'git-overrides');
  mkdirSync(overrideDir, { recursive: true });
  const overrideFile = join(overrideDir, `${worktreeName}.git`);
  writeFileSync(overrideFile, `gitdir: /.sandcastle-parent-git/worktrees/${worktreeName}\n`, 'utf8');

  return [
    {
      hostPath: gitDir,
      sandboxPath: '/.sandcastle-parent-git',
      readonly: false,
    },
    {
      hostPath: overrideFile,
      sandboxPath: '/home/agent/workspace/.git',
      readonly: true,
    },
  ];
}

function resolveGitCommonDir(repoDir: string): string | undefined {
  try {
    return execFileSync('git', ['-C', repoDir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    const fallback = join(repoDir, '.git');
    return existsSync(fallback) ? fallback : undefined;
  }
}

export function buildSandboxMounts(
  config: BridgeConfig,
  cwd: string,
  branch?: string,
): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  const mounts = [...agentsSkillsMounts(cwd)];
  if (branch) {
    mounts.push(...gitWorktreeMounts(cwd, branch));
  }
  if (config.provider === 'codex') {
    mounts.push(...codexAuthMounts(cwd));
  }
  if (config.provider === 'vibe') {
    mounts.push(...vibeAuthMounts(cwd));
  }
  return mounts;
}
