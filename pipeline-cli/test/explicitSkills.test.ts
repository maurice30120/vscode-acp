import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { composeExplicitSkills } from '../src/explicitSkills.js';

test('injects grill-me even when automatic invocation is disabled', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-skills-'));
  const skillDir = path.join(cwd, '.agents', 'skills', 'grill-me');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: grill-me',
      'description: Ask one question at a time.',
      'disable-model-invocation: true',
      '---',
      '',
      'Ask exactly one question per turn.',
    ].join('\n'),
  );

  try {
    const prompt = composeExplicitSkills(cwd, ['grill-me'], 'Build the feature.');
    assert.match(prompt, /<explicit_skill name="grill-me"/);
    assert.match(prompt, /disable-model-invocation: true/);
    assert.match(prompt, /Ask exactly one question per turn/);
    assert.match(prompt, /Build the feature\.$/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('fails when an explicitly selected skill is missing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-skills-'));
  try {
    assert.throws(
      () => composeExplicitSkills(cwd, ['grill-me'], 'Build the feature.'),
      /Explicit pipeline skill "grill-me" was not found/,
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
