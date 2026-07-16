import * as assert from 'assert';
import * as os from 'node:os';
import * as vscode from 'vscode';

import { TerminalHandler } from '../../handlers/TerminalHandler';

suite('TerminalHandler', () => {
  let originalCreateTerminal: typeof vscode.window.createTerminal;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalCreateTerminal = vscode.window.createTerminal;
    originalGetConfiguration = vscode.workspace.getConfiguration;
  });

  teardown(() => {
    vscode.window.createTerminal = originalCreateTerminal;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('captures output without creating a VS Code terminal by default', async () => {
    let createTerminalCalls = 0;
    vscode.window.createTerminal = function(options: any) {
      createTerminalCalls += 1;
      return originalCreateTerminal(options);
    } as any;
    vscode.workspace.getConfiguration = function(_section?: string) {
      return {
        get: (_key: string, defaultValue: unknown) => defaultValue,
      } as any;
    };

    const handler = new TerminalHandler(os.tmpdir());
    const created = await handler.createTerminal({
      sessionId: 'session-1',
      command: 'printf terminal-output',
    });

    await handler.waitForTerminalExit({ sessionId: 'session-1', terminalId: created.terminalId });
    const output = await handler.terminalOutput({ sessionId: 'session-1', terminalId: created.terminalId });

    assert.strictEqual(createTerminalCalls, 0);
    assert.strictEqual(output.output, 'terminal-output');
    assert.deepStrictEqual(output.exitStatus, { exitCode: 0, signal: null });

    await handler.releaseTerminal({ sessionId: 'session-1', terminalId: created.terminalId });
  });

  test('creates and disposes a VS Code terminal when acp.terminal.visible is true', async () => {
    let createTerminalCalls = 0;
    let disposeCalls = 0;
    vscode.window.createTerminal = function() {
      createTerminalCalls += 1;
      return {
        dispose: () => {
          disposeCalls += 1;
        },
      } as any;
    } as any;
    vscode.workspace.getConfiguration = function(_section?: string) {
      return {
        get: (key: string, defaultValue: unknown) => key === 'terminal.visible' ? true : defaultValue,
      } as any;
    };

    const handler = new TerminalHandler(os.tmpdir());
    const created = await handler.createTerminal({
      sessionId: 'session-1',
      command: 'printf visible-output',
    });

    await handler.waitForTerminalExit({ sessionId: 'session-1', terminalId: created.terminalId });
    const output = await handler.terminalOutput({ sessionId: 'session-1', terminalId: created.terminalId });
    await handler.releaseTerminal({ sessionId: 'session-1', terminalId: created.terminalId });

    assert.strictEqual(createTerminalCalls, 1);
    assert.strictEqual(disposeCalls, 1);
    assert.strictEqual(output.output, 'visible-output');
  });

  test('releaseTerminal kills active process and disposes visible terminal', async () => {
    let disposeCalls = 0;
    vscode.window.createTerminal = function() {
      return {
        dispose: () => {
          disposeCalls += 1;
        },
      } as any;
    } as any;
    vscode.workspace.getConfiguration = function(_section?: string) {
      return {
        get: (key: string, defaultValue: unknown) => key === 'terminal.visible' ? true : defaultValue,
      } as any;
    };

    const handler = new TerminalHandler(os.tmpdir());
    const created = await handler.createTerminal({
      sessionId: 'session-1',
      command: 'sleep 10',
    });

    await handler.releaseTerminal({ sessionId: 'session-1', terminalId: created.terminalId });

    assert.strictEqual(disposeCalls, 1);
    await assert.rejects(
      () => handler.terminalOutput({ sessionId: 'session-1', terminalId: created.terminalId }),
      /Terminal not found/,
    );
  });
});
