import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  capturePreImplementationWorkspaceState,
  requiresDocumentationOnlyGuard,
  validateNoPreImplementationWorkspaceChanges,
} from '../src/preImplementationGuard.js';

test('recognizes documentation-only approval markers', () => {
  assert.equal(
    requiresDocumentationOnlyGuard('<!-- acp-cli:documentation-only-before-approval -->'),
    true,
  );
  assert.equal(requiresDocumentationOnlyGuard('ordinary approval'), false);
});

test('allows scratch documentation changes before implementation', () => {
  const cwd = createRepository();
  const before = capturePreImplementationWorkspaceState(cwd);
  const featureDir = path.join(cwd, '.scratch', 'pipeline-agent-reflection-activity');
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, 'plan.md'), '# Plan\n');
  const after = capturePreImplementationWorkspaceState(cwd);

  assert.equal(validateNoPreImplementationWorkspaceChanges(before, after), undefined);
});

test('rejects a product file created by a planning node', () => {
  const cwd = createRepository();
  const before = capturePreImplementationWorkspaceState(cwd);
  fs.writeFileSync(path.join(cwd, 'poem.md'), '# Poem\n');
  const after = capturePreImplementationWorkspaceState(cwd);

  assert.match(
    validateNoPreImplementationWorkspaceChanges(before, after) ?? '',
    /preimplementation|Documentation-only nodes changed workspace files.*poem\.md/i,
  );
});

test('rejects changes to tracked product files while preserving pre-existing edits', () => {
  const cwd = createRepository();
  fs.appendFileSync(path.join(cwd, 'README.md'), 'pre-existing\n');
  const before = capturePreImplementationWorkspaceState(cwd);
  fs.appendFileSync(path.join(cwd, 'README.md'), 'planning mutation\n');
  const after = capturePreImplementationWorkspaceState(cwd);

  assert.match(
    validateNoPreImplementationWorkspaceChanges(before, after) ?? '',
    /README\.md/,
  );
});

function createRepository(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-guard-'));
  runGit(cwd, ['init']);
  runGit(cwd, ['config', 'user.email', 'test@example.com']);
  runGit(cwd, ['config', 'user.name', 'ACP Test']);
  fs.writeFileSync(path.join(cwd, 'README.md'), '# Test\n');
  runGit(cwd, ['add', 'README.md']);
  runGit(cwd, ['commit', '-m', 'initial']);
  return cwd;
}

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
  });
}
