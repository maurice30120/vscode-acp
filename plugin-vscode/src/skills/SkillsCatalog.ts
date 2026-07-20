import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';
import {
  discoverModelInvokedSkills,
  renderModelSkillCatalog,
  resolveExplicitPipelineSkills,
  type PipelineSkillEntry,
} from '@acp-client/pipeline';

import { getSkillsDirectory, getSkillsMaxCatalogBytes } from './SkillsConfig';

export interface SkillEntry extends PipelineSkillEntry {
  name: string;
  description: string;
  relativePath: string;
  absolutePath: string;
  modelInvoked: boolean;
  content: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  'disable-model-invocation'?: boolean;
}

const catalogCache = new Map<string, { mtimeMs: number; skills: SkillEntry[] }>();

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = yaml.load(match[1]) as SkillFrontmatter;
  return { frontmatter: frontmatter || {}, body: match[2] };
}

function folderNameFromPath(skillFilePath: string): string {
  return path.basename(path.dirname(skillFilePath));
}

function resolveSkillName(frontmatter: SkillFrontmatter, skillFilePath: string): string {
  if (typeof frontmatter.name === 'string' && frontmatter.name.trim()) {
    return frontmatter.name.trim();
  }
  return folderNameFromPath(skillFilePath);
}

function walkSkillFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function getSkillsRootMtime(workspaceCwd: string, skillsDirectory: string): number {
  const root = path.resolve(workspaceCwd, skillsDirectory);
  if (!fs.existsSync(root)) {
    return 0;
  }

  try {
    return fs.statSync(root).mtimeMs;
  } catch {
    return 0;
  }
}

export class SkillsCatalog {
  constructor(
    private readonly workspaceCwd: string,
    private readonly skillsDirectory: string = getSkillsDirectory(),
    private readonly maxCatalogBytes: number = getSkillsMaxCatalogBytes(),
  ) {}

  listSkills(): SkillEntry[] {
    const root = path.resolve(this.workspaceCwd, this.skillsDirectory);
    const cacheKey = `${this.workspaceCwd}:${this.skillsDirectory}`;
    const mtimeMs = getSkillsRootMtime(this.workspaceCwd, this.skillsDirectory);
    const cached = catalogCache.get(cacheKey);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.skills.map(skill => ({ ...skill }));
    }

    const skills = walkSkillFiles(root).map(filePath => {
      const content = fs.readFileSync(filePath, 'utf8');
      const { frontmatter } = parseFrontmatter(content);
      const disableModelInvocation = frontmatter['disable-model-invocation'] === true;
      return {
        name: resolveSkillName(frontmatter, filePath),
        description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
        relativePath: path.relative(this.workspaceCwd, filePath).replace(/\\/g, '/'),
        absolutePath: filePath,
        filePath,
        content,
        disableModelInvocation,
        modelInvoked: !disableModelInvocation,
      };
    });

    catalogCache.set(cacheKey, { mtimeMs, skills });
    return skills.map(skill => ({ ...skill }));
  }

  resolveSkill(name: string): { entry: SkillEntry; content: string } | null {
    const resolved = this.resolveExplicitSkills([name]);
    const skill = resolved.skills[0];
    if (resolved.errors.length > 0 || !skill) {
      return null;
    }
    return {
      entry: {
        name: skill.name,
        description: skill.description,
        relativePath: skill.relativePath,
        absolutePath: skill.filePath,
        filePath: skill.filePath,
        content: skill.content ?? '',
        disableModelInvocation: !skill.modelInvoked,
        modelInvoked: skill.modelInvoked,
      },
      content: skill.content ?? '',
    };
  }

  buildCatalogText(): string {
    const modelInvoked = discoverModelInvokedSkills(this.listSkills(), this.workspaceCwd);
    if (modelInvoked.length === 0) {
      return '';
    }

    let catalog = renderModelSkillCatalog(modelInvoked);
    const lines = catalog.split('\n');

    while (Buffer.byteLength(catalog, 'utf8') > this.maxCatalogBytes && lines.length > 4) {
      lines.pop();
      catalog = `${lines.join('\n')}\n...(catalog truncated)`;
    }

    if (Buffer.byteLength(catalog, 'utf8') > this.maxCatalogBytes) {
      return '';
    }

    return catalog;
  }

  resolveExplicitSkills(names: readonly string[]): ReturnType<typeof resolveExplicitPipelineSkills> {
    return resolveExplicitPipelineSkills(names, this.listSkills(), this.workspaceCwd);
  }
}

export function clearSkillsCatalogCache(): void {
  catalogCache.clear();
}
