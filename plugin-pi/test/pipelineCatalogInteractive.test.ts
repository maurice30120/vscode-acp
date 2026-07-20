import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPipelinePrograms } from '../src/catalog/pipelineCatalog.js';

test('embedded catalog includes the interactive grill skeleton TDD pipeline as v3', () => {
  const programs = getPipelinePrograms(process.cwd());
  const pipeline = programs.find(candidate => candidate.id === 'grill-skeleton-tdd');

  assert.ok(pipeline);
  assert.deepEqual(pipeline.nodes.map(node => node.id), [
    'plan',
    'approval',
    'skeleton',
    'unit-tests',
  ]);
  assert.deepEqual(pipeline.nodesById.get('plan')?.skills, ['grill-me']);
  assert.deepEqual(pipeline.nodesById.get('skeleton')?.skills, ['skeleton-first-development']);
  assert.deepEqual(pipeline.nodesById.get('unit-tests')?.skills, ['tdd']);
  assert.deepEqual(pipeline.nodesById.get('skeleton')?.policy.filesystem, 'workspace-write');
  assert.deepEqual(pipeline.nodesById.get('unit-tests')?.policy.filesystem, 'workspace-write');
});
