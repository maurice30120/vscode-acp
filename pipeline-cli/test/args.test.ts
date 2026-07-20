import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCliArgs } from '../src/args.js';

test('parses list command options', () => {
  assert.deepEqual(parseCliArgs(['list', '--json', '--cwd', 'demo'], '/repo'), {
    kind: 'list',
    cwd: '/repo/demo',
    json: true,
    verbose: false,
  });
});

test('parses a pipeline run prompt', () => {
  assert.deepEqual(
    parseCliArgs(['run', 'grill-skeleton-tdd', '--yes', '--verbose', '--', 'add', 'a', 'CLI'], '/repo'),
    {
      kind: 'run',
      pipelineName: 'grill-skeleton-tdd',
      prompt: 'add a CLI',
      cwd: '/repo',
      json: false,
      verbose: true,
      yes: true,
    },
  );
});

test('requires a pipeline name and prompt', () => {
  assert.throws(
    () => parseCliArgs(['run', 'grill-skeleton-tdd'], '/repo'),
    /Usage: acp-pipeline run/,
  );
});
