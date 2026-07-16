import type { AgentConfigEntry } from './AgentConfig';
import { getAgentConfigs } from './AgentConfig';
import {
  getPipelineDefinitionForAgent,
  getPipelineAgentNames,
  getPipelineDefinitions,
  type PipelineDefinition,
} from './PipelineCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';

export type AgentResolutionKind = 'configured' | 'pipeline';

export interface AgentResolution {
  kind: AgentResolutionKind;
  name: string;
  runnable: boolean;
  pipeline?: PipelineDefinition;
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

  const pipeline = getPipelineDefinitionForAgent(normalized, workspaceCwd, configs);
  if (pipeline) {
    return {
      kind: 'pipeline',
      name: pipeline.title,
      runnable: true,
      pipeline,
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

export function getPipelineDefinitionsForWorkspace(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs?: Record<string, AgentConfigEntry>,
): PipelineDefinition[] {
  return getPipelineDefinitions(workspaceCwd, readAgentConfigs(agentConfigs, workspaceCwd));
}
