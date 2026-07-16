import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PipelinePrimitiveDefinition } from './PipelineTypes';

export interface PromptFileResolveError {
  primitiveId: string;
  error: string;
}

export interface PromptFileResolveOptions {
  workspaceCwd: string;
  configRoot?: string;
  maxBytes: number;
  pipelineFilePath: string;
}

/**
 * Resolves `promptFile` for every primitive and composes the final prompt text.
 * File content is prepended when both `promptFile` and inline `prompt` exist.
 */
export function resolvePipelinePromptFiles(
  primitives: Record<string, PipelinePrimitiveDefinition>,
  options: PromptFileResolveOptions,
): {
  primitives: Record<string, PipelinePrimitiveDefinition>;
  errors: PromptFileResolveError[];
} {
  const errors: PromptFileResolveError[] = [];
  const resolved: Record<string, PipelinePrimitiveDefinition> = {};

  for (const [primitiveId, primitive] of Object.entries(primitives)) {
    if (!primitive.promptFile) {
      resolved[primitiveId] = primitive;
      continue;
    }

    const outcome = readPromptFile(primitive.promptFile, options);
    if ('error' in outcome) {
      errors.push({ primitiveId, error: outcome.error });
      continue;
    }

    const inlinePrompt = primitive.prompt ?? '';
    resolved[primitiveId] = {
      ...primitive,
      prompt: inlinePrompt.length > 0
        ? `${outcome.content}\n\n${inlinePrompt}`
        : outcome.content,
      promptFile: undefined,
    };
  }

  return { primitives: resolved, errors };
}

function readPromptFile(
  relativePath: string,
  options: PromptFileResolveOptions,
): { content: string } | { error: string } {
  const safePath = resolveSafePath(relativePath, options);
  if ('error' in safePath) {
    return safePath;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(safePath.absolutePath);
  } catch {
    return { error: `promptFile not found: ${relativePath}` };
  }

  if (!stat.isFile()) {
    return { error: `promptFile path is not a file: ${relativePath}` };
  }

  if (stat.size > options.maxBytes) {
    return { error: `promptFile exceeds max size (${options.maxBytes} bytes): ${relativePath}` };
  }

  try {
    return { content: fs.readFileSync(safePath.absolutePath, 'utf8') };
  } catch (e: unknown) {
    const message = e instanceof Error && e.message ? e.message : String(e);
    return { error: `Failed to read promptFile: ${message}` };
  }
}

function resolveSafePath(
  relativePath: string,
  options: PromptFileResolveOptions,
): { absolutePath: string } | { error: string } {
  if (path.isAbsolute(relativePath)) {
    return { error: 'promptFile path must be relative to the pipeline YAML file.' };
  }

  const normalizedRelative = path.normalize(relativePath);
  if (path.isAbsolute(normalizedRelative)) {
    return { error: 'promptFile path must stay within the workspace.' };
  }

  const configRoot = path.resolve(options.configRoot ?? options.workspaceCwd);
  const pipelineDir = path.dirname(options.pipelineFilePath);
  const candidate = path.resolve(pipelineDir, normalizedRelative);
  const relativeToConfigRoot = path.relative(configRoot, candidate);

  if (relativeToConfigRoot.startsWith('..') || path.isAbsolute(relativeToConfigRoot)) {
    return { error: 'promptFile path must stay within the workspace.' };
  }

  return { absolutePath: candidate };
}
