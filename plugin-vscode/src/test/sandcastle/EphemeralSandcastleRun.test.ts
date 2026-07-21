import * as assert from 'assert';

import type { EphemeralRunResult } from '../../core/EphemeralRun';
import { finishEphemeralSandcastleRun } from '../../sandcastle/EphemeralSandcastleRun';
import { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';

suite('EphemeralSandcastleRun', () => {
  test('finishEphemeralSandcastleRun returns text only when run has no sandbox', async () => {
    const run: EphemeralRunResult = { text: 'hello' };
    const promotion = new SandcastlePromotion({} as any);

    const result = await finishEphemeralSandcastleRun(promotion, run);

    assert.deepStrictEqual(result, { text: 'hello' });
  });

  test('finishEphemeralSandcastleRun delegates to SandcastlePromotion.finishEphemeralRun', async () => {
    const calls: string[] = [];
    const promotion = new SandcastlePromotion({} as any, {
      discard: async () => {
        calls.push('discard');
      },
    } as any);
    const run: EphemeralRunResult = {
      text: 'done',
      sandbox: {
        connection: { extMethod: async () => ({}) },
        sessionId: 'sandbox-1',
        closeAgentSession: async () => {
          calls.push('close-agent-session');
        },
        dispose: () => {
          calls.push('dispose');
        },
      },
    };

    const result = await finishEphemeralSandcastleRun(promotion, run, { sideEffects: 'none' });

    assert.deepStrictEqual(result, { text: 'done', promotion: undefined });
    assert.deepStrictEqual(calls, ['close-agent-session', 'discard']);
  });

  test('runEphemeralSandcastleAgent disposes sandbox after promotion', async () => {
    const order: string[] = [];
    const promotion = new SandcastlePromotion({} as any, {
      discard: async () => {
        order.push('promotion');
      },
    } as any);
    const run: EphemeralRunResult = {
      text: 'done',
      sandbox: {
        connection: { extMethod: async () => ({}) },
        sessionId: 'sandbox-1',
        closeAgentSession: async () => {
          order.push('close-agent-session');
        },
        dispose: () => {
          order.push('dispose');
        },
      },
    };

    try {
      await finishEphemeralSandcastleRun(promotion, run, { sideEffects: 'none' });
    } finally {
      run.sandbox?.dispose();
    }

    assert.deepStrictEqual(order, ['close-agent-session', 'promotion', 'dispose']);
  });

  test('finishEphemeralSandcastleRun does not promote when closing the agent session fails', async () => {
    const calls: string[] = [];
    const promotion = new SandcastlePromotion({} as any, {
      discard: async () => {
        calls.push('promotion');
      },
    } as any);
    const run: EphemeralRunResult = {
      text: 'done',
      sandbox: {
        connection: { extMethod: async () => ({}) },
        sessionId: 'sandbox-1',
        closeAgentSession: async () => {
          calls.push('close-agent-session');
          throw new Error('close failed');
        },
        dispose: () => {
          calls.push('dispose');
        },
      },
    };

    await assert.rejects(
      () => finishEphemeralSandcastleRun(promotion, run, { sideEffects: 'none' }),
      /close failed/,
    );
    assert.deepStrictEqual(calls, ['close-agent-session']);
  });
});
