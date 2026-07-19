import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { getAgentNames } from '../config/AgentConfig';

suite('AgentConfig pipeline', () => {
  let workspaceRoot: string;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-pipeline-'));
    originalGetConfiguration = vscode.workspace.getConfiguration;
    writeAgentConfig(workspaceRoot, { 'Codex CLI': { command: 'codex' } });
    writePipelineConfig(workspaceRoot);
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('adds virtual pipeline agent when enabled', () => {
    setPipelineEnabled(true);

    assert.ok(getAgentNames(workspaceRoot).includes('Plan Execute Verify'));
  });

  test('does not add virtual pipeline agent when disabled', () => {
    setPipelineEnabled(false);

    assert.deepStrictEqual(getAgentNames(workspaceRoot), ['Codex CLI']);
  });

  test('loads virtual pipeline agents from explicit workspace cwd', () => {
    writeAgentConfig(workspaceRoot, {
      'Gemini CLI': { command: 'gemini' },
      'Codex CLI': { command: 'codex' },
      'Pi Agent': { command: 'pi-acp' },
      'Claude Code': { command: 'claude' },
      'Cursor CLI': { command: 'cursor' },
      'Pi Sandcastle': { transport: 'sandcastle', provider: 'pi', model: 'opencode-go/kimi-k2.6' },
      'Cursor Sandcastle': { transport: 'sandcastle', provider: 'cursor', model: 'composer-2' },
      Vibe: { command: 'vibe' },
    });
    setPipelineEnabled(true);

    const names = getAgentNames(workspaceRoot);
    assert.ok(names.includes('Plan Execute Verify'));
    assert.ok(!names.includes('Feature Team'));
  });

  function setPipelineEnabled(enabled: boolean): void {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => key === 'pipeline.enabled'
          ? enabled
          : defaultValue,
      } as any;
    };
  }
});

function writeAgentConfig(workspaceRoot: string, agents: Record<string, unknown>): void {
  const configPath = path.join(workspaceRoot, '.acp', 'acp-agents.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
}

function writePipelineConfig(workspaceRoot: string): void {
  const pipelinePath = path.join(workspaceRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml');
  fs.mkdirSync(path.dirname(pipelinePath), { recursive: true });
  fs.writeFileSync(pipelinePath, `
version: 2
id: plan-execute-verify
title: Plan Execute Verify
primitives:
  planner:
    agent: Codex CLI
    output: proposed_plan
    sideEffects: none
    prompt: Plan the request.
steps:
  - id: plan
    use: planner
`, 'utf8');
}
