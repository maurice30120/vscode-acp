import * as fs from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';
import {
  compilePipelineV3Catalog,
  type CompiledPipelineProgram,
  type PipelineV3CatalogResult,
} from '@acp-client/pipeline';

import { isPipelineEnabled } from './PipelineConfig';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { resolveAgent } from './VirtualAgentCatalog';
import { log } from '../utils/Logger';
import { getAgentConfigs } from './AgentConfig';
import { getInstructionsMaxBytes } from '../instructions/InstructionResolver';

const PIPELINE_DIR = path.join('.acp', 'pipelines');

export function getPipelinePrograms(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): CompiledPipelineProgram[] {
  if (!isPipelineEnabled()) {
    return [];
  }
  return loadWorkspacePipelinePrograms(workspaceCwd, agentConfigs).programs;
}

export function getPipelineAgentNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): string[] {
  const names = new Set<string>();
  for (const program of getPipelinePrograms(workspaceCwd, agentConfigs)) {
    names.add(program.title);
  }
  return [...names];
}

export function getPipelineProgramForAgent(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): CompiledPipelineProgram | null {
  if (!isPipelineEnabled()) {
    return null;
  }

  const normalizedName = agentName.replace(/ \(invalid\)$/, '');
  return loadWorkspacePipelinePrograms(workspaceCwd, agentConfigs).programs
    .find(program => program.title === normalizedName || program.id === normalizedName) ?? null;
}

export function isPipelineVirtualAgentName(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): boolean {
  return resolveAgent(agentName, workspaceCwd, agentConfigs as Record<string, import('./AgentConfig').AgentConfigEntry>)?.kind === 'pipeline';
}

export function loadWorkspacePipelinePrograms(
  workspaceCwd: string,
  agentConfigs: Record<string, unknown>,
): PipelineV3CatalogResult {
  const dir = path.join(workspaceCwd, PIPELINE_DIR);
  if (!fs.existsSync(dir)) {
    return { programs: [], errors: [] };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`Failed to read ACP pipeline directory ${dir}: ${message}`);
    return {
      programs: [],
      errors: [{ filePath: dir, errors: [`Failed to read ACP pipeline directory: ${message}`] }],
    };
  }

  const sources: Array<{ filePath: string; definition: unknown }> = [];
  const parseErrors: PipelineV3CatalogResult['errors'] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    try {
      sources.push({ filePath, definition: parseYamlDocument(fs.readFileSync(filePath, 'utf8')) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      parseErrors.push({ filePath, errors: [`YAML parse error: ${message}`] });
    }
  }

  const result = compilePipelineV3Catalog(sources, {
    workspaceCwd,
    maxPromptFileBytes: getInstructionsMaxBytes(),
    agentConfigs,
  });
  const combined = { programs: result.programs, errors: [...parseErrors, ...result.errors] };
  for (const error of combined.errors) {
    log(`Ignoring invalid ACP pipeline ${error.filePath}: ${error.errors.join('; ')}`);
  }
  return combined;
}

function readAgentConfigs(): Record<string, unknown> {
  return getAgentConfigs();
}

function parseYamlDocument(text: string): unknown {
  return yaml.load(text);
}
