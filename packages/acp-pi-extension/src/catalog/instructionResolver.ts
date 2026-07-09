import * as fs from 'node:fs';
import * as path from 'node:path';

export interface InstructionResolveResult {
  content: string;
  absolutePath: string;
}

export interface InstructionResolveError {
  error: string;
}

export type InstructionResolveOutcome = InstructionResolveResult | InstructionResolveError;

export class InstructionResolver {
  constructor(
    private readonly workspaceCwd: string,
    private readonly maxBytes: number,
  ) {}

  resolve(relativePath: string, baseFilePath: string): InstructionResolveOutcome {
    const absolutePath = this.resolveSafePath(relativePath, baseFilePath);
    if ('error' in absolutePath) {
      return absolutePath;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath.absolutePath);
    } catch {
      return { error: `Instructions file not found: ${relativePath}` };
    }

    if (!stat.isFile()) {
      return { error: `Instructions path is not a file: ${relativePath}` };
    }

    if (stat.size > this.maxBytes) {
      return {
        error: `Instructions file exceeds max size (${this.maxBytes} bytes): ${relativePath}`,
      };
    }

    try {
      return {
        content: fs.readFileSync(absolutePath.absolutePath, 'utf8'),
        absolutePath: absolutePath.absolutePath,
      };
    } catch (e: unknown) {
      const message = e instanceof Error && e.message ? e.message : String(e);
      return { error: `Failed to read instructions file: ${message}` };
    }
  }

  resolveSafePath(
    relativePath: string,
    baseFilePath: string,
  ): { absolutePath: string } | InstructionResolveError {
    if (path.isAbsolute(relativePath)) {
      return { error: 'Instructions path must be relative to the team YAML file.' };
    }

    const normalizedRelative = path.normalize(relativePath);
    if (normalizedRelative.startsWith('..') || path.isAbsolute(normalizedRelative)) {
      return { error: 'Instructions path must stay within the workspace.' };
    }

    const teamDir = path.dirname(baseFilePath);
    const baseDir = normalizedRelative.startsWith('.acp/')
      ? this.workspaceCwd
      : teamDir;
    const candidate = path.resolve(baseDir, normalizedRelative);
    const workspaceRoot = path.resolve(this.workspaceCwd);
    const relativeToWorkspace = path.relative(workspaceRoot, candidate);

    if (relativeToWorkspace.startsWith('..') || path.isAbsolute(relativeToWorkspace)) {
      return { error: 'Instructions path must stay within the workspace.' };
    }

    return { absolutePath: candidate };
  }
}

export function isInstructionError(
  outcome: InstructionResolveOutcome,
): outcome is InstructionResolveError {
  return 'error' in outcome;
}
