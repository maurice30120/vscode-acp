import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  resolveAgent,
} from '../config/VirtualAgentCatalog';
import { SessionBackedActiveAgentResolver } from '../inlineChat/agent/ActiveAgentResolver';

suite('ActiveAgentResolver', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
  let workspaceRoot: string;

  function writeAgents(agents: Record<string, unknown>, workspace = workspaceRoot): void {
    fs.mkdirSync(path.join(workspace, '.acp'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, '.acp', 'acp-agents.json'),
      `${JSON.stringify(agents, null, 2)}\n`,
      'utf8',
    );
  }

  function writePipeline(workspace = workspaceRoot): void {
    const pipelinePath = path.join(workspace, '.acp', 'pipelines', 'plan-execute-verify.yaml');
    fs.mkdirSync(path.dirname(pipelinePath), { recursive: true });
    fs.writeFileSync(pipelinePath, `
version: 2
id: plan-execute-verify
title: Plan Execute Verify
primitives:
  planner:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: Plan the request.
steps:
  - id: plan
    use: planner
`, 'utf8');
  }

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'active-agent-resolver-'));
    writeAgents({
      Codex: { command: 'echo', displayName: 'Codex Agent' },
      Vibe: { command: 'echo' },
    });
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => key === 'pipeline.enabled'
          ? true
          : defaultValue,
      } as any;
    };
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('active configured non-virtual agent resolves to itself', () => {
    const resolver = new SessionBackedActiveAgentResolver(
      () => workspaceRoot,
      () => 'Codex',
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(agent.name, 'Codex');
    assert.strictEqual(agent.displayName, 'Codex Agent');
  });

  test('no active session falls back to first configured agent', () => {
    const resolver = new SessionBackedActiveAgentResolver(
      () => workspaceRoot,
      () => undefined,
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(resolveAgent(agent.name, workspaceRoot)?.kind, 'configured');
  });

  test('active virtual agent session falls back to first configured agent', () => {
    writePipeline();

    const resolver = new SessionBackedActiveAgentResolver(
      () => workspaceRoot,
      () => 'Plan Execute Verify',
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(resolveAgent(agent.name, workspaceRoot)?.kind, 'configured');
  });

  test('missing displayName falls back to agent name', () => {
    const resolver = new SessionBackedActiveAgentResolver(
      () => workspaceRoot,
      () => 'Vibe',
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(agent.name, 'Vibe');
    assert.strictEqual(agent.displayName, 'Vibe');
  });

  test('no configured agents throws explicit error', () => {
    const emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'no-acp-agents-workspace-'));

    const resolver = new SessionBackedActiveAgentResolver(
      () => emptyWorkspace,
      () => undefined,
    );

    try {
      assert.throws(
        () => resolver.resolveRunnableAgent(),
        (error: unknown) =>
          error instanceof Error
          && error.message.includes('No ACP agent configured'),
      );
    } finally {
      fs.rmSync(emptyWorkspace, { recursive: true, force: true });
    }
  });
});
