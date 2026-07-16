import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getPipelineDefinitionForAgent,
  loadWorkspacePipelineDefinitions,
  parsePipelineYaml,
} from '../config/PipelineCatalog';
import { repoRoot } from './repoRoot';

const VALID_PIPELINE = `
version: 2
id: feature-dev
title: Feature Development

primitives:
  plan:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: |
      Plan this:
      {{userPrompt}}
  repo_search:
    agent: Codex
    output: markdown
    sideEffects: none
    prompt: |
      Research:
      {{steps.plan.output}}
  test_search:
    agent: Codex
    output: markdown
    sideEffects: none
    prompt: |
      Find tests:
      {{steps.plan.output}}
  synthesize:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: |
      Synthesize:
      {{steps.investigate.branches.repo.output}}
      {{steps.investigate.branches.tests.output}}
  edit:
    agent: Vibe
    output: markdown
    sideEffects: workspace
    prompt: |
      Implement:
      {{steps.approve.output}}

steps:
  - id: plan
    use: plan
  - id: investigate
    type: parallel
    branches:
      - id: repo
        use: repo_search
      - id: tests
        use: test_search
  - id: synthesize
    use: synthesize
  - id: approve
    type: approval
    input: "{{steps.synthesize.output}}"
  - id: edit
    use: edit
`;

suite('PipelineCatalog', () => {
  test('parses a valid v2 primitive-first YAML pipeline', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE,
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.definition);
    assert.strictEqual(result.definition.version, 2);
    assert.strictEqual(result.definition.title, 'Feature Development');
    assert.strictEqual(result.definition.primitives.edit.sideEffects, 'workspace');
    assert.strictEqual(result.definition.steps.length, 5);
  });

  test('parses the repository example pipeline', () => {
    const text = fs.readFileSync(
      path.join(repoRoot(), '.acp', 'pipelines', 'plan-execute-verify.yaml'),
      'utf8',
    );
    const result = parsePipelineYaml(
      text,
      '/repo/.acp/pipelines/plan-execute-verify.yaml',
      { 'Cursor CLI': {}, Vibe: {}, 'Codex CLI': {}, 'Claude Code': {} },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.definition?.id, 'plan-execute-verify');
  });

  test('resolves promptFile content before returning workspace definitions', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-prompt-file-'));
    try {
      fs.mkdirSync(path.join(workspace, '.acp', 'pipelines'), { recursive: true });
      fs.mkdirSync(path.join(workspace, '.acp', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(workspace, '.acp', 'agents', 'planner.md'), 'Planner instructions.', 'utf8');
      fs.writeFileSync(path.join(workspace, '.acp', 'pipelines', 'prompt-file.yaml'), `
version: 2
id: prompt-file
title: Prompt File

primitives:
  plan:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    promptFile: ../agents/planner.md
    prompt: |
      User request:
      {{userPrompt}}

steps:
  - id: plan
    use: plan
`, 'utf8');

      const definitions = loadWorkspacePipelineDefinitions(workspace, { Codex: {} });

      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].primitives.plan.promptFile, undefined);
      assert.match(definitions[0].primitives.plan.prompt ?? '', /Planner instructions\./);
      assert.match(definitions[0].primitives.plan.prompt ?? '', /User request:/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('keeps a pipeline visible when promptFile is missing but inline prompt exists', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-missing-prompt-file-'));
    try {
      fs.mkdirSync(path.join(workspace, '.acp', 'pipelines'), { recursive: true });
      fs.writeFileSync(path.join(workspace, '.acp', 'pipelines', 'inline-fallback.yaml'), `
version: 2
id: inline-fallback
title: Inline Fallback

primitives:
  plan:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    promptFile: ../agents/missing.md
    prompt: |
      User request:
      {{userPrompt}}

steps:
  - id: plan
    use: plan
`, 'utf8');

      const definitions = loadWorkspacePipelineDefinitions(workspace, { Codex: {} });

      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].title, 'Inline Fallback');
      assert.match(definitions[0].primitives.plan.prompt ?? '', /User request:/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('resolves workspace pipelines by id or title', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-id-resolution-'));
    try {
      fs.mkdirSync(path.join(workspace, '.acp', 'pipelines'), { recursive: true });
      fs.writeFileSync(path.join(workspace, '.acp', 'pipelines', 'pev.yaml'), `
version: 2
id: pev
title: Plan Execute Verify

primitives:
  plan:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: "{{userPrompt}}"

steps:
  - id: plan
    use: plan
`, 'utf8');

      assert.strictEqual(getPipelineDefinitionForAgent('pev', workspace, { Codex: {} })?.title, 'Plan Execute Verify');
      assert.strictEqual(getPipelineDefinitionForAgent('Plan Execute Verify', workspace, { Codex: {} })?.id, 'pev');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('rejects v1 pipelines', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('version: 2', 'version: 1'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('version must be 2')));
    assert.strictEqual(result.definition, undefined);
  });

  test('rejects primitives that reference missing agents', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE,
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {} },
    );

    assert.ok(result.errors.some(error => error.includes('Vibe')));
    assert.strictEqual(result.definition, undefined);
  });

  test('rejects duplicate step ids', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('id: investigate', 'id: plan'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('duplicated')));
  });

  test('rejects template references to future steps', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('{{userPrompt}}', '{{steps.synthesize.output}}'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('previous step')));
  });

  test('rejects workspace side effects before approval', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('repo_search:\n    agent: Codex\n    output: markdown\n    sideEffects: none', 'repo_search:\n    agent: Codex\n    output: markdown\n    sideEffects: workspace'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('cannot use workspace side effects')));
  });

  test('rejects direct workspace steps before approval', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('  - id: plan\n    use: plan', '  - id: edit_early\n    use: edit'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('before an approval step')));
  });
});
