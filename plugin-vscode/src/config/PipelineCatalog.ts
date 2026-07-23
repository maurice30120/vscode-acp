import {
  loadPipelineProgramsFromRoot,
  type AgentConfigEntry,
  type Logger,
} from '@acp-client/workspace';
import type {
  CompiledPipelineProgram,
  PipelineV3CatalogResult,
} from '@acp-client/pipeline';

import { isPipelineEnabled } from './PipelineConfig';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { resolveAgent } from './VirtualAgentCatalog';
import { log } from '../utils/Logger';
import { getAgentConfigs } from './AgentConfig';
import { getInstructionsMaxBytes } from '../instructions/InstructionResolver';

const runtimeLogger: Logger = {
  log,
  error(message, error) {
    log(error === undefined ? message : `${message}: ${error instanceof Error ? error.message : String(error)}`);
  },
};

export function getPipelinePrograms(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(workspaceCwd),
): CompiledPipelineProgram[] {
  if (!isPipelineEnabled()) {
    return [];
  }
  return loadWorkspacePipelinePrograms(workspaceCwd, agentConfigs).programs;
}

export function getPipelineAgentNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(workspaceCwd),
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
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(workspaceCwd),
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
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(workspaceCwd),
): boolean {
  return resolveAgent(agentName, workspaceCwd, agentConfigs)?.kind === 'pipeline';
}

export function loadWorkspacePipelinePrograms(
  workspaceCwd: string,
  agentConfigs: Record<string, AgentConfigEntry>,
): PipelineV3CatalogResult {
  return loadPipelineProgramsFromRoot({
    workspaceCwd,
    configRoot: workspaceCwd,
    agentConfigs,
    instructionsMaxBytes: getInstructionsMaxBytes(),
    logger: runtimeLogger,
  });
}

function readAgentConfigs(workspaceCwd: string): Record<string, AgentConfigEntry> {
  return getAgentConfigs(workspaceCwd);
}
