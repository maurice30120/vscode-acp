import type { AgentConfigEntry } from './AgentConfig';
import type { CompiledPipelineProgram } from '@acp-client/pipeline';
import { getAgentConfigs } from './AgentConfig';
import {
  getPipelineAgentNames,
  getPipelineProgramForAgent,
} from './PipelineCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';

export type AgentResolutionKind = 'configured' | 'pipeline';

export interface AgentResolution {
  kind: AgentResolutionKind;
  name: string;
  runnable: boolean;
  pipeline?: CompiledPipelineProgram;
  errors: string[];
}

function normalizeAgentName(agentName: string): string {
  return agentName.replace(/ \(invalid\)$/, '');
}

function readAgentConfigs(
  agentConfigs?: Record<string, AgentConfigEntry>,
  workspaceCwd?: string,
): Record<string, AgentConfigEntry> {
  return agentConfigs ?? getAgentConfigs(workspaceCwd);
}

/**
 * Resolves how an agent name maps to configured or pipeline virtual agents.
 */
export function resolveAgent(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs?: Record<string, AgentConfigEntry>,
): AgentResolution | null {
  const normalized = normalizeAgentName(agentName);
  const configs = readAgentConfigs(agentConfigs, workspaceCwd);

  if (configs[normalized]) {
    return {
      kind: 'configured',
      name: normalized,
      runnable: true,
      errors: [],
    };
  }

  const program = getPipelineProgramForAgent(normalized, workspaceCwd, configs);
  if (program) {
    return {
      kind: 'pipeline',
      name: program.title,
      runnable: true,
      errors: [],
    };
  }

  return null;
}

export function isVirtualAgentName(
  agentName: string,
  workspaceCwd?: string,
  agentConfigs?: Record<string, AgentConfigEntry>,
): boolean {
  const resolution = resolveAgent(agentName, workspaceCwd, agentConfigs);
  return resolution?.kind === 'pipeline';
}

export function isRunnableVirtualAgent(
  agentName: string,
  workspaceCwd?: string,
  agentConfigs?: Record<string, AgentConfigEntry>,
): boolean {
  const resolution = resolveAgent(agentName, workspaceCwd, agentConfigs);
  return resolution !== null
    && resolution.kind === 'pipeline'
    && resolution.runnable;
}

export function listConfiguredAgentNames(
  agentConfigs?: Record<string, AgentConfigEntry>,
  workspaceCwd?: string,
): string[] {
  return Object.keys(readAgentConfigs(agentConfigs, workspaceCwd));
}

/**
 * All agent names shown in the Agents tree: configured + virtual pipeline.
 */
export function listSelectableAgentNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs?: Record<string, AgentConfigEntry>,
): string[] {
  const configs = readAgentConfigs(agentConfigs, workspaceCwd);
  const configured = listConfiguredAgentNames(configs);
  const pipelineNames = getPipelineAgentNames(workspaceCwd, configs);
  const virtualNames = pipelineNames.filter(name => !configured.includes(name));

  return [...configured, ...virtualNames];
}

export function getPipelineProgramsForWorkspace(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs?: Record<string, AgentConfigEntry>,
): CompiledPipelineProgram[] {
  return getPipelineProgramList(workspaceCwd, readAgentConfigs(agentConfigs, workspaceCwd));
}

function getPipelineProgramList(
  workspaceCwd: string,
  agentConfigs: Record<string, AgentConfigEntry>,
): CompiledPipelineProgram[] {
  return getPipelineAgentNames(workspaceCwd, agentConfigs)
    .map(name => getPipelineProgramForAgent(name, workspaceCwd, agentConfigs))
    .filter((program): program is CompiledPipelineProgram => program !== null);
}
