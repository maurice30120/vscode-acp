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

  test('accepts Pi Sandcastle agents with explicit transport', () => {
    writeConfig({
      'Pi Sandcastle': {
        transport: 'sandcastle',
        provider: 'pi',
        model: 'opencode-go/kimi-k2.6',
        effort: 'high',
        maxIterations: 5,
      },
    });

    const config = getAgentConfig('Pi Sandcastle', workspaceRoot);
    assert.ok(config);
    assert.ok(isSandcastleAgentConfig(config));
    assert.strictEqual(config.provider, 'pi');
    assert.strictEqual(config.maxIterations, 5);
  });

  test('ignores Sandcastle agents with invalid maxIterations', () => {
    writeConfig({
      'Bad Sandcastle': {
        transport: 'sandcastle',
        provider: 'pi',
        model: 'opencode-go/kimi-k2.6',
        maxIterations: 21,
      },
    });

    assert.strictEqual(getAgentConfig('Bad Sandcastle', workspaceRoot), undefined);
  });

  test('accepts Vibe Sandcastle agents with explicit transport', () => {
    writeConfig({
      'Vibe Sandcastle': {
        transport: 'sandcastle',
        provider: 'vibe',
        model: 'mistral-large-latest',
      },
    });

    const config = getAgentConfig('Vibe Sandcastle', workspaceRoot);
    assert.ok(config);
    assert.ok(isSandcastleAgentConfig(config));
    assert.strictEqual(config.provider, 'vibe');
  });

  test('loads the same workspace-root native and Sandcastle files as Pi', () => {
    const acpRoot = path.join(workspaceRoot, '.acp');
    fs.mkdirSync(path.join(acpRoot, '.sandcastle'), { recursive: true });
    fs.writeFileSync(path.join(acpRoot, 'acp-agents.json'), JSON.stringify({
      agents: { 'Pi Agent': { command: 'pi-acp' } },
      pipeline: { enabled: true },
    }));
    fs.writeFileSync(path.join(acpRoot, '.sandcastle', 'config.json'), JSON.stringify({
      promotion: 'autoApply',
      agents: {
        'Vibe Sandcastle': {
          transport: 'sandcastle',
          provider: 'vibe',
          model: 'mistral-large-latest',
        },
      },
    }));

    assert.deepStrictEqual(Object.keys(getAgentConfigs(workspaceRoot)).sort(), [
      'Pi Agent',
      'Vibe Sandcastle',
    ]);
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

  test('agent writes preserve pipeline and Sandcastle policies', async () => {
    const acpRoot = path.join(workspaceRoot, '.acp');
    fs.mkdirSync(path.join(acpRoot, '.sandcastle'), { recursive: true });
    fs.writeFileSync(path.join(acpRoot, 'acp-agents.json'), JSON.stringify({
      agents: {},
      pipeline: { enabled: false, instructionsMaxBytes: 1234 },
    }));
    fs.writeFileSync(path.join(acpRoot, '.sandcastle', 'config.json'), JSON.stringify({
      promotion: 'autoReject',
      agents: {},
    }));

    await upsertAgentConfig('Native', { command: 'native-acp' }, workspaceRoot);

    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(acpRoot, 'acp-agents.json'), 'utf8')).pipeline, {
      enabled: false,
      instructionsMaxBytes: 1234,
    });
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(acpRoot, '.sandcastle', 'config.json'), 'utf8')).promotion,
      'autoReject',
    );
  });

  function writeConfig(agents: Record<string, unknown>): void {
    const nativeAgents = Object.fromEntries(Object.entries(agents).filter(([, value]) =>
      !(typeof value === 'object' && value !== null && 'transport' in value && value.transport === 'sandcastle')));
    const sandcastleAgents = Object.fromEntries(Object.entries(agents).filter(([, value]) =>
      typeof value === 'object' && value !== null && 'transport' in value && value.transport === 'sandcastle'));
    const configPath = path.join(workspaceRoot, '.acp', 'acp-agents.json');
    const sandcastlePath = path.join(workspaceRoot, '.acp', '.sandcastle', 'config.json');
    fs.mkdirSync(path.dirname(sandcastlePath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify({ agents: nativeAgents }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(sandcastlePath, `${JSON.stringify({ agents: sandcastleAgents }, null, 2)}\n`, 'utf8');
  }
});
