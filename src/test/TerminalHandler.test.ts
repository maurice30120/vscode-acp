import * as assert from 'assert';
import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';

import { TerminalHandler } from '../handlers/TerminalHandler';
import type { ProcessLauncher } from '../utils/ProcessLauncher';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(_signal?: NodeJS.Signals): boolean {
    return true;
  }
}

suite('TerminalHandler', () => {
  const originalCreateTerminal = vscode.window.createTerminal;

  teardown(() => {
    (vscode.window as any).createTerminal = originalCreateTerminal;
  });

  test('records spawn errors in terminal output and exit status', async () => {
    const fakeChild = new FakeChildProcess();
    (vscode.window as any).createTerminal = () => ({
      dispose() { /* no-op */ },
    }) as vscode.Terminal;

    const launcher = {
      buildSpawnSpec: () => ({
        file: 'missing-command',
        args: ['--flag'],
        env: process.env,
        mode: 'host',
      }),
    } as unknown as ProcessLauncher;

    const handler = new TerminalHandler(launcher, () => fakeChild as any);
    const { terminalId } = await handler.createTerminal({
      sessionId: 'session-1',
      command: 'missing-command',
      args: ['--flag'],
    } as any);

    fakeChild.emit('error', new Error('spawn ENOENT'));

    const exitStatus = await handler.waitForTerminalExit({
      sessionId: 'session-1',
      terminalId,
    } as any);
    const output = await handler.terminalOutput({
      sessionId: 'session-1',
      terminalId,
    } as any);

    assert.deepStrictEqual(exitStatus, {
      exitCode: 1,
      signal: null,
    });
    assert.deepStrictEqual(output.exitStatus, {
      exitCode: 1,
      signal: null,
    });
    assert.match(output.output, /Failed to start command "missing-command": spawn ENOENT/);
    assert.strictEqual(output.truncated, false);
  });
});
