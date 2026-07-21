import * as fs from 'node:fs';
import * as path from 'node:path';

const SCRATCH_REFERENCE = /`((?:\.\/)?\.scratch\/[^`\r\n]+)`/g;

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

function collectReferencedMarkdownFiles(workspaceCwd: string, content: string): string[] {
  const scratchRoot = path.resolve(workspaceCwd, '.scratch');
  const files = new Set<string>();

  for (const match of content.matchAll(SCRATCH_REFERENCE)) {
    const reference = match[1].replace(/^\.\//, '');
    const target = path.resolve(workspaceCwd, reference);
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

function isChildPath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toWorkspacePath(workspaceCwd: string, filePath: string): string {
  return path.relative(workspaceCwd, filePath).split(path.sep).join('/');
}
