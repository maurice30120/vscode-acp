import assert from 'node:assert/strict';
import test from 'node:test';

import type { PipelineRuntimeResult } from '@acp-client/pipeline';
import type { PiPermissionContext } from '@acp-client/pi-extension/host';

import type { CliRunCommand } from '../src/args.js';
import { runPipelineInteractive } from '../src/run.js';
import type { CliTerminal } from '../src/terminal.js';

class FakeTerminal implements CliTerminal {
  readonly output: string[] = [];
  readonly errors: string[] = [];
  readonly answers: string[] = [];
  readonly confirmations: boolean[] = [];

  write(message: string): void { this.output.push(message); }
  writeError(message: string): void { this.errors.push(message); }
  async ask(): Promise<string> { return this.answers.shift() ?? ''; }
  async confirm(): Promise<boolean> { return this.confirmations.shift() ?? false; }
  async select(): Promise<string | undefined> { return undefined; }
  asPermissionContext(): PiPermissionContext { return {} as PiPermissionContext; }
  close(): void {}
}

function command(overrides: Partial<CliRunCommand> = {}): CliRunCommand {
  return {
    kind: 'run',
    pipelineName: 'grill',
    prompt: 'build it',
    cwd: '/repo',
    json: false,
    verbose: false,
    yes: false,
    ...overrides,
  };
}

function snapshot(status: 'paused' | 'completed' | 'cancelled' | 'failed') {
  return {
    runId: 'run-1',
    pipelineId: 'grill',
    status,
    nodeStates: {},
    artifacts: {},
    diagnostics: [],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

test('answers a v3 question then approves the next pause', async () => {
  const terminal = new FakeTerminal();
  terminal.answers.push('Use the public API');
  terminal.confirmations.push(true);
  const resumes: unknown[] = [];
  const results: PipelineRuntimeResult[] = [
    {
      status: 'paused', runId: 'run-1',
      pause: { id: 'q1', nodeId: 'question', type: 'question', content: 'Which API?', format: 'markdown' },
      snapshot: snapshot('paused'),
    },
    {
      status: 'paused', runId: 'run-1',
      pause: { id: 'a1', nodeId: 'approval', type: 'approval', content: 'Final plan', format: 'proposed-plan' },
      snapshot: snapshot('paused'),
    },
    {
      status: 'completed', runId: 'run-1',
      artifact: { name: 'result', type: 'text', format: 'markdown', value: 'done', producerNodeId: 'finish' },
      snapshot: snapshot('completed'),
    },
  ];
  const host = {
    start: async () => results.shift()!,
    resume: async (_runId: string, decision: unknown) => {
      resumes.push(decision);
      return results.shift()!;
    },
  };

  const result = await runPipelineInteractive(host, terminal, command());

  assert.equal(result.status, 'completed');
  assert.deepEqual(resumes, [
    { pauseId: 'q1', kind: 'answer', value: 'Use the public API' },
    { pauseId: 'a1', kind: 'approve', value: 'Final plan' },
  ]);
  assert.equal(terminal.output.at(-1), 'done');
});

test('--yes auto-approves approvals but never promotions', async () => {
  const terminal = new FakeTerminal();
  terminal.confirmations.push(false);
  const decisions: unknown[] = [];
  const results: PipelineRuntimeResult[] = [
    {
      status: 'paused', runId: 'run-1',
      pause: { id: 'a1', nodeId: 'approval', type: 'approval', content: 'Plan', format: 'proposed-plan' },
      snapshot: snapshot('paused'),
    },
    {
      status: 'paused', runId: 'run-1',
      pause: { id: 'p1', nodeId: 'promotion', type: 'promotion', content: 'Apply changes', format: 'markdown' },
      snapshot: snapshot('paused'),
    },
    { status: 'cancelled', runId: 'run-1', snapshot: snapshot('cancelled') },
  ];
  const host = {
    start: async () => results.shift()!,
    resume: async (_runId: string, decision: unknown) => {
      decisions.push(decision);
      return results.shift()!;
    },
  };

  const result = await runPipelineInteractive(host, terminal, command({ yes: true }));

  assert.equal(result.status, 'cancelled');
  assert.deepEqual(decisions, [
    { pauseId: 'a1', kind: 'approve', value: 'Plan' },
    { pauseId: 'p1', kind: 'reject' },
  ]);
});
