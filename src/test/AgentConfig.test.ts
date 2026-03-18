import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  getDockerConfig,
  getResearchSubAgentConfig,
  resolveSessionWorkingDirectory,
} from '../config/AgentConfig';

suite('AgentConfig', () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalWorkspaceFolders = vscode.workspace.workspaceFolders;

  teardown(() => {
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
    (vscode.workspace as any).workspaceFolders = originalWorkspaceFolders;
  });

  test('reads Docker settings from configuration', () => {
    stubConfiguration({
      'docker.enabled': true,
      'docker.container': 'acp-dev',
    });

    assert.deepStrictEqual(getDockerConfig(), {
      enabled: true,
      container: 'acp-dev',
    });
  });

  test('reads research sub-agent settings from configuration', () => {
    stubConfiguration({
      'subAgents.researchAgentName': 'Codex CLI',
    });

    assert.deepStrictEqual(getResearchSubAgentConfig(), {
      agentName: 'Codex CLI',
    });
  });

  test('prefers acp.defaultWorkingDirectory when set', () => {
    stubConfiguration({
      defaultWorkingDirectory: '/configured/workspace',
    });
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/fallback' } },
    ];

    assert.strictEqual(resolveSessionWorkingDirectory(), '/configured/workspace');
  });

  test('falls back to the workspace folder when no defaultWorkingDirectory is set', () => {
    stubConfiguration({
      defaultWorkingDirectory: '',
    });
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: '/workspace/fallback' } },
    ];

    assert.strictEqual(resolveSessionWorkingDirectory(), '/workspace/fallback');
  });
});

function stubConfiguration(values: Record<string, unknown>): void {
  (vscode.workspace as any).getConfiguration = () =>
    ({
      get: (section: string, defaultValue?: unknown) =>
        Object.prototype.hasOwnProperty.call(values, section)
          ? values[section]
          : defaultValue,
    }) as vscode.WorkspaceConfiguration;
}
