import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { expandWorkspaceMarkdownReferences } from '../src/workspaceArtifacts.js';

test('expands referenced scratch Markdown files without changing the handoff text', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-files-'));
  const featureDir = path.join(cwd, '.scratch', 'file-backed-pipeline');
  const issuesDir = path.join(featureDir, 'issues');
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'plan.md'), '# Plan\n\nUse files as context.\n');
  fs.writeFileSync(path.join(issuesDir, '02-second.md'), '# Second ticket\n');
  fs.writeFileSync(path.join(issuesDir, '01-first.md'), '# First ticket\n');
  fs.writeFileSync(path.join(issuesDir, 'notes.txt'), 'ignored\n');

  const handoff = [
    '## Documentation',
    '',
    '- `.scratch/file-backed-pipeline/plan.md`',
    '- `.scratch/file-backed-pipeline/issues/`',
  ].join('\n');

  const rendered = expandWorkspaceMarkdownReferences(cwd, handoff);

  assert.match(rendered, /^## Documentation/m);
  assert.match(rendered, /## Workspace documents/);
  assert.match(rendered, /### `\.scratch\/file-backed-pipeline\/plan\.md`/);
  assert.match(rendered, /Use files as context\./);
  assert.ok(rendered.indexOf('# First ticket') < rendered.indexOf('# Second ticket'));
  assert.doesNotMatch(rendered, /ignored/);
});

test('ignores missing and escaping scratch references', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-files-'));
  const content = [
    '- `.scratch/missing/spec.md`',
    '- `.scratch/../outside.md`',
  ].join('\n');

  assert.equal(expandWorkspaceMarkdownReferences(cwd, content), content);
});
