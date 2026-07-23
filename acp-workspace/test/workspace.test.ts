import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadAgentCatalog,
  loadPipelineProgramsFromRoot,
  parseAcpConfig,
  removeAgentConfig,
  resolveConnector,
  upsertAgentConfig,
} from '../src/index.js';

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acp-workspace-'));
}

test('public entry point parses native configuration', () => {
  const config = parseAcpConfig(JSON.stringify({ agents: { Codex: { command: 'codex', args: ['acp'] } } }));
  assert.equal(config.agents.Codex.command, 'codex');
  assert.deepEqual(config.errors, []);
});

test('writes, moves and removes agents while preserving configuration envelopes', () => {
  const cwd = workspace();
  fs.mkdirSync(path.join(cwd, '.acp', '.sandcastle'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.acp', 'acp-agents.json'), JSON.stringify({ pipeline: { enabled: false }, agents: {} }));
  fs.writeFileSync(path.join(cwd, '.acp', '.sandcastle', 'config.json'), JSON.stringify({ promotion: 'ask', agents: {} }));

  upsertAgentConfig('Agent', { command: 'agent' }, cwd);
  assert.equal(loadAgentCatalog(cwd).native.agents.Agent.command, 'agent');
  upsertAgentConfig('Agent', { transport: 'sandcastle', provider: 'codex', model: 'gpt-5', effort: 'high', maxIterations: 3 }, cwd);
  const moved = loadAgentCatalog(cwd);
  assert.equal(moved.native.agents.Agent, undefined);
  assert.equal(moved.sandcastle.agents.Agent.provider, 'codex');
  removeAgentConfig('Agent', cwd);
  assert.equal(loadAgentCatalog(cwd).agents.Agent, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, '.acp', 'acp-agents.json'), 'utf8')).pipeline.enabled, false);
});

test('connector selection is stable for native and Sandcastle agents', () => {
  const native = async () => { throw new Error('not called'); };
  const sandcastle = async () => { throw new Error('not called'); };
  assert.equal(resolveConnector({ command: 'codex' }, native, sandcastle), native);
  assert.equal(resolveConnector({ transport: 'sandcastle', provider: 'codex', model: 'gpt-5', effort: 'high', maxIterations: 3 }, native, sandcastle), sandcastle);
});

test('public pipeline catalog resolves instructionsFile and keeps promptFile compatibility', () => {
  const cwd = workspace();
  const pipelines = path.join(cwd, '.acp', 'pipelines');
  const agents = path.join(cwd, '.acp', 'agents');
  fs.mkdirSync(pipelines, { recursive: true });
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'planner.md'), 'Invariant planner instructions.');
  fs.writeFileSync(path.join(agents, 'legacy.md'), 'Legacy complete prompt.');
  fs.writeFileSync(path.join(pipelines, 'structured.yaml'), `version: 3
id: structured
title: Structured
nodes:
  - id: plan
    agent: Codex
    instructionsFile: ../agents/planner.md
    prompt: Run-specific task.
    output: { name: plan, type: acp.plan/v1, format: markdown }
`);
  fs.writeFileSync(path.join(pipelines, 'legacy.yaml'), `version: 3
id: legacy
title: Legacy
nodes:
  - id: plan
    agent: Codex
    promptFile: ../agents/legacy.md
    output: { name: plan, type: acp.plan/v1, format: markdown }
`);

  const result = loadPipelineProgramsFromRoot({
    workspaceCwd: cwd,
    configRoot: cwd,
    agentConfigs: { Codex: { command: 'codex' } },
  });

  assert.deepEqual(result.errors, []);
  const structured = result.programs.find(program => program.id === 'structured')?.nodes[0];
  assert.equal(structured?.prompt, 'Run-specific task.');
  assert.equal(structured?.promptFile, 'Invariant planner instructions.');
  const legacy = result.programs.find(program => program.id === 'legacy')?.nodes[0];
  assert.equal(legacy?.prompt, 'Legacy complete prompt.');
  assert.equal(legacy?.promptFile, undefined);
});

test('hosts do not import workspace catalogues from the low-level runtime', () => {
  const repo = path.resolve(import.meta.dirname, '..', '..', '..');
  for (const host of ['pipeline-cli/src', 'plugin-pi/src', 'plugin-vscode/src']) {
    for (const file of walk(path.join(repo, host))) {
      if (!file.endsWith('.ts')) continue;
      const source = fs.readFileSync(file, 'utf8');
      const runtimeImports = [...source.matchAll(/import[\s\S]*?from ['"]@acp-client\/runtime['"]/g)].map(match => match[0]);
      for (const statement of runtimeImports) {
        assert.doesNotMatch(statement, /load(?:AcpConfig|AgentCatalog|SandcastleConfig|PipelineProgramsFromRoot|SkillCatalog)/, file);
      }
    }
  }
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}
