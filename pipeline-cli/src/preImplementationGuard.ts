import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DOCUMENTATION_ONLY_MARKER = /<!--\s*acp-cli:documentation-only-before-approval\s*-->/;

export interface PreImplementationWorkspaceState {
  trackedPatch: string;
  trackedPaths: string[];
  untrackedFiles: Record<string, string>;
}

export function requiresDocumentationOnlyGuard(content: string): boolean {
  return DOCUMENTATION_ONLY_MARKER.test(content);
}

export function capturePreImplementationWorkspaceState(
  workspaceCwd: string,
): PreImplementationWorkspaceState | undefined {
  try {
    if (runGit(workspaceCwd, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
      return undefined;
    }

    const exclusions = [
      ':(exclude).scratch/**',
      ':(exclude)CONTEXT.md',
      ':(exclude)docs/architecture/adr/**',
    ];
    const trackedPatch = runGit(workspaceCwd, [
      'diff',
      '--binary',
      'HEAD',
      '--',
      '.',
      ...exclusions,
    ]);
    const trackedPaths = splitLines(runGit(workspaceCwd, [
      'diff',
      '--name-only',
      'HEAD',
      '--',
      '.',
      ...exclusions,
    ]));
    const untrackedFiles = Object.fromEntries(
      runGit(workspaceCwd, ['ls-files', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean)
        .map(normalizeWorkspacePath)
        .filter(file => !isDocumentationPath(file))
        .sort((left, right) => left.localeCompare(right))
        .map(file => [file, fingerprintPath(path.join(workspaceCwd, file))]),
    );

    return { trackedPatch, trackedPaths, untrackedFiles };
  } catch {
    return undefined;
  }
}

export function validateNoPreImplementationWorkspaceChanges(
  before: PreImplementationWorkspaceState | undefined,
  after: PreImplementationWorkspaceState | undefined,
): string | undefined {
  if (!before || !after) {
    return undefined;
  }
  if (
    before.trackedPatch === after.trackedPatch
    && JSON.stringify(before.untrackedFiles) === JSON.stringify(after.untrackedFiles)
  ) {
    return undefined;
  }

  const untrackedPaths = new Set([
    ...Object.keys(before.untrackedFiles),
    ...Object.keys(after.untrackedFiles),
  ]);
  const changedUntracked = [...untrackedPaths].filter(
    file => before.untrackedFiles[file] !== after.untrackedFiles[file],
  );
  const paths = [...new Set([...after.trackedPaths, ...changedUntracked])]
    .sort((left, right) => left.localeCompare(right));
  const suffix = paths.length > 0 ? `: ${paths.join(', ')}` : '';

  return `Documentation-only nodes changed workspace files outside .scratch, CONTEXT.md, or docs/architecture/adr/${suffix}`;
}

function runGit(workspaceCwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: workspaceCwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function normalizeWorkspacePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isDocumentationPath(file: string): boolean {
  return file === 'CONTEXT.md'
    || file === '.scratch'
    || file.startsWith('.scratch/')
    || file === 'docs/architecture/adr'
    || file.startsWith('docs/architecture/adr/');
}

function fingerprintPath(filePath: string): string {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    return createHash('sha256').update(`link:${fs.readlinkSync(filePath)}`).digest('hex');
  }
  if (stat.isFile()) {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }
  return createHash('sha256').update(`mode:${stat.mode}:size:${stat.size}`).digest('hex');
}
