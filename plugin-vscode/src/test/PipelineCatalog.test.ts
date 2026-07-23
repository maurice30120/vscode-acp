import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getPipelineProgramForAgent,
  loadWorkspacePipelinePrograms,
} from '../config/PipelineCatalog';

suite('PipelineCatalog', () => {
  test('loads compiled v3 pipeline programs from workspace YAML', () => {
    const workspace = makeWorkspace();
    try {
      writePipeline(workspace, 'feature-dev.yaml', `
version: 3
id: feature-dev
title: Feature Development
nodes:
  - id: plan
    agent: Codex
    prompt: Plan this.
    output:
      name: plan
      type: acp.plan/v1
      format: markdown
  - id: edit
    agent: Vibe
    needs: [plan]
    prompt: Implement it.
    output:
      name: changes
      type: acp.changes/v1
      format: markdown
`);

      const result = loadWorkspacePipelinePrograms(workspace, {
        Codex: { command: 'codex' },
        Vibe: { command: 'vibe' },
      });

      assert.deepStrictEqual(result.errors, []);
      assert.deepStrictEqual(result.programs.map(program => program.id), ['feature-dev']);
      assert.strictEqual(result.programs[0].title, 'Feature Development');
      assert.deepStrictEqual(result.programs[0].rootNodeIds, ['plan']);
      assert.deepStrictEqual(result.programs[0].terminalNodeIds, ['edit']);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('resolves v3 promptFile content before returning workspace programs', () => {
    const workspace = makeWorkspace();
    try {
      fs.mkdirSync(path.join(workspace, '.acp', 'agents'), { recursive: true });
      fs.writeFileSync(path.join(workspace, '.acp', 'agents', 'planner.md'), 'Planner instructions.', 'utf8');
      writePipeline(workspace, 'prompt-file.yaml', `
version: 3
id: prompt-file
title: Prompt File
nodes:
  - id: plan
    agent: Codex
    promptFile: ../agents/planner.md
    output:
      name: plan
      type: acp.plan/v1
      format: markdown
`);

      const result = loadWorkspacePipelinePrograms(workspace, { Codex: { command: 'codex' } });

      assert.deepStrictEqual(result.errors, []);
      assert.strictEqual(result.programs[0].nodes[0].prompt, 'Planner instructions.');
      assert.strictEqual(result.programs[0].nodes[0].promptFile, undefined);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('keeps valid v3 programs while reporting invalid pipeline files', () => {
    const workspace = makeWorkspace();
    try {
      writePipeline(workspace, 'bad.yaml', 'version: 3\nid: bad\ntitle: Bad\n');
      writePipeline(workspace, 'good.yaml', `
version: 3
id: good
title: Good
nodes:
  - id: plan
    agent: Codex
    prompt: Plan this.
    output:
      name: plan
      type: acp.plan/v1
      format: markdown
`);

      const result = loadWorkspacePipelinePrograms(workspace, { Codex: { command: 'codex' } });

      assert.deepStrictEqual(result.programs.map(program => program.id), ['good']);
      assert.match(result.errors[0]?.errors.join('\n') ?? '', /nodes must be an array/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('reports YAML parse errors', () => {
    const workspace = makeWorkspace();
    try {
      writePipeline(workspace, 'broken.yaml', 'version: 3\nnodes:\n  - : broken');

      const result = loadWorkspacePipelinePrograms(workspace, { Codex: { command: 'codex' } });

      assert.strictEqual(result.programs.length, 0);
      assert.match(result.errors[0]?.errors.join('\n') ?? '', /YAML parse error/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('resolves v3 programs by id or title', () => {
    const workspace = makeWorkspace();
    try {
      writePipeline(workspace, 'pev.yaml', `
version: 3
id: pev
title: Plan Execute Verify
nodes:
  - id: plan
    agent: Codex
    prompt: Plan this.
    output:
      name: plan
      type: acp.plan/v1
      format: markdown
`);

      const agents = { Codex: { command: 'codex' } };
      assert.strictEqual(getPipelineProgramForAgent('pev', workspace, agents)?.title, 'Plan Execute Verify');
      assert.strictEqual(getPipelineProgramForAgent('Plan Execute Verify', workspace, agents)?.id, 'pev');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('refuses v2 definitions without conversion', () => {
    const workspace = makeWorkspace();
    try {
      writePipeline(workspace, 'v2.yaml', `
version: 2
id: old
title: Old Pipeline
primitives: {}
steps: []
`);

      const result = loadWorkspacePipelinePrograms(workspace, { Codex: { command: 'codex' } });

      assert.strictEqual(result.programs.length, 0);
      assert.match(result.errors[0]?.errors.join('\n') ?? '', /Unsupported ACP pipeline version 2/);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-catalog-'));
}

function writePipeline(workspace: string, fileName: string, content: string): void {
  const pipelineDir = path.join(workspace, '.acp', 'pipelines');
  fs.mkdirSync(pipelineDir, { recursive: true });
  fs.writeFileSync(path.join(pipelineDir, fileName), content.trimStart(), 'utf8');
}
