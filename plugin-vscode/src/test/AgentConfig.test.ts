import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getAgentConfig,
  getAgentConfigs,
  isSandcastleAgentConfig,
  parseAgentConfigJson,
  removeAgentConfig,
  upsertAgentConfig,
} from '../config/AgentConfig';

suite('AgentConfig', () => {
  let workspaceRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-'));
  });

  teardown(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('returns no configured agents when .acp/acp-agents.json is absent', () => {
    assert.deepStrictEqual(getAgentConfigs(workspaceRoot), {});
  });

  test('accepts native ACP agents with omitted transport', () => {
    writeConfig({
      'Codex CLI': {
        command: 'npx',
        args: ['@zed-industries/codex-acp@latest'],
      },
    });

    assert.deepStrictEqual(getAgentConfig('Codex CLI', workspaceRoot), {
      command: 'npx',
      args: ['@zed-industries/codex-acp@latest'],
    });
  });

  test('accepts Sandcastle agents with explicit transport', () => {
    writeConfig({
      'Codex Sandcastle': {
        transport: 'sandcastle',
        provider: 'codex',
        model: 'gpt-5.4',
      },
    });

    const config = getAgentConfig('Codex Sandcastle', workspaceRoot);
    assert.ok(config);
    assert.ok(isSandcastleAgentConfig(config));
  });

  test('ignores invalid JSON instead of throwing', () => {
    const configPath = path.join(workspaceRoot, '.acp', 'acp-agents.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{invalid', 'utf8');

    assert.deepStrictEqual(getAgentConfigs(workspaceRoot), {});
    assert.deepStrictEqual(parseAgentConfigJson('{invalid'), {});
  });

  test('upsert and remove write .acp/acp-agents.json and preserve other entries', async () => {
    writeConfig({
      Existing: { command: 'existing-agent' },
    });

    await upsertAgentConfig('New Agent', { command: 'new-agent', args: ['--acp'] }, workspaceRoot);
    assert.deepStrictEqual(Object.keys(getAgentConfigs(workspaceRoot)).sort(), ['Existing', 'New Agent']);

    await removeAgentConfig('New Agent', workspaceRoot);
    assert.deepStrictEqual(getAgentConfigs(workspaceRoot), {
      Existing: { command: 'existing-agent' },
    });
  });

  function writeConfig(agents: Record<string, unknown>): void {
    const configPath = path.join(workspaceRoot, '.acp', 'acp-agents.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
  }
});
