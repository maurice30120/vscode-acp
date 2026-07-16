import * as fs from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';
import {
  extractTemplateVariables,
  resolvePipelinePromptFiles,
  validatePipelineDefinition,
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

export function getPipelineAgentNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): string[] {
  return getPipelineDefinitions(workspaceCwd, agentConfigs).map(definition => definition.title);
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

export function parsePipelineYaml(
  text: string,
  filePath: string,
  agentConfigs: Record<string, unknown>,
): PipelineValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (e: any) {
    return { errors: [`YAML parse error: ${e.message || String(e)}`] };
  }

  return validatePipelineDefinition(parsed, filePath, agentConfigs);
}

function readAgentConfigs(): Record<string, unknown> {
  return getAgentConfigs();
}
