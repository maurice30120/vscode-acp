import assert from 'node:assert/strict';
import test from 'node:test';

import type { PipelineDefinition } from '@acp-client/pipeline';

import type { CliPipelineHostLike, CliPipelineSnapshot } from '../src/host.js';
import { runPipelineInteractive } from '../src/run.js';
import type { CliTerminal } from '../src/terminal.js';

const QUESTION_PLAN = `<proposed_plan>
<interview_state>question</interview_state>
<clarification_question>Which executable name should be exposed?</clarification_question>
</proposed_plan>`;
const READY_PLAN = `<proposed_plan>
<interview_state>ready</interview_state>
<objective>Add the CLI.</objective>
</proposed_plan>`;

class FakeHost implements CliPipelineHostLike {
  readonly calls: string[] = [];

  listPipelines(): PipelineDefinition[] {
    return [];
  }

  async start(): Promise<CliPipelineSnapshot> {
    this.calls.push('start');
    return { sessionId: 'session-1', plan: QUESTION_PLAN, awaitingApproval: true };
  }

  async answer(answer: string): Promise<CliPipelineSnapshot> {
    this.calls.push(`answer:${answer}`);
    return { sessionId: 'session-1', plan: READY_PLAN, awaitingApproval: true };
  }

  async approve(): Promise<string> {
    this.calls.push('approve');
    return 'done';
  }

  reject(): void {
    this.calls.push('reject');
  }

  async dispose(): Promise<void> {}
}

class FakeTerminal implements CliTerminal {
  readonly interactive = true;
  readonly output: string[] = [];
  readonly errors: string[] = [];
  readonly questions: string[] = [];
  readonly confirmations: string[] = [];
  answers = ['acp-pipeline'];
  approvals = [true];

  write(message: string): void {
    this.output.push(message);
  }

  writeError(message: string): void {
    this.errors.push(message);
  }

  async ask(question: string): Promise<string> {
    this.questions.push(question);
    return this.answers.shift() ?? '';
  }

  async confirm(question: string): Promise<boolean> {
    this.confirmations.push(question);
    return this.approvals.shift() ?? false;
  }

  async select(_title: string, options: string[]): Promise<string | undefined> {
    return options[0];
  }

  close(): void {}
}

test('runs grill-me one question at a time before approval', async () => {
  const host = new FakeHost();
  const terminal = new FakeTerminal();

  const result = await runPipelineInteractive(host, terminal, {
    pipelineName: 'grill-skeleton-tdd',
    prompt: 'Add a CLI',
    yes: false,
    json: false,
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(host.calls, ['start', 'answer:acp-pipeline', 'approve']);
  assert.deepEqual(terminal.questions, ['Which executable name should be exposed?']);
  assert.equal(terminal.confirmations.length, 1);
  assert.equal(terminal.output.at(-1), 'done');
});

test('rejects a ready plan without running implementation', async () => {
  const host = new FakeHost();
  host.start = async () => ({ sessionId: 'session-1', plan: READY_PLAN, awaitingApproval: true });
  const terminal = new FakeTerminal();
  terminal.approvals = [false];

  const result = await runPipelineInteractive(host, terminal, {
    pipelineName: 'grill-skeleton-tdd',
    prompt: 'Add a CLI',
    yes: false,
    json: false,
  });

  assert.equal(result.status, 'rejected');
  assert.deepEqual(host.calls, ['reject']);
});

test('--yes bypasses only the final plan confirmation', async () => {
  const host = new FakeHost();
  const terminal = new FakeTerminal();

  const result = await runPipelineInteractive(host, terminal, {
    pipelineName: 'grill-skeleton-tdd',
    prompt: 'Add a CLI',
    yes: true,
    json: false,
  });

  assert.equal(result.status, 'completed');
  assert.equal(terminal.questions.length, 1);
  assert.equal(terminal.confirmations.length, 0);
  assert.deepEqual(host.calls, ['start', 'answer:acp-pipeline', 'approve']);
});
