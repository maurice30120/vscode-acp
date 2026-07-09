import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';
import {
  compileTeamToPipeline,
  validateAgentTeamDefinition,
  type AgentTeamDefinition,
  type CompiledTeamMetadata,
  type PipelineDefinition,
  type TeamRoleId,
} from '@acp-client/pipeline';

import { InstructionResolver, isInstructionError } from './instructionResolver.js';
import type { Logger, NativeAcpAgentConfig } from '../types.js';

const TEAM_DIR = path.join('.acp', 'teams');
const INVALID_SUFFIX = ' (invalid)';

export interface AgentTeamEntry {
  filePath: string;
  displayName: string;
  definition?: AgentTeamDefinition;
  pipeline?: PipelineDefinition;
  errors: string[];
  metadata?: CompiledTeamMetadata;
}

export function loadWorkspaceTeamEntries(
  workspaceCwd: string,
  agentConfigs: Record<string, NativeAcpAgentConfig>,
  instructionsMaxBytes: number,
  logger?: Logger,
): AgentTeamEntry[] {
  const dir = path.join(workspaceCwd, TEAM_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e: unknown) {
    logger?.error(`Failed to read ACP team directory ${dir}`, e);
    return [];
  }

  const resolver = new InstructionResolver(workspaceCwd, instructionsMaxBytes);
  const teamEntries: AgentTeamEntry[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    teamEntries.push(parseTeamFile(filePath, agentConfigs, resolver, seenIds));
  }

  return teamEntries;
}

export function getValidTeamPipelines(
  workspaceCwd: string,
  agentConfigs: Record<string, NativeAcpAgentConfig>,
  instructionsMaxBytes: number,
  logger?: Logger,
): PipelineDefinition[] {
  return loadWorkspaceTeamEntries(workspaceCwd, agentConfigs, instructionsMaxBytes, logger)
    .filter(entry => entry.pipeline !== undefined)
    .map(entry => entry.pipeline!);
}

function parseTeamFile(
  filePath: string,
  agentConfigs: Record<string, NativeAcpAgentConfig>,
  resolver: InstructionResolver,
  seenIds: Set<string>,
): AgentTeamEntry {
  let parsed: unknown;
  try {
    parsed = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (e: unknown) {
    const fallbackTitle = path.basename(filePath, path.extname(filePath));
    const message = e instanceof Error && e.message ? e.message : String(e);
    return {
      filePath,
      displayName: `${fallbackTitle}${INVALID_SUFFIX}`,
      errors: [`YAML parse error: ${message}`],
    };
  }

  const resolvedContents = new Map<TeamRoleId, string>();
  const validation = validateAgentTeamDefinition(
    parsed,
    filePath,
    agentConfigs,
    (roleId, instructionsPath) => {
      const outcome = resolver.resolve(instructionsPath, filePath);
      if (isInstructionError(outcome)) {
        return null;
      }
      resolvedContents.set(roleId, outcome.content);
      return outcome.content;
    },
  );

  if (!validation.definition) {
    const partialTitle = extractPartialTitle(parsed);
    return {
      filePath,
      displayName: `${partialTitle}${INVALID_SUFFIX}`,
      errors: validation.errors,
    };
  }

  if (seenIds.has(validation.definition.id)) {
    return {
      filePath,
      displayName: `${validation.definition.title}${INVALID_SUFFIX}`,
      definition: validation.definition,
      errors: [`Team id "${validation.definition.id}" is duplicated.`],
    };
  }
  seenIds.add(validation.definition.id);

  const resolvedInstructions = Object.fromEntries(resolvedContents) as Record<TeamRoleId, string>;
  const compiled = compileTeamToPipeline(
    validation.definition,
    resolvedInstructions,
    filePath,
    agentConfigs,
  );

  if (!compiled.pipeline) {
    return {
      filePath,
      displayName: `${validation.definition.title}${INVALID_SUFFIX}`,
      definition: validation.definition,
      errors: compiled.errors,
    };
  }

  return {
    filePath,
    displayName: validation.definition.title,
    definition: validation.definition,
    pipeline: compiled.pipeline,
    metadata: compiled.pipeline.metadata,
    errors: [],
  };
}

function extractPartialTitle(parsed: unknown): string {
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const title = (parsed as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) {
      return title.trim();
    }
    const id = (parsed as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }
  return 'Team';
}
