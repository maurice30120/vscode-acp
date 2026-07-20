import * as fs from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';
import {
  compilePipelineV3Catalog,
  extractTemplateVariables,
  resolvePipelinePromptFiles,
  validatePipelineDefinition,
  type CompiledPipelineProgram,
  type PipelineV3CatalogResult,
  type PipelineDefinition,
  type PipelineValidationResult,
} from '@acp-client/pipeline';

import { isPipelineEnabled } from './PipelineConfig';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { resolveAgent } from './VirtualAgentCatalog';
import { log } from '../utils/Logger';
import { getAgentConfigs } from './AgentConfig';
import { getInstructionsMaxBytes } from '../instructions/InstructionResolver';

export type {
  PipelineAgentStepDefinition,
  PipelineApprovalStepDefinition,
  PipelineOutputType,
  PipelineParallelBranchDefinition,
  PipelineParallelStepDefinition,
  PipelinePrimitiveDefinition,
  PipelineSideEffects,
  PipelineStepDefinition,
  PipelineDefinition,
  PipelineValidationResult,
} from '@acp-client/pipeline';
export { extractTemplateVariables, resolvePipelinePromptFiles, validatePipelineDefinition };

const PIPELINE_DIR = path.join('.acp', 'pipelines');

export function getPipelineDefinitions(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): PipelineDefinition[] {
  if (!isPipelineEnabled()) {
    return [];
  }
  return mergePipelineDefinitions(loadWorkspacePipelineDefinitions(workspaceCwd, agentConfigs), workspaceCwd);
}

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
  for (const definition of getPipelineDefinitions(workspaceCwd, agentConfigs)) {
    names.add(definition.title);
  }
  return [...names];
}

export function getPipelineDefinitionForAgent(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): PipelineDefinition | null {
  if (!isPipelineEnabled()) {
    return null;
  }

  const normalizedName = agentName.replace(/ \(invalid\)$/, '');
  return loadWorkspacePipelineDefinitions(workspaceCwd, agentConfigs)
    .find(definition => definition.title === normalizedName || definition.id === normalizedName) ?? null;
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

function mergePipelineDefinitions(
  filePipelines: PipelineDefinition[],
  workspaceCwd: string,
): PipelineDefinition[] {
  const byTitle = new Map<string, PipelineDefinition>();

  for (const pipeline of filePipelines) {
    if (byTitle.has(pipeline.title)) {
      log(`Duplicate pipeline title "${pipeline.title}" in ${workspaceCwd}; keeping first definition.`);
      continue;
    }
    byTitle.set(pipeline.title, pipeline);
  }

  return [...byTitle.values()];
}

export function isPipelineVirtualAgentName(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): boolean {
  return resolveAgent(agentName, workspaceCwd, agentConfigs as Record<string, import('./AgentConfig').AgentConfigEntry>)?.kind === 'pipeline';
}

export function loadWorkspacePipelineDefinitions(
  workspaceCwd: string,
  agentConfigs: Record<string, unknown>,
): PipelineDefinition[] {
  const dir = path.join(workspaceCwd, PIPELINE_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    log(`Failed to read ACP pipeline directory ${dir}: ${e}`);
    return [];
  }

  const definitions: PipelineDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const result = parsePipelineYaml(text, filePath, agentConfigs);
      if (result.definition) {
        const resolved = resolvePipelinePromptFiles(result.definition.primitives, {
          workspaceCwd,
          maxBytes: getInstructionsMaxBytes(),
          pipelineFilePath: filePath,
        });
        const fatalErrors = resolved.errors.filter(error => {
          const primitive = result.definition?.primitives[error.primitiveId];
          return typeof primitive?.prompt !== 'string' || primitive.prompt.trim().length === 0;
        });
        if (fatalErrors.length > 0) {
          log(`Ignoring invalid ACP pipeline ${filePath}: ${fatalErrors.map(error => `primitive "${error.primitiveId}" ${error.error}`).join('; ')}`);
          continue;
        }
        if (resolved.errors.length > 0) {
          log(`ACP pipeline ${filePath}: ${resolved.errors.map(error => `primitive "${error.primitiveId}" ${error.error}; using inline prompt fallback`).join('; ')}`);
        }
        const primitives = { ...resolved.primitives };
        for (const error of resolved.errors) {
          if (fatalErrors.includes(error)) {
            continue;
          }
          const primitive = result.definition.primitives[error.primitiveId];
          primitives[error.primitiveId] = { ...primitive, promptFile: undefined };
        }
        definitions.push({ ...result.definition, primitives });
      } else {
        log(`Ignoring invalid ACP pipeline ${filePath}: ${result.errors.join('; ')}`);
      }
    } catch (e) {
      log(`Ignoring unreadable ACP pipeline ${filePath}: ${e}`);
    }
  }
  return definitions;
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

export function parsePipelineYaml(
  text: string,
  filePath: string,
  agentConfigs: Record<string, unknown>,
): PipelineValidationResult {
  try {
    return validatePipelineDefinition(parseYamlDocument(text), filePath, agentConfigs);
  } catch (e: any) {
    return { errors: [`YAML parse error: ${e.message || String(e)}`] };
  }
}

function readAgentConfigs(): Record<string, unknown> {
  return getAgentConfigs();
}

function parseYamlDocument(text: string): unknown {
  return yaml.load(text);
}
