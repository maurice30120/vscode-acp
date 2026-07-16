import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  handleEphemeralSessionUpdate,
  runEphemeralRun,
  type EphemeralRunCollectionState,
} from '../core/EphemeralRun';
import { isRunAbortedError, RunAbortedError } from '../core/RunAbortedError';

suite('RunAbortedError', () => {
  test('isRunAbortedError identifies RunAbortedError instances', () => {
    assert.strictEqual(isRunAbortedError(new RunAbortedError()), true);
    assert.strictEqual(isRunAbortedError(new Error('Run aborted.')), false);
  });
});

suite('EphemeralRun abort', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function() {
      return {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'agents') {
            return { Codex: { command: 'echo' } };
          }
          return defaultValue;
        },
      } as any;
    };
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('runEphemeralRun throws RunAbortedError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => runEphemeralRun({
        workspaceCwd: '/repo',
        agentName: 'Codex',
        promptText: 'hello',
        signal: controller.signal,
      }),
      (error: unknown) => isRunAbortedError(error),
    );
  });
});

suite('EphemeralRun session updates', () => {
  test('forwards sandcastle_status without collecting assistant text', () => {
    const state: EphemeralRunCollectionState = { collectedText: '' };
    const forwarded: any[] = [];

    handleEphemeralSessionUpdate(
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'sandcastle_status',
          status: 'running',
          provider: 'pi',
          elapsedMs: 1_000,
        } as any,
      },
      'session-1',
      state,
      update => forwarded.push(update),
    );
    handleEphemeralSessionUpdate(
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'provider text' },
        },
      } as any,
      'session-1',
      state,
      update => forwarded.push(update),
    );

    assert.strictEqual(state.collectedText, 'provider text');
    assert.deepStrictEqual(forwarded.map(update => update.update.sessionUpdate), [
      'sandcastle_status',
      'agent_message_chunk',
    ]);
  });

  test('ignores updates from another ephemeral session', () => {
    const state: EphemeralRunCollectionState = { collectedText: '' };
    const forwarded: any[] = [];

    handleEphemeralSessionUpdate(
      {
        sessionId: 'other-session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'ignored' },
        },
      } as any,
      'session-1',
      state,
      update => forwarded.push(update),
    );

    assert.strictEqual(state.collectedText, '');
    assert.deepStrictEqual(forwarded, []);
  });
});
