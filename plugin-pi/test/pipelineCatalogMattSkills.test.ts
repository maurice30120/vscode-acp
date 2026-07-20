import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { getPipelinePrograms } from '../src/catalog/pipelineCatalog.js';

const PIPELINE_ID = 'grill-spec-tickets-implement-review';

function repositoryRoot(): string {
  return path.basename(process.cwd()) === 'plugin-pi'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

test('embedded catalog includes the Matt Pocock engineering pipeline as v3', () => {
  const programs = getPipelinePrograms(process.cwd());
  const pipeline = programs.find(candidate => candidate.id === PIPELINE_ID);

  assert.ok(pipeline);
  assert.deepEqual(pipeline.nodes.map(node => node.id), [
    'plan',
    'plan_approval',
    'spec',
    'tasks',
    'delivery_approval',
    'implementation',
    'review',
  ]);

  assert.deepEqual(pipeline.nodesById.get('plan')?.skills, ['grill-me', 'grilling']);
  assert.deepEqual(pipeline.nodesById.get('spec')?.skills, ['to-spec']);
  assert.deepEqual(pipeline.nodesById.get('tasks')?.skills, ['to-tickets']);
  assert.deepEqual(pipeline.nodesById.get('implementation')?.skills, ['implement', 'tdd']);
  assert.deepEqual(pipeline.nodesById.get('review')?.skills, ['code-review']);

  assert.equal(pipeline.nodesById.get('plan')?.policy.filesystem, 'read-only');
  assert.equal(pipeline.nodesById.get('spec')?.policy.filesystem, 'read-only');
  assert.equal(pipeline.nodesById.get('tasks')?.policy.filesystem, 'read-only');
  assert.equal(pipeline.nodesById.get('implementation')?.policy.filesystem, 'workspace-write');
  assert.equal(pipeline.nodesById.get('review')?.policy.filesystem, 'read-only');

  assert.match(String(pipeline.nodesById.get('spec')?.prompt), /ACP pipeline overrides/);
  assert.match(String(pipeline.nodesById.get('tasks')?.prompt), /tracer-bullet/);
  assert.match(String(pipeline.nodesById.get('implementation')?.prompt), /red-green/);
  assert.match(String(pipeline.nodesById.get('review')?.prompt), /git diff HEAD/);

  const deliveryApproval = pipeline.nodesById.get('delivery_approval');
  assert.equal(deliveryApproval?.kind, 'pause');
  assert.match(String(deliveryApproval?.pauseContent), /<proposed_plan>/);
  assert.match(String(deliveryApproval?.pauseContent), /<interview_state>ready<\/interview_state>/);
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
