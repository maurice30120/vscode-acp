import * as fs from 'node:fs';
import * as path from 'node:path';

import { workspaceIdentityFromCwd } from '../core/WorkspaceIdentity';
import { prepareCursorSkillsSymlink } from '../skills/SkillsWorkspacePrep';

export interface WorkspaceBootstrapResult {
  workspaceKey: string;
  created: string[];
  skipped: string[];
  warnings: string[];
}

export interface WorkspaceBootstrapOptions {
  includePipelineArchive?: boolean;
  starterRoot?: string;
}

interface StarterManifest {
  version: string;
}

const PLUGIN_INSTALLED_SKILLS_GITIGNORE_SECTION = '# Local Codex/plugin-installed skills';
const PLUGIN_INSTALLED_SKILLS_GITIGNORE_RULES = [
  '.agents/skills/',
  '.cursor/skills',
  'skills-lock.json',
];

function posixRelative(relPath: string): string {
  return relPath.split(path.sep).join('/');
}

function shouldSkipStarterPath(relPath: string, includePipelineArchive: boolean): boolean {
  const normalized = posixRelative(relPath);
  if (!includePipelineArchive && normalized.startsWith('.acp/pipelines/save/')) {
    return true;
  }
  return false;
}

export function readWorkspaceStarterManifest(starterRoot: string): StarterManifest | undefined {
  const manifestPath = path.join(starterRoot, 'MANIFEST.json');
  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as StarterManifest;
    return typeof parsed.version === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function listStarterEntries(
  starterRoot: string,
  relativePrefix = '',
): Promise<Array<{ relPath: string; absolutePath: string; isDirectory: boolean }>> {
  const entries: Array<{ relPath: string; absolutePath: string; isDirectory: boolean }> = [];
  const currentDir = relativePrefix ? path.join(starterRoot, relativePrefix) : starterRoot;
  if (!fs.existsSync(currentDir)) {
    return entries;
  }

  for (const name of await fs.promises.readdir(currentDir)) {
    if (name === 'MANIFEST.json' && !relativePrefix) {
      continue;
    }
    const relPath = relativePrefix ? posixRelative(path.join(relativePrefix, name)) : name;
    const absolutePath = path.join(starterRoot, relPath);
    const stat = await fs.promises.lstat(absolutePath);
    if (stat.isDirectory()) {
      entries.push({ relPath, absolutePath, isDirectory: true });
      const children = await listStarterEntries(starterRoot, relPath);
      entries.push(...children);
    } else if (stat.isFile()) {
      entries.push({ relPath, absolutePath, isDirectory: false });
    }
  }

  return entries;
}

async function copyStarterTree(
  starterRoot: string,
  workspaceCwd: string,
  includePipelineArchive: boolean,
): Promise<Pick<WorkspaceBootstrapResult, 'created' | 'skipped' | 'warnings'>> {
  const created: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const entries = await listStarterEntries(starterRoot);
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    if (shouldSkipStarterPath(entry.relPath, includePipelineArchive)) {
      continue;
    }

    const targetPath = path.join(workspaceCwd, entry.relPath);
    if (fs.existsSync(targetPath)) {
      skipped.push(entry.relPath);
      continue;
    }

    try {
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.copyFile(entry.absolutePath, targetPath);
      created.push(entry.relPath);
    } catch (error) {
      warnings.push(
        `Failed to copy ${entry.relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { created, skipped, warnings };
}

async function writeBootstrapVersionIfNeeded(
  workspaceCwd: string,
  manifest: StarterManifest | undefined,
  created: string[],
): Promise<void> {
  const bootstrapVersionPath = path.join(workspaceCwd, '.acp', '.bootstrap-version');
  if (fs.existsSync(bootstrapVersionPath) || !manifest?.version) {
    return;
  }

  const acpDir = path.join(workspaceCwd, '.acp');
  const touchedAcp = created.some(rel => rel === '.acp' || rel.startsWith('.acp/'));
  if (!fs.existsSync(acpDir) && !touchedAcp) {
    return;
  }

  await fs.promises.mkdir(acpDir, { recursive: true });
  await fs.promises.writeFile(bootstrapVersionPath, `${manifest.version}\n`, 'utf8');
}

async function ensurePluginInstalledSkillsGitIgnore(workspaceCwd: string): Promise<void> {
  const gitignorePath = path.join(workspaceCwd, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? await fs.promises.readFile(gitignorePath, 'utf8')
    : '';
  const lines = existing.split(/\r?\n/).filter(line => line.length > 0);
  const missingRules = PLUGIN_INSTALLED_SKILLS_GITIGNORE_RULES.filter(rule => !lines.includes(rule));

  if (missingRules.length === 0) {
    return;
  }

  const nextLines = [...lines];
  if (nextLines.length > 0) {
    nextLines.push('');
  }
  if (!nextLines.includes(PLUGIN_INSTALLED_SKILLS_GITIGNORE_SECTION)) {
    nextLines.push(PLUGIN_INSTALLED_SKILLS_GITIGNORE_SECTION);
  }
  nextLines.push(...missingRules);

  await fs.promises.writeFile(gitignorePath, `${nextLines.join('\n')}\n`, 'utf8');
}

export function resolveWorkspaceStarterRoot(
  extensionRoot: string,
  options?: WorkspaceBootstrapOptions,
): string | undefined {
  if (options?.starterRoot) {
    return path.resolve(options.starterRoot);
  }
  const starterRoot = path.join(path.resolve(extensionRoot), 'resources', 'workspace-starter');
  if (!fs.existsSync(starterRoot)) {
    return undefined;
  }
  return starterRoot;
}

export async function syncWorkspaceStarterCore(
  extensionRoot: string,
  workspaceCwd: string,
  options?: WorkspaceBootstrapOptions,
): Promise<WorkspaceBootstrapResult> {
  const identity = workspaceIdentityFromCwd(workspaceCwd);
  const starterRoot = resolveWorkspaceStarterRoot(extensionRoot, options);
  if (!starterRoot) {
    return {
      workspaceKey: identity.key,
      created: [],
      skipped: [],
      warnings: ['Workspace starter kit not found in extension resources.'],
    };
  }

  const includePipelineArchive = options?.includePipelineArchive ?? false;
  const manifest = readWorkspaceStarterManifest(starterRoot);
  const { created, skipped, warnings } = await copyStarterTree(
    starterRoot,
    identity.cwd,
    includePipelineArchive,
  );

  const symlinkResult = prepareCursorSkillsSymlink(identity.cwd);
  if (symlinkResult.warning) {
    warnings.push(symlinkResult.warning);
  }

  await ensurePluginInstalledSkillsGitIgnore(identity.cwd);
  await writeBootstrapVersionIfNeeded(identity.cwd, manifest, created);

  return {
    workspaceKey: identity.key,
    created,
    skipped,
    warnings,
  };
}
