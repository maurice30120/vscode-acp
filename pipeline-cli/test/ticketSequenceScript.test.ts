import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

const runnerPath = path.resolve(process.cwd(), 'scripts', 'run-ticket-sequence.mjs');

test('runs one fresh implement-ticket pipeline per numbered ticket in order', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-ticket-sequence-'));
  const featureDir = path.join(workspace, '.scratch', 'feature');
  const issuesDir = path.join(featureDir, 'issues');
  const fakeCli = path.join(workspace, 'pipeline-cli', 'dist', 'src', 'cli.js');
  const logPath = path.join(workspace, 'child-runs.jsonl');

  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'spec.md'), '# Spec\n');
  fs.writeFileSync(path.join(issuesDir, '02-second.md'), '# Second\n');
  fs.writeFileSync(path.join(issuesDir, '01-first.md'), '# First\n');
  fs.writeFileSync(fakeCli, [
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.TICKET_SEQUENCE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
  ].join('\n'));

  const result = spawnSync(process.execPath, [
    runnerPath,
    '.scratch/feature/spec.md',
    '.scratch/feature/issues',
  ], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      TICKET_SEQUENCE_LOG: logPath,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const runs = fs.readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as string[]);

  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(args => args.slice(0, 2)), [
    ['run', 'implement-ticket'],
    ['run', 'implement-ticket'],
  ]);
  assert.match(runs[0][2] ?? '', /Ticket: `\.scratch\/feature\/issues\/01-first\.md`/);
  assert.match(runs[1][2] ?? '', /Ticket: `\.scratch\/feature\/issues\/02-second\.md`/);
  assert.deepEqual(runs.map(args => args.slice(3)), [
    ['--cwd', workspace, '--yes'],
    ['--cwd', workspace, '--yes'],
  ]);
});

test('rejects gaps before starting any ticket pipeline', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-ticket-sequence-gap-'));
  const featureDir = path.join(workspace, '.scratch', 'feature');
  const issuesDir = path.join(featureDir, 'issues');
  const fakeCli = path.join(workspace, 'pipeline-cli', 'dist', 'src', 'cli.js');
  const logPath = path.join(workspace, 'child-runs.jsonl');

  fs.mkdirSync(issuesDir, { recursive: true });
  fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'spec.md'), '# Spec\n');
  fs.writeFileSync(path.join(issuesDir, '02-second.md'), '# Second\n');
  fs.writeFileSync(fakeCli, "require('node:fs').writeFileSync(process.env.TICKET_SEQUENCE_LOG, 'called');\n");

  const result = spawnSync(process.execPath, [
    runnerPath,
    '.scratch/feature/spec.md',
    '.scratch/feature/issues',
  ], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      TICKET_SEQUENCE_LOG: logPath,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected 01-\*\.md but found 02-second\.md/);
  assert.equal(fs.existsSync(logPath), false);
});
