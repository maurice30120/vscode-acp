import * as assert from 'assert';

import type { SessionNotification } from '@agentclientprotocol/sdk';

import {
  TeamReviewerRerun,
  type PipelineDefinition,
  type PipelineExecutor,
  type TeamRunSnapshot,
} from '@acp-client/pipeline';

suite('TeamReviewerRerun', () => {
  const snapshot: TeamRunSnapshot = {
    sessionId: 'session-1',
    teamId: 'feature-team',
    teamTitle: 'Feature Team',
    approvedPlan: '<proposed_plan>plan</proposed_plan>',
    implementOutput: 'implemented',
    completedAt: new Date().toISOString(),
  };

  const teamPipeline: PipelineDefinition = {
    version: 2,
    id: 'team-feature-team',
    title: 'Feature Team',
    primitives: {},
    steps: [],
    metadata: {
      sourceKind: 'team',
      sourceFilePath: '.acp/teams/feature-team.yaml',
      teamId: 'feature-team',
      roleByStepId: { reviewer: 'reviewer' },
      agentByRole: {
        planner: 'Cursor CLI',
        implementer: 'Cursor Sandcastle',
        reviewer: 'Cursor CLI',
        tester: 'Vibe',
      },
      instructionsByRole: {
        reviewer: 'Review the implementation.',
      },
    },
  };

  function createExecutor(
    runAgent: PipelineExecutor['runAgent'],
  ): PipelineExecutor {
    return { runAgent } as PipelineExecutor;
  }

  test('rerun invokes executor and emits reviewer-rerun session updates', async () => {
    const emitted: Array<{ phase: string; sessionId: string }> = [];
    const executor = createExecutor(async (_agentName, _prompt, options = {}) => {
      options.onSessionUpdate?.({
        sessionId: snapshot.sessionId,
        update: { sessionUpdate: 'agent_message_chunk' },
      } as SessionNotification);
      return 'review ok';
    });

    const rerun = new TeamReviewerRerun({
      getTeamPipelineForAgent: () => teamPipeline,
      readWorkspaceDiff: async () => 'diff --git a/foo.ts',
      executor,
      emitSessionUpdate: event => {
        emitted.push({ phase: event.phase, sessionId: event.sessionId });
      },
    });

    const output = await rerun.rerun(snapshot, 'Feature Team');
    assert.strictEqual(output, 'review ok');
    assert.ok(emitted.length > 0);
    assert.strictEqual(emitted[0]?.phase, 'reviewer-rerun');
    assert.strictEqual(emitted[0]?.sessionId, 'session-1');
  });

  test('cancel aborts in-flight rerun', async () => {
    let started = false;
    const executor = createExecutor(async (_agentName, _prompt, options = {}) => {
      started = true;
      return new Promise((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) {
          reject(new Error('expected abort signal'));
          return;
        }
        const onAbort = () => reject(signal.reason ?? new Error('aborted'));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });

    const rerun = new TeamReviewerRerun({
      getTeamPipelineForAgent: () => teamPipeline,
      readWorkspaceDiff: async () => '',
      executor,
      emitSessionUpdate: () => {},
    });

    const promise = rerun.rerun(snapshot, 'Feature Team');
    while (!started) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    rerun.cancel();
    await assert.rejects(() => promise);
  });

  test('missing team metadata throws', async () => {
    const rerun = new TeamReviewerRerun({
      getTeamPipelineForAgent: () => null,
      executor: createExecutor(async () => 'unused'),
      emitSessionUpdate: () => {},
    });

    await assert.rejects(
      () => rerun.rerun(snapshot, 'Unknown Team'),
      /not available/i,
    );
  });
});
