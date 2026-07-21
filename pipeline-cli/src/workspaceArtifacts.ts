import * as fs from 'node:fs';
import * as path from 'node:path';

const SCRATCH_REFERENCE = /`((?:\.\/)?\.scratch\/[^`\r\n]+)`/g;
const REQUIRED_REFERENCE_MARKER = /<!--\s*acp-cli:require-workspace-files(?:=(\d+))?\s*-->/;

export function expandWorkspaceMarkdownReferences(
  workspaceCwd: string,
  content: string,
): string {
  const files = collectReferencedMarkdownFiles(workspaceCwd, content);
  if (files.length === 0) {
    return content;
  }

  const rendered = files.map(file => {
    const workspacePath = toWorkspacePath(workspaceCwd, file);
    return `### \`${workspacePath}\`\n\n${fs.readFileSync(file, 'utf8').trim()}`;
  });

  return [content.trimEnd(), '## Workspace documents', ...rendered].join('\n\n');
}

export function validateRequiredWorkspaceMarkdownReferences(
  workspaceCwd: string,
  content: string,
): string | undefined {
  const marker = content.match(REQUIRED_REFERENCE_MARKER);
  if (!marker) {
    return undefined;
  }

  const requiredCount = Number.parseInt(marker[1] ?? '1', 10);
  const references = collectScratchReferences(content);
  const validTargets = new Set<string>();

  for (const reference of references) {
    const normalizedReference = reference.replace(/^\.\//, '');
    const scratchRoot = path.resolve(workspaceCwd, '.scratch');
    const target = path.resolve(workspaceCwd, normalizedReference);

    if (!isChildPath(scratchRoot, target)) {
      return `Workspace handoff path escapes .scratch: ${reference}`;
    }
    if (!fs.existsSync(target)) {
      return `Workspace handoff path does not exist: ${reference}`;
    }

    const stat = fs.statSync(target);
    if (stat.isFile()) {
      if (!target.endsWith('.md')) {
        return `Workspace handoff file is not Markdown: ${reference}`;
      }
      validTargets.add(target);
      continue;
    }

    if (!stat.isDirectory()) {
      return `Workspace handoff path is neither a Markdown file nor a directory: ${reference}`;
    }

    const markdownFiles = fs.readdirSync(target, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'));
    if (markdownFiles.length === 0) {
      return `Workspace handoff directory contains no Markdown files: ${reference}`;
    }
    validTargets.add(target);
  }

  if (validTargets.size < requiredCount) {
    return `Workspace handoff requires at least ${requiredCount} existing .scratch Markdown reference(s), but found ${validTargets.size}.`;
  }

  return undefined;
}

function collectReferencedMarkdownFiles(workspaceCwd: string, content: string): string[] {
  const scratchRoot = path.resolve(workspaceCwd, '.scratch');
  const files = new Set<string>();

  for (const reference of collectScratchReferences(content)) {
    const normalizedReference = reference.replace(/^\.\//, '');
    const target = path.resolve(workspaceCwd, normalizedReference);
    if (!isChildPath(scratchRoot, target) || !fs.existsSync(target)) {
      continue;
    }

    const stat = fs.statSync(target);
    if (stat.isFile() && target.endsWith('.md')) {
      files.add(target);
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.add(path.join(target, entry.name));
      }
    }
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}

function collectScratchReferences(content: string): string[] {
  return [...content.matchAll(SCRATCH_REFERENCE)].map(match => match[1]);
}

function isChildPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toWorkspacePath(workspaceCwd: string, filePath: string): string {
  return path.relative(workspaceCwd, filePath).split(path.sep).join('/');
}
