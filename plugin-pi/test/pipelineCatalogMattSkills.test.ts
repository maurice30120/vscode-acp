import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { getPipelineDefinitions } from '../src/catalog/pipelineCatalog.js';

const PIPELINE_ID = 'grill-spec-tickets-implement-review';

function repositoryRoot(): string {
  return path.basename(process.cwd()) === 'plugin-pi'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

test('embedded catalog includes the Matt Pocock engineering pipeline', () => {
  const definitions = getPipelineDefinitions(process.cwd());
  const pipeline = definitions.find(candidate => candidate.id === PIPELINE_ID);

  assert.ok(pipeline);
  assert.deepEqual(pipeline.steps.map(step => step.id), [
    'plan',
    'plan_approval',
    'spec',
    'tasks',
    'delivery_approval',
    'implementation',
    'review',
  ]);

  assert.deepEqual(pipeline.primitives.planner.skills, ['grill-me', 'grilling']);
  assert.deepEqual(pipeline.primitives.spec_writer.skills, ['to-spec']);
  assert.deepEqual(pipeline.primitives.task_planner.skills, ['to-tickets']);
  assert.deepEqual(pipeline.primitives.implementer.skills, ['implement', 'tdd']);
  assert.deepEqual(pipeline.primitives.reviewer.skills, ['code-review']);

  assert.equal(pipeline.primitives.planner.sideEffects, 'none');
  assert.equal(pipeline.primitives.spec_writer.sideEffects, 'none');
  assert.equal(pipeline.primitives.task_planner.sideEffects, 'none');
  assert.equal(pipeline.primitives.implementer.sideEffects, 'workspace');
  assert.equal(pipeline.primitives.reviewer.sideEffects, 'none');

  assert.match(String(pipeline.primitives.spec_writer.prompt), /ACP pipeline overrides/);
  assert.match(String(pipeline.primitives.task_planner.prompt), /tracer-bullet/);
  assert.match(String(pipeline.primitives.implementer.prompt), /red-green/);
  assert.match(String(pipeline.primitives.reviewer.prompt), /git diff HEAD/);

  const deliveryApproval = pipeline.steps.find(step => step.id === 'delivery_approval');
  if (!deliveryApproval || !('type' in deliveryApproval) || deliveryApproval.type !== 'approval') {
    assert.fail('expected delivery_approval to be an approval step');
  }
  assert.match(deliveryApproval.input, /<proposed_plan>/);
  assert.match(deliveryApproval.input, /<interview_state>ready<\/interview_state>/);
});

test('pipeline references vendored Matt Pocock skill files', () => {
  const root = repositoryRoot();
  const expectedSkills = [
    'grill-me',
    'grilling',
    'to-spec',
    'to-tickets',
    'implement',
    'tdd',
    'code-review',
  ];

  for (const skillName of expectedSkills) {
    const filePath = path.join(root, '.agents', 'skills', skillName, 'SKILL.md');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.match(content, new RegExp(`^---[\\s\\S]*name: ${skillName}`, 'm'));
  }
});
