import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { clearSkillsCatalogCache } from '../skills/SkillsCatalog';
import { buildPromptWithSkills } from '../skills/SkillsPromptBuilder';

suite('SkillsPromptBuilder', () => {
  let root: string;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function(section?: string) {
      if (section === 'acp.skills') {
        return {
          get<T>(key: string, defaultValue?: T): T {
            const values: Record<string, unknown> = {
              enabled: true,
              directory: '.agents/skills',
              maxCatalogBytes: 65536,
              agents: ['Cursor CLI', 'Codex Sandcastle', 'Cursor Sandcastle', 'Pi Sandcastle', 'Vibe Sandcastle'],
            };
            return (values[key] ?? defaultValue) as T;
          },
        } as vscode.WorkspaceConfiguration;
      }
      return originalGetConfiguration(section);
    };

    clearSkillsCatalogCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-prompt-'));
    const dir = path.join(root, '.agents', 'skills', 'tdd');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: tdd\ndescription: Test-first development.\n---\n\n# TDD\n\nFollow red-green-refactor.\n',
      'utf8',
    );
    const hiddenDir = path.join(root, '.agents', 'skills', 'hidden');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(
      path.join(hiddenDir, 'SKILL.md'),
      '---\nname: hidden\ndescription: Hidden skill.\ndisable-model-invocation: true\n---\n\n# Hidden\n\nExplicit only.\n',
      'utf8',
    );
    const implementDir = path.join(root, '.agents', 'skills', 'implement');
    fs.mkdirSync(implementDir, { recursive: true });
    fs.writeFileSync(
      path.join(implementDir, 'SKILL.md'),
      '---\nname: implement\ndescription: Implement work.\ndisable-model-invocation: true\n---\n\n# Implement\n\nWrite the requested files.\n',
      'utf8',
    );
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    clearSkillsCatalogCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('bootstraps first prompt with available_skills catalog', () => {
    const result = buildPromptWithSkills({
      agentName: 'Cursor CLI',
      workspaceCwd: root,
      text: 'Fix the failing test',
      skillsBootstrapped: false,
    });

    assert.match(result.text, /<available_skills>/);
    assert.match(result.text, /tdd: Test-first development/);
    assert.match(result.text, /Fix the failing test/);
    assert.strictEqual(result.skillsBootstrapped, true);
  });

  test('does not re-inject catalog on later prompts', () => {
    const result = buildPromptWithSkills({
      agentName: 'Cursor CLI',
      workspaceCwd: root,
      text: 'Continue',
      skillsBootstrapped: true,
    });

    assert.strictEqual(result.text, 'Continue');
  });

  test('expands /skill invocations to full skill content', () => {
    const result = buildPromptWithSkills({
      agentName: 'Codex Sandcastle',
      workspaceCwd: root,
      text: '/tdd add coverage for SessionManager',
      skillsBootstrapped: false,
    });

    assert.match(result.text, /<skill name="tdd">/);
    assert.match(result.text, /Follow red-green-refactor/);
    assert.match(result.text, /add coverage for SessionManager/);
    assert.doesNotMatch(result.text, /<available_skills>/);
  });

  test('expands explicit-only /skill invocations', () => {
    const result = buildPromptWithSkills({
      agentName: 'Codex Sandcastle',
      workspaceCwd: root,
      text: '/hidden use the explicit-only path',
      skillsBootstrapped: false,
    });

    assert.match(result.text, /<skill name="hidden">/);
    assert.match(result.text, /Explicit only/);
    assert.match(result.text, /use the explicit-only path/);
    assert.doesNotMatch(result.text, /<available_skills>/);
  });

  test('injects explicitly requested pipeline skills before the prompt', () => {
    const result = buildPromptWithSkills({
      agentName: 'Vibe Sandcastle',
      workspaceCwd: root,
      text: 'Implement the approved plan',
      skillsBootstrapped: false,
      skills: ['implement'],
    });

    assert.match(result.text, /<skill name="implement">/);
    assert.match(result.text, /Write the requested files/);
    assert.match(result.text, /Implement the approved plan/);
    assert.doesNotMatch(result.text, /<available_skills>/);
    assert.strictEqual(result.skillsBootstrapped, true);
  });

  test('injects explicit-only pipeline skills', () => {
    const result = buildPromptWithSkills({
      agentName: 'Vibe Sandcastle',
      workspaceCwd: root,
      text: 'Use hidden workflow',
      skillsBootstrapped: false,
      skills: ['hidden'],
    });

    assert.match(result.text, /<skill name="hidden">/);
    assert.match(result.text, /Explicit only/);
    assert.doesNotMatch(result.text, /<available_skills>/);
  });

  test('throws when an explicit pipeline skill cannot be resolved', () => {
    assert.throws(
      () => buildPromptWithSkills({
        agentName: 'Vibe Sandcastle',
        workspaceCwd: root,
        text: 'Implement',
        skillsBootstrapped: false,
        skills: ['missing'],
      }),
      /Pipeline node references missing skill "missing"/,
    );
  });

  test('leaves prompt unchanged for non-skills agents', () => {
    const result = buildPromptWithSkills({
      agentName: 'Claude Code',
      workspaceCwd: root,
      text: 'Hello',
      skillsBootstrapped: false,
    });

    assert.strictEqual(result.text, 'Hello');
    assert.strictEqual(result.skillsBootstrapped, false);
  });
});
