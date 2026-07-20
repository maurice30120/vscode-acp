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
  write(): void {}
  writeError(): void {}
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
