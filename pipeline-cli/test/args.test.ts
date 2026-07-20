import assert from 'node:assert/strict';
import test from 'node:test';

import { formatHelp, parseCliArgs } from '../src/args.js';

test('parses list command options', () => {
  assert.deepEqual(parseCliArgs(['list', '--json', '--cwd', 'demo'], '/repo'), {
    kind: 'list',
    cwd: '/repo/demo',
    json: true,
    verbose: false,
  });
});

test('parses acp-cli run without an agent argument', () => {
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

test('requires only a pipeline name and prompt', () => {
  assert.throws(
    () => parseCliArgs(['run', 'grill-skeleton-tdd'], '/repo'),
    /Usage: acp-cli run/,
  );
});

test('help explains that the pipeline selects its agents', () => {
  const help = formatHelp();
  assert.match(help, /acp-cli run <pipeline> <prompt/);
  assert.match(help, /pipeline selects its own agents/);
  assert.doesNotMatch(help, /--agent/);
});
