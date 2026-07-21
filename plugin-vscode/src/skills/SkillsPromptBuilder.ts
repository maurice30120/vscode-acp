import { renderExplicitPipelineSkills } from '@acp-client/pipeline';

import { SkillsCatalog } from './SkillsCatalog';
import { isSkillsEnabledAgent } from './SkillsConfig';

export interface SkillsPromptInput {
  agentName: string;
  workspaceCwd: string;
  text: string;
  skillsBootstrapped: boolean;
  skills?: readonly string[];
}

export interface SkillsPromptResult {
  text: string;
  skillsBootstrapped: boolean;
}

const SKILL_INVOCATION_PATTERN = /^\/([a-zA-Z0-9][\w-]*)\b(?:\s+([\s\S]*))?$/;

function expandSkillInvocation(
  catalog: SkillsCatalog,
  skillName: string,
  remainder: string,
): string | null {
  const resolved = catalog.resolveExplicitSkills([skillName]);
  if (resolved.errors.length > 0 || resolved.skills.length === 0) {
    return null;
  }

  const parts = [
    renderExplicitPipelineSkills(resolved.skills),
  ];
  if (remainder.trim()) {
    parts.push('', remainder.trim());
  }
  return parts.join('\n');
}

function expandExplicitSkills(
  catalog: SkillsCatalog,
  skillNames: readonly string[] | undefined,
  text: string,
): string | null {
  if (!skillNames || skillNames.length === 0) {
    return null;
  }

  const resolved = catalog.resolveExplicitSkills(skillNames);
  if (resolved.errors.length > 0) {
    throw new Error(resolved.errors.join('\n'));
  }
  if (resolved.skills.length === 0) {
    return null;
  }

  return [
    renderExplicitPipelineSkills(resolved.skills),
    '',
    text,
  ].join('\n');
}

export function buildPromptWithSkills(input: SkillsPromptInput): SkillsPromptResult {
  if (!isSkillsEnabledAgent(input.agentName)) {
    return { text: input.text, skillsBootstrapped: input.skillsBootstrapped };
  }

  const catalog = new SkillsCatalog(input.workspaceCwd);
  const explicitSkills = expandExplicitSkills(catalog, input.skills, input.text);
  if (explicitSkills) {
    return {
      text: explicitSkills,
      skillsBootstrapped: true,
    };
  }

  const trimmed = input.text.trim();
  const skillMatch = trimmed.match(SKILL_INVOCATION_PATTERN);

  if (skillMatch) {
    const expanded = expandSkillInvocation(catalog, skillMatch[1], skillMatch[2] || '');
    if (expanded) {
      return {
        text: expanded,
        skillsBootstrapped: true,
      };
    }
  }

  if (input.skillsBootstrapped) {
    return { text: input.text, skillsBootstrapped: true };
  }

  const catalogText = catalog.buildCatalogText();
  if (!catalogText) {
    return { text: input.text, skillsBootstrapped: true };
  }

  const prefixed = [
    '<available_skills>',
    catalogText,
    '</available_skills>',
    '',
    input.text,
  ].join('\n');

  return {
    text: prefixed,
    skillsBootstrapped: true,
  };
}
