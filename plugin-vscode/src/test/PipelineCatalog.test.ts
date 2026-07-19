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
    assert.strictEqual(result.definition.primitives.edit.permissions, 'ask');
    assert.strictEqual(result.definition.steps.length, 5);
  });

  test('accepts primitive permissions allowAll', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('sideEffects: none', 'sideEffects: none\n    permissions: allowAll'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.definition?.primitives.plan.permissions, 'allowAll');
  });

  test('defaults primitive permissions to ask when absent', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE,
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.definition?.primitives.plan.permissions, 'ask');
  });

  test('rejects invalid primitive permissions', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('sideEffects: none', 'sideEffects: none\n    permissions: yolo'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('permissions must be "ask" or "allowAll"')));
    assert.strictEqual(result.definition, undefined);
  });

  test('parses the repository example pipeline', () => {
    const text = fs.readFileSync(
      path.join(repoRoot(), '.acp', 'pipelines', 'plan-execute-verify.yaml'),
      'utf8',
    );
    const result = parsePipelineYaml(
      text,
      '/repo/.acp/pipelines/plan-execute-verify.yaml',
      {
        'Cursor CLI': {},
        'Vibe Sandcastle': {},
        'Pi Sandcastle': {},
        Vibe: {},
        'Codex CLI': {},
        'Claude Code': {},
      },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.definition?.id, 'plan-execute-verify');
    assert.strictEqual(result.definition?.primitives.planner.permissions, 'allowAll');
    assert.strictEqual(result.definition?.primitives.implementer.permissions, 'allowAll');
    assert.strictEqual(result.definition?.primitives.verifier.permissions, 'allowAll');
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
      {{userPrompt}}

steps:
  - id: plan
    use: plan
`, 'utf8');

      const definitions = loadWorkspacePipelineDefinitions(workspace, { Codex: {} });
      assert.strictEqual(definitions.length, 1);
      assert.strictEqual(definitions[0].primitives.plan.promptFileContent, 'Planner instructions.');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('returns the pipeline assigned to a virtual agent', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-agent-'));
    try {
      fs.mkdirSync(path.join(workspace, '.acp', 'pipelines'), { recursive: true });
      fs.writeFileSync(path.join(workspace, '.acp', 'pipelines', 'assigned.yaml'), `
version: 2
id: assigned
title: Assigned Pipeline
agent: Pipeline Agent

primitives:
  plan:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: |
      {{userPrompt}}

steps:
  - id: plan
    use: plan
`, 'utf8');

      const definition = getPipelineDefinitionForAgent(
        workspace,
        'Pipeline Agent',
        { Codex: {} },
      );
      assert.strictEqual(definition?.id, 'assigned');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
