import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { parsePiAcpConfig } from '../src/catalog/config.js';
import { InstructionResolver, isInstructionError } from '../src/catalog/instructionResolver.js';
import { getPipelineDefinitions, loadWorkspacePipelineDefinitions, parsePipelineYaml } from '../src/catalog/pipelineCatalog.js';
import { loadWorkspaceTeamEntries } from '../src/catalog/teamCatalog.js';
import { createTempWorkspace, writeDefaultConfig, writeDemoPipeline, writeDemoTeam, writeFile } from './helpers.js';

test('loads .pi/acp-agents.json compatible native ACP config', () => {
  const config = parsePiAcpConfig(JSON.stringify({
    agents: {
      'Codex CLI': {
        command: 'npx',
        args: ['@zed-industries/codex-acp@latest'],
        env: { FOO: 'bar' },
      },
    },
    pipeline: {
      enabled: true,
      instructionsMaxBytes: 1234,
    },
  }));

  assert.deepEqual(config.errors, []);
  assert.equal(config.agents['Codex CLI'].command, 'npx');
  assert.equal(config.agents['Codex CLI'].args?.[0], '@zed-industries/codex-acp@latest');
  assert.equal(config.pipeline.instructionsMaxBytes, 1234);
});

test('rejects sandcastle agents in Pi config v1', () => {
  const config = parsePiAcpConfig(JSON.stringify({
    agents: {
      Sandcastle: {
        transport: 'sandcastle',
        provider: 'codex',
        model: 'gpt-5',
      },
    },
  }));

  assert.equal(config.agents.Sandcastle, undefined);
  assert.match(config.errors.join('\n'), /sandcastle/);
});

test('validates pipeline agent references against Pi config', () => {
  const valid = parsePipelineYaml([
    'version: 2',
    'id: valid',
    'title: Valid',
    'primitives:',
    '  planner:',
    '    agent: Codex CLI',
    '    prompt: "{{userPrompt}}"',
    '    output: proposed_plan',
    'steps:',
    '  - id: planner',
    '    use: planner',
    '',
  ].join('\n'), 'valid.yaml', { 'Codex CLI': { command: 'codex' } });

  assert.equal(valid.errors.length, 0);
  assert.equal(valid.definition?.title, 'Valid');

  const invalid = parsePipelineYaml([
    'version: 2',
    'id: invalid',
    'title: Invalid',
    'primitives:',
    '  planner:',
    '    agent: Missing Agent',
    '    prompt: "{{userPrompt}}"',
    '    output: proposed_plan',
    'steps:',
    '  - id: planner',
    '    use: planner',
    '',
  ].join('\n'), 'invalid.yaml', { 'Codex CLI': { command: 'codex' } });

  assert.match(invalid.errors.join('\n'), /Missing Agent/);
});

test('loads .acp/pipelines/*.yaml from workspace', () => {
  const workspace = createTempWorkspace();
  writeDefaultConfig(workspace);
  writeDemoPipeline(workspace);

  const definitions = loadWorkspacePipelineDefinitions(workspace, {
    'Codex CLI': { command: 'codex' },
    'Pi Agent': { command: 'pi-acp' },
  });

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].title, 'Demo Pipeline');
});

test('loads .acp/teams/*.yaml and compiles valid team pipeline', () => {
  const workspace = createTempWorkspace();
  writeDefaultConfig(workspace);
  writeDemoTeam(workspace);

  const entries = loadWorkspaceTeamEntries(workspace, {
    'Codex CLI': { command: 'codex' },
    'Pi Agent': { command: 'pi-acp' },
  }, 262144);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].displayName, 'Feature Team');
  assert.equal(entries[0].pipeline?.title, 'Feature Team');
});

test('resolves team instructions with a size limit', () => {
  const workspace = createTempWorkspace();
  writeFile(workspace, '.acp/teams/big.md', '0123456789');
  const resolver = new InstructionResolver(workspace, 4);

  const outcome = resolver.resolve('big.md', path.join(workspace, '.acp/teams/team.yaml'));

  assert.equal(isInstructionError(outcome), true);
  assert.match(isInstructionError(outcome) ? outcome.error : '', /exceeds max size/);
});

test('merges workspace pipelines and team pipelines for Pi', () => {
  const workspace = createTempWorkspace();
  writeDefaultConfig(workspace);
  writeDemoPipeline(workspace);
  writeDemoTeam(workspace);

  const definitions = getPipelineDefinitions(workspace);

  assert.deepEqual(definitions.map(definition => definition.title).sort(), [
    'Demo Pipeline',
    'Feature Team',
  ]);
});
