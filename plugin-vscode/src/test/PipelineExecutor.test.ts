import * as assert from 'assert';

import {
  PipelineExecutor,
  PipelineStepRejectedError,
  type PipelineAgentRunner,
  type PipelinePrimitiveDefinition,
} from '@acp-client/pipeline';

const primitive: PipelinePrimitiveDefinition = {
  agent: 'Vibe',
  prompt: 'do work',
  output: 'markdown',
  sideEffects: 'none',
};

suite('PipelineExecutor', () => {
  test('runStep delegates to runAcpAgent override when provided', async () => {
    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      runAcpAgent: async () => 'from-test-adapter',
    });

    const text = await executor.runStep('planner', primitive, 'prompt', {
      signal: new AbortController().signal,
    });
    assert.strictEqual(text, 'from-test-adapter');
  });

  test('runStep uses ephemeral runner when no override', async () => {
    let capturedAgent = '';
    const runAgent: PipelineAgentRunner = async input => {
      capturedAgent = input.agentName;
      return { text: 'runner-output' };
    };

    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      runAgent,
    });

    const text = await executor.runStep('planner', primitive, 'hello', {
      signal: new AbortController().signal,
    });
    assert.strictEqual(text, 'runner-output');
    assert.strictEqual(capturedAgent, 'Vibe');
  });

  test('runStep propagates Sandcastle rejection from runner result', async () => {
    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      runAgent: async () => ({ text: 'x', promotion: 'rejected' }),
    });

    await assert.rejects(
      () => executor.runStep('implementer', { ...primitive, sideEffects: 'workspace' }, 'go', {
        signal: new AbortController().signal,
        approvedPlan: 'plan',
      }),
      (error: unknown) => error instanceof PipelineStepRejectedError,
    );
  });

  test('runStep requires approved plan for workspace side effects', async () => {
    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      runAgent: async () => ({ text: 'x' }),
    });

    await assert.rejects(
      () => executor.runStep('implementer', { ...primitive, sideEffects: 'workspace' }, 'go', {
        signal: new AbortController().signal,
      }),
      /approved plan/i,
    );
  });
});
