import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPipelineDefinitions } from '../src/catalog/pipelineCatalog.js';

test('embedded catalog includes the interactive grill skeleton TDD pipeline', () => {
  const definitions = getPipelineDefinitions(process.cwd());
  const pipeline = definitions.find(candidate => candidate.id === 'grill-skeleton-tdd');

  assert.ok(pipeline);
  assert.deepEqual(pipeline.steps.map(step => step.id), [
    'plan',
    'approval',
    'skeleton',
    'unit-tests',
  ]);
  assert.deepEqual(pipeline.primitives.planner.skills, ['grill-me']);
  assert.deepEqual(pipeline.primitives.skeleton.skills, ['skeleton-first-development']);
  assert.deepEqual(pipeline.primitives.unit_tests.skills, ['tdd']);
});
