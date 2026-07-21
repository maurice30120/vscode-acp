import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import type { PipelineRuntimeResult } from '@acp-client/pipeline';
import type { PiPermissionContext } from '@acp-client/pi-extension/host';

import type { CliRunCommand } from '../src/args.js';
import { runPipelineInteractive } from '../src/run.js';
import type { CliTerminal } from '../src/terminal.js';

class FakeTerminal implements CliTerminal {
  readonly output: string[] = [];
  readonly confirmations = [true];

  write(message: string): void { this.output.push(message); }
  writeError(): void {}
  async ask(): Promise<string> { return ''; }
  async confirm(): Promise<boolean> { return this.confirmations.shift() ?? false; }
  async select(): Promise<string | undefined> { return undefined; }
  asPermissionContext(): PiPermissionContext { return {} as PiPermissionContext; }
  close(): void {}
}

test('shows referenced files but approves the compact handoff', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-run-files-'));
  const planPath = path.join(cwd, '.scratch', 'compact-context', 'plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, '# Approved plan\n\nKeep model context compact.\n');

  const handoff = '## Documentation\n\n- `.scratch/compact-context/plan.md`';
  const decisions: unknown[] = [];
  const paused: PipelineRuntimeResult = {
    status: 'paused',
    runId: 'run-files',
    pause: {
      id: 'approve-plan',
      nodeId: 'plan-approval',
      type: 'approval',
      content: handoff,
      format: 'proposed-plan',
    },
    snapshot: snapshot('paused'),
  };
  const completed: PipelineRuntimeResult = {
    status: 'completed',
    runId: 'run-files',
    artifact: {
      name: 'report',
      type: 'acp.verification-report/v1',
      format: 'markdown',
      value: 'review complete',
      producerNodeId: 'review',
    },
    snapshot: snapshot('completed'),
  };
  const host = {
    start: async () => paused,
    resume: async (_runId: string, decision: unknown) => {
      decisions.push(decision);
      return completed;
    },
  };
  const terminal = new FakeTerminal();
  const command: CliRunCommand = {
    kind: 'run',
    pipelineName: 'file-backed',
    prompt: 'simplify context',
    cwd,
    json: false,
    verbose: false,
    yes: false,
  };

  await runPipelineInteractive(host, terminal, command);

  assert.match(terminal.output[0] ?? '', /# Approved plan/);
  assert.match(terminal.output[0] ?? '', /Keep model context compact\./);
  assert.deepEqual(decisions, [{
    pauseId: 'approve-plan',
    kind: 'approve',
    value: handoff,
  }]);
});

function snapshot(status: 'paused' | 'completed') {
  return {
    runId: 'run-files',
    pipelineId: 'file-backed',
    status,
    nodeStates: {},
    artifacts: {},
    diagnostics: [],
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  };
}
