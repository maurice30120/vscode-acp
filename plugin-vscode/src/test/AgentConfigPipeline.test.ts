import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { getAgentNames } from '../config/AgentConfig';
import { repoRoot } from './repoRoot';

const monorepoRoot = () => path.join(repoRoot(), '..');

suite('AgentConfig pipeline', () => {
  let workspaceRoot: string;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-pipeline-'));
    originalGetConfiguration = vscode.workspace.getConfiguration;
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('adds virtual pipeline agent when enabled', () => {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'pipeline.enabled':
              return true;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    assert.ok(getAgentNames(monorepoRoot()).includes('Plan Execute Verify'));
  });

  test('does not add virtual pipeline agent when disabled', () => {
    writeAgentConfig(workspaceRoot, { 'Codex CLI': { command: 'codex' } });
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'pipeline.enabled':
              return false;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    assert.deepStrictEqual(getAgentNames(workspaceRoot), ['Codex CLI']);
  });

  test('loads virtual pipeline agents from explicit workspace cwd', () => {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'agents':
              return {
                'Gemini CLI': { command: 'gemini' },
                'Codex CLI': { command: 'codex' },
                'Pi Agent': { command: 'pi-acp' },
                'Claude Code': { command: 'claude' },
                'Cursor CLI': { command: 'cursor' },
                'Pi Sandcastle': { transport: 'sandcastle', provider: 'pi', model: 'opencode-go/kimi-k2.6' },
                'Cursor Sandcastle': { transport: 'sandcastle', provider: 'cursor', model: 'composer-2' },
                Vibe: { command: 'vibe' },
              };
            case 'pipeline.enabled':
              return true;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    const names = getAgentNames(monorepoRoot());
    assert.ok(names.includes('Plan Execute Verify'));
    assert.ok(!names.includes('Feature Team'));
  });
});

function writeAgentConfig(workspaceRoot: string, agents: Record<string, unknown>): void {
  const configPath = path.join(workspaceRoot, '.acp', 'acp-agents.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
}
