import * as fs from 'node:fs';
import * as path from 'node:path';

const SKILLS_ROOT = path.join('.agents', 'skills');
const SAFE_SKILL_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Injects the complete content of skills explicitly selected by a pipeline.
 *
 * Explicit selection intentionally ignores `disable-model-invocation`: that
 * frontmatter flag only prevents automatic discovery and must not suppress a
 * skill such as `grill-me` when the pipeline names it directly.
 */
export function composeExplicitSkills(
  workspaceCwd: string,
  skillNames: string[] | undefined,
  promptText: string,
): string {
  const names = [...new Set(skillNames ?? [])];
  if (names.length === 0) {
    return promptText;
  }

  const root = path.resolve(workspaceCwd, SKILLS_ROOT);
  const blocks = names.map(name => {
    if (!SAFE_SKILL_NAME.test(name)) {
      throw new Error(`Invalid explicit skill name "${name}".`);
    }
    const filePath = path.resolve(root, name, 'SKILL.md');
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Explicit skill "${name}" resolves outside ${SKILLS_ROOT}.`);
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Explicit pipeline skill "${name}" was not found at ${path.relative(workspaceCwd, filePath)}.`);
    }
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
      throw new Error(`Explicit pipeline skill "${name}" is empty.`);
    }
    const relativePath = path.relative(workspaceCwd, filePath).replace(/\\/g, '/');
    return [
      `<explicit_skill name="${name}" source="${relativePath}">`,
      content,
      '</explicit_skill>',
    ].join('\n');
  });

  return [
    '<explicit_skills>',
    ...blocks,
    '</explicit_skills>',
    '',
    promptText,
  ].join('\n');
}
