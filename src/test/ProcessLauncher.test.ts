import * as assert from 'assert';

import {
  buildProcessLaunchSpec,
  validateDockerRuntime,
  type ExecRunner,
} from '../utils/ProcessLauncher';

suite('ProcessLauncher', () => {
  test('keeps host launching behavior unchanged when Docker is disabled', () => {
    const spec = buildProcessLaunchSpec({
      command: 'npx',
      args: ['@scope/tool', '--acp'],
      env: { FOO: 'bar' },
      cwd: '/workspace/app',
    }, {
      docker: { enabled: false, container: '' },
      hostEnv: { PATH: '/usr/bin' },
      platform: 'darwin',
      userShell: '/bin/zsh',
    });

    assert.strictEqual(spec.mode, 'host');
    assert.strictEqual(spec.file, '/bin/zsh');
    assert.deepStrictEqual(spec.args, ['-l', '-c', "'npx' '@scope/tool' '--acp'"]);
    assert.strictEqual(spec.cwd, undefined);
    assert.strictEqual(spec.env.PATH, '/usr/bin');
    assert.strictEqual(spec.env.FOO, 'bar');
  });

  test('preserves host cwd for terminal launches in host mode', () => {
    const spec = buildProcessLaunchSpec({
      command: 'npm',
      args: ['test'],
      cwd: '/workspace/app',
    }, {
      docker: { enabled: false, container: '' },
      platform: 'darwin',
      useHostCwd: true,
      userShell: '/bin/zsh',
    });

    assert.strictEqual(spec.mode, 'host');
    assert.strictEqual(spec.cwd, '/workspace/app');
  });

  test('wraps launches in docker exec when Docker mode is enabled', () => {
    const spec = buildProcessLaunchSpec({
      command: 'npx',
      args: ['@scope/tool', '--acp'],
      env: { FOO: 'bar' },
      cwd: '/workspace/app',
    }, {
      docker: { enabled: true, container: 'acp-dev' },
      hostEnv: { PATH: '/usr/bin' },
      platform: 'darwin',
    });

    assert.strictEqual(spec.mode, 'docker');
    assert.strictEqual(spec.file, 'docker');
    assert.deepStrictEqual(spec.args, [
      'exec',
      '-i',
      '-w',
      '/workspace/app',
      '-e',
      'FOO=bar',
      'acp-dev',
      '/bin/sh',
      '-lc',
      "'npx' '@scope/tool' '--acp'",
    ]);
    assert.strictEqual(spec.env.PATH, '/usr/bin');
    assert.strictEqual(spec.env.FOO, undefined);
    assert.strictEqual(spec.cwd, undefined);
  });

  test('rejects Docker mode on Windows', () => {
    assert.throws(
      () => buildProcessLaunchSpec({
        command: 'npx',
      }, {
        docker: { enabled: true, container: 'acp-dev' },
        platform: 'win32',
      }),
      /not supported on Windows/i,
    );
  });

  test('validates Docker runtime prerequisites in order', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const execRunner: ExecRunner = async (file, args) => {
      calls.push({ file, args });
      if (args[0] === 'inspect') {
        return { stdout: 'true\n', stderr: '' };
      }

      return { stdout: '', stderr: '' };
    };

    await validateDockerRuntime('/workspace/app', {
      docker: { enabled: true, container: 'acp-dev' },
      execRunner,
      platform: 'darwin',
    });

    assert.deepStrictEqual(calls, [
      {
        file: 'docker',
        args: ['version', '--format', '{{.Client.Version}}'],
      },
      {
        file: 'docker',
        args: ['inspect', '-f', '{{.State.Running}}', 'acp-dev'],
      },
      {
        file: 'docker',
        args: ['exec', 'acp-dev', 'test', '-d', '/workspace/app'],
      },
    ]);
  });

  test('fails when the Docker CLI is unavailable', async () => {
    const execRunner: ExecRunner = async () => {
      throw new Error('spawn ENOENT');
    };

    await assert.rejects(
      validateDockerRuntime('/workspace/app', {
        docker: { enabled: true, container: 'acp-dev' },
        execRunner,
        platform: 'darwin',
      }),
      /Docker CLI is not available/i,
    );
  });

  test('fails when the container is missing or stopped', async () => {
    const execRunner: ExecRunner = async (_file, args) => {
      if (args[0] === 'inspect') {
        throw new Error('No such container');
      }

      return { stdout: '', stderr: '' };
    };

    await assert.rejects(
      validateDockerRuntime('/workspace/app', {
        docker: { enabled: true, container: 'acp-dev' },
        execRunner,
        platform: 'darwin',
      }),
      /not running or does not exist/i,
    );
  });

  test('fails when the working directory is not mounted in the container', async () => {
    const execRunner: ExecRunner = async (_file, args) => {
      if (args[0] === 'inspect') {
        return { stdout: 'true\n', stderr: '' };
      }
      if (args[0] === 'exec') {
        throw new Error('missing directory');
      }

      return { stdout: '', stderr: '' };
    };

    await assert.rejects(
      validateDockerRuntime('/workspace/app', {
        docker: { enabled: true, container: 'acp-dev' },
        execRunner,
        platform: 'darwin',
      }),
      /not available inside Docker container/i,
    );
  });

  test('fails validation on Windows when Docker mode is enabled', async () => {
    await assert.rejects(
      validateDockerRuntime('/workspace/app', {
        docker: { enabled: true, container: 'acp-dev' },
        platform: 'win32',
      }),
      /not supported on Windows/i,
    );
  });
});
