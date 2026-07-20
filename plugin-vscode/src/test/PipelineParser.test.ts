import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PipelineParser } from '../ui/pipeline/PipelineParser';

suite('PipelineParser', () => {
  test('discovers the canonical pipeline from the workspace root', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-tree-'));
    try {
      const pipelineDir = path.join(workspaceRoot, '.acp', 'pipelines');
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.writeFileSync(
        path.join(pipelineDir, 'plan-execute-verify.yaml'),
        'version: 3\nid: plan-execute-verify\ntitle: Plan Execute Verify\nnodes:\n  - id: plan\n    agent: Vibe\n    prompt: Plan this.\n    output:\n      name: plan\n      type: acp.plan/v1\n      format: markdown\n',
      );

      const pipelines = await PipelineParser.parseAllPipelines(workspaceRoot);

      assert.strictEqual(pipelines.length, 1);
      assert.strictEqual(pipelines[0].title, 'Plan Execute Verify');
      assert.strictEqual(pipelines[0].version, 3);
      assert.strictEqual(pipelines[0].agent, 'Vibe');
      assert.strictEqual(pipelines[0].steps[0].id, 'plan');
      assert.strictEqual(pipelines[0].steps[0].output, 'plan');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
