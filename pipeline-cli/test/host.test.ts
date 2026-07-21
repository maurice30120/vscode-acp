import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import type {
  AgentNodeSessionFactory,
  AgentNodeSessionTurnInput,
  PipelineAgentRunInput,
} from '@acp-client/pipeline';
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
    () => new CliPipelineHost(cwd, { terminal: new FakeTerminal(), createSession: createSessionFromRunner(async () => '') }),
    /Missing Pi ACP config at workspace root/,
  );
});

test('loads the checked-in workspace configuration used by the CLI script', () => {
  const workspaceRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const host = new CliPipelineHost(workspaceRoot, {
    terminal: new FakeTerminal(),
    createSession: createSessionFromRunner(async () => ''),
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

test('writes fresh JSONL logs for each pipeline run', async () => {
  const cwd = createWorkspace();
  const logsDir = path.join(cwd, '.acp', 'logs');
  const sandcastleLogsDir = path.join(cwd, '.sandcastle', 'logs');
  const vibeSessionLogsDir = path.join(cwd, '.sandcastle', 'vibe-home', 'logs', 'session');
  const vibeHomeDir = path.join(cwd, '.sandcastle', 'vibe-home');
  const worktreeDir = path.join(cwd, '.sandcastle', 'worktrees', 'active');
  const gitOverrideDir = path.join(cwd, '.sandcastle', 'git-overrides');
  const codexHomeDir = path.join(cwd, '.sandcastle', 'codex-home');
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(sandcastleLogsDir, { recursive: true });
  fs.mkdirSync(vibeSessionLogsDir, { recursive: true });
  fs.mkdirSync(worktreeDir, { recursive: true });
  fs.mkdirSync(gitOverrideDir, { recursive: true });
  fs.mkdirSync(codexHomeDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, 'stale.jsonl'), '{}\n');
  fs.writeFileSync(path.join(sandcastleLogsDir, 'stale.log'), 'stale\n');
  fs.writeFileSync(path.join(vibeSessionLogsDir, 'messages.jsonl'), '{}\n');
  fs.writeFileSync(path.join(cwd, '.sandcastle', '.env'), 'TOKEN=kept\n');
  fs.writeFileSync(path.join(vibeHomeDir, 'config.toml'), 'kept = true\n');
  fs.writeFileSync(path.join(vibeHomeDir, '.env'), 'VIBE=kept\n');
  fs.writeFileSync(path.join(worktreeDir, 'file.txt'), 'kept\n');
  fs.writeFileSync(path.join(gitOverrideDir, 'override.git'), 'kept\n');
  fs.writeFileSync(path.join(codexHomeDir, 'config.toml'), 'kept\n');

  const host = new CliPipelineHost(cwd, {
    terminal: new FakeTerminal(),
    runIdFactory: () => 'run-log-test',
    runAgent: async input => {
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

  const result = await host.start('question-flow', 'add a CLI');

  assert.equal(result.status, 'paused');
  const files = fs.readdirSync(logsDir).sort();
  assert.equal(files.length, 2);
  assert.ok(files.some(file => /question-flow-run-log-test\.jsonl$/.test(file)));
  assert.ok(files.some(file => /question-flow-run-log-test-plan-Planner\.jsonl$/.test(file)));

  const runLogFile = files.find(file => /question-flow-run-log-test\.jsonl$/.test(file));
  const agentLogFile = files.find(file => /question-flow-run-log-test-plan-Planner\.jsonl$/.test(file));
  const log = fs.readFileSync(path.join(logsDir, runLogFile ?? ''), 'utf8');
  const agentLog = fs.readFileSync(path.join(logsDir, agentLogFile ?? ''), 'utf8');
  assert.match(log, /"event":"run_started"/);
  assert.match(log, /"event":"agent_started"/);
  assert.match(log, /"event":"session_update"/);
  assert.match(log, /Visible answer/);
  assert.match(agentLog, /"nodeId":"plan"/);
  assert.match(agentLog, /"agent":"Planner"/);
  assert.match(agentLog, /"event":"agent_started"/);
  assert.match(agentLog, /Visible answer/);
  assert.doesNotMatch(log, /stale/);
  assert.deepEqual(fs.readdirSync(sandcastleLogsDir), []);
  assert.deepEqual(fs.readdirSync(vibeSessionLogsDir), []);
  assert.equal(fs.readFileSync(path.join(cwd, '.sandcastle', '.env'), 'utf8'), 'TOKEN=kept\n');
  assert.equal(fs.readFileSync(path.join(vibeHomeDir, 'config.toml'), 'utf8'), 'kept = true\n');
  assert.equal(fs.readFileSync(path.join(vibeHomeDir, '.env'), 'utf8'), 'VIBE=kept\n');
  assert.equal(fs.readFileSync(path.join(worktreeDir, 'file.txt'), 'utf8'), 'kept\n');
  assert.equal(fs.readFileSync(path.join(gitOverrideDir, 'override.git'), 'utf8'), 'kept\n');
  assert.equal(fs.readFileSync(path.join(codexHomeDir, 'config.toml'), 'utf8'), 'kept\n');
});

test('lists workspace pipelines with stable CLI metadata', () => {
  const cwd = createWorkspace();
  const host = new CliPipelineHost(cwd, {
    terminal: new FakeTerminal(),
    createSession: createSessionFromRunner(async () => ''),
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
    createSession: createSessionFromRunner(async () => ''),
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

function createSessionFromRunner(
  runner: (input: PipelineAgentRunInput) => Promise<{ text: string } | string>,
): AgentNodeSessionFactory {
  return async ({ runId, node }) => {
    let activityHandler: ((activity: { kind: 'message' | 'thought' | 'status'; content: string }) => void) | undefined;
    return {
    runId,
    nodeId: node.id,
    onActivity(handler) {
      activityHandler = handler;
      return () => {
        activityHandler = undefined;
      };
    },
    async send(input: AgentNodeSessionTurnInput) {
      const result = await runner({
        workspaceCwd: input.inputs.__workspace?.value as string || '',
        agentName: input.node.agent ?? '',
        promptText: input.prompt,
        signal: input.signal,
        skills: [...input.node.skills],
        onSessionUpdate: update => {
          const data = update.update;
          if (data.sessionUpdate === 'agent_message_chunk' && data.content.type === 'text') {
            activityHandler?.({ kind: 'message', content: data.content.text });
          } else if (data.sessionUpdate === 'agent_thought_chunk' && data.content.type === 'text') {
            activityHandler?.({ kind: 'thought', content: data.content.text });
          } else {
            activityHandler?.({ kind: 'status', content: data.sessionUpdate });
          }
        },
      });
      return {
        artifact: {
          name: input.node.output!.name,
          type: input.node.output!.type,
          format: input.node.output!.format,
          value: typeof result === 'string' ? result : result.text,
        },
      };
    },
    async cancel() {},
    async close() {},
    };
  };
}
