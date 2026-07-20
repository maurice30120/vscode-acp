import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import type { PipelineAgentRunInput } from '@acp-client/pipeline';
import type { PiPermissionContext } from '@acp-client/pi-extension/host';

import { CliPipelineHost } from '../src/host.js';
import type { CliTerminal } from '../src/terminal.js';

class FakeTerminal implements CliTerminal {
  readonly errors: string[] = [];
  write(): void {}
  writeError(message: string): void { this.errors.push(message); }
  async ask(): Promise<string> { return ''; }
  async confirm(): Promise<boolean> { return false; }
  async select(): Promise<string | undefined> { return undefined; }
  asPermissionContext(): PiPermissionContext { return {} as PiPermissionContext; }
  close(): void {}
}

function createWorkspace(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-v3-'));
  fs.mkdirSync(path.join(cwd, '.acp', 'pipelines'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.acp', 'acp-agents.json'), JSON.stringify({
    agents: {
      Planner: {
        command: 'node',
        args: ['--version'],
        env: {},
        skills: true,
      },
    },
    pipeline: {
      enabled: true,
      instructionsMaxBytes: 262144,
    },
  }, null, 2));
  fs.writeFileSync(path.join(cwd, '.acp', 'pipelines', 'question.yaml'), `version: 3
id: question-flow
title: Question Flow
nodes:
  - id: plan
    agent: Planner
    skills:
      - grill-me
    prompt: "Plan {{userPrompt}}"
    output:
      name: plan
      type: acp.plan/v1
      format: markdown
  - id: question
    type: pause
    pause: question
    content: "{{inputs.plan}}"
    format: markdown
    needs:
      - plan
    inputs:
      - name: plan
        from: plan.plan
        type: acp.plan/v1
        format: markdown
    output:
      name: answer
      type: acp.answer/v1
      format: markdown
`);
  return cwd;
}

test('runs workspace-root v3 pipelines and forwards the node agent and skills', async () => {
  const cwd = createWorkspace();
  const calls: PipelineAgentRunInput[] = [];
  const host = new CliPipelineHost(cwd, {
    terminal: new FakeTerminal(),
    runIdFactory: () => 'run-test',
    runAgent: async input => {
      calls.push(input);
      return { text: 'Which public API should be used?' };
    },
  });

  const started = await host.start('question-flow', 'add a CLI');
  assert.equal(started.status, 'paused');
  assert.equal(started.status === 'paused' ? started.pause.type : '', 'question');
  assert.equal(calls[0]?.agentName, 'Planner');
  assert.deepEqual(calls[0]?.skills, ['grill-me']);

  if (started.status !== 'paused') {
    assert.fail('Expected a question pause.');
  }
  const completed = await host.resume(started.runId, {
    pauseId: started.pause.id,
    kind: 'answer',
    value: 'Use PipelineRuntime',
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.status === 'completed' ? completed.artifact?.value : '', 'Use PipelineRuntime');
});

test('does not provide a packaged fallback when workspace ACP config is missing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-empty-'));
  assert.throws(
    () => new CliPipelineHost(cwd, { terminal: new FakeTerminal(), runAgent: async () => '' }),
    /Missing Pi ACP config at workspace root/,
  );
});

test('loads the checked-in workspace configuration used by the CLI script', () => {
  const workspaceRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const host = new CliPipelineHost(workspaceRoot, {
    terminal: new FakeTerminal(),
    runAgent: async () => '',
  });

  assert.ok(
    host.listPipelines().some(pipeline => pipeline.id === 'grill-spec-tickets-implement-review'),
  );
});

test('verbose mode logs ACP error code and data with the failing agent name', async () => {
  const cwd = createWorkspace();
  const terminal = new FakeTerminal();
  const host = new CliPipelineHost(cwd, {
    terminal,
    verbose: true,
    runAgent: async () => {
      const error = Object.assign(new Error('Internal error'), {
        name: 'RequestError',
        code: -32603,
        data: { details: 'provider rejected the request' },
      });
      throw error;
    },
  });

  const result = await host.start('question-flow', 'add a CLI');

  assert.equal(result.status, 'failed');
  assert.ok(terminal.errors.includes('[acp-cli] Starting node agent "Planner" (skills=grill-me)'));
  assert.ok(terminal.errors.includes(
    '[acp-cli] Agent "Planner" failed: Internal error; code=-32603; data={"details":"provider rejected the request"}',
  ));
});

test('prints compact agent activity for CLI session updates without thought text', async () => {
  const cwd = createWorkspace();
  const terminal = new FakeTerminal();
  const host = new CliPipelineHost(cwd, {
    terminal,
    runAgent: async input => {
      input.onSessionUpdate?.({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'hidden reasoning' },
        },
      } as any);
      input.onSessionUpdate?.({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'more hidden reasoning' },
        },
      } as any);
      input.onSessionUpdate?.({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Visible answer' },
        },
      } as any);
      return { text: 'Which public API should be used?' };
    },
  });

  const started = await host.start('question-flow', 'add a CLI');

  assert.equal(started.status, 'paused');
  assert.deepEqual(terminal.errors, [
    '[acp-cli] Starting node agent "Planner"',
    '[acp-cli] plan · Planner réfléchit',
    '[acp-cli] plan · Planner répond',
  ]);
  assert.ok(!terminal.errors.some(line => line.includes('hidden reasoning')));
});

test('lists workspace pipelines with stable CLI metadata', () => {
  const cwd = createWorkspace();
  const host = new CliPipelineHost(cwd, {
    terminal: new FakeTerminal(),
    runAgent: async () => '',
  });

  assert.deepEqual(host.listPipelines(), [
    {
      id: 'question-flow',
      title: 'Question Flow',
      nodeCount: 2,
    },
  ]);
});

test('rejects resume and cancel calls for unknown runs', async () => {
  const cwd = createWorkspace();
  const host = new CliPipelineHost(cwd, {
    terminal: new FakeTerminal(),
    runAgent: async () => '',
  });

  await assert.rejects(
    () => host.resume('missing-run', { pauseId: 'pause-1', kind: 'reject' }),
    /Unknown active ACP pipeline run "missing-run"/,
  );
  await assert.rejects(
    () => host.cancel('missing-run'),
    /Unknown active ACP pipeline run "missing-run"/,
  );
});
