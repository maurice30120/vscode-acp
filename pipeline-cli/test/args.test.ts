import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

import { parseCliArgs } from '../src/args.js';

test('parses the exact run contract without an agent option', () => {
  assert.deepEqual(
    parseCliArgs(['run', 'plan-execute-verify', '--yes', '--verbose', '--', 'add', 'a', 'CLI'], '/repo'),
    {
      kind: 'run',
      pipelineName: 'plan-execute-verify',
      prompt: 'add a CLI',
      cwd: '/repo',
      json: false,
      verbose: true,
      yes: true,
    },
  );
});

test('resolves cwd portably', () => {
  assert.deepEqual(parseCliArgs(['list', '--cwd', 'demo'], '/repo'), {
    kind: 'list',
    cwd: path.resolve('/repo', 'demo'),
    json: false,
    verbose: false,
  });
});

test('rejects the obsolete agent selection option', () => {
  assert.throws(
    () => parseCliArgs(['run', 'pipeline', 'prompt', '--agent', 'Vibe']),
    /Unknown option "--agent"/,
  );
});

test('requires a pipeline and prompt', () => {
  assert.throws(
    () => parseCliArgs(['run', 'plan-execute-verify']),
    /Usage: acp-cli run/,
  );
});

test('parses list json and verbose options without accepting --yes', () => {
  assert.deepEqual(parseCliArgs(['list', '--json', '--verbose'], '/repo'), {
    kind: 'list',
    cwd: '/repo',
    json: true,
    verbose: true,
  });

  assert.throws(
    () => parseCliArgs(['list', '--yes'], '/repo'),
    /Usage: acp-cli list/,
  );
});

test('keeps prompt-looking options after the positional delimiter', () => {
  assert.deepEqual(parseCliArgs(['run', 'grill', '--', '--fix', 'pipeline-cli'], '/repo'), {
    kind: 'run',
    pipelineName: 'grill',
    prompt: '--fix pipeline-cli',
    cwd: '/repo',
    json: false,
    verbose: false,
    yes: false,
  });
});

test('requires a value for --cwd', () => {
  assert.throws(
    () => parseCliArgs(['run', '--cwd'], '/repo'),
    /--cwd requires a path/,
  );
});
