import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_CONFIG_RELATIVE_PATH as SHARED_AGENT_CONFIG_RELATIVE_PATH,
  parseAcpAgentConfigCatalog,
  type AcpAgentConfigEntry as SharedAcpAgentConfigEntry,
  type AgentConfigEntry as SharedAgentConfigEntry,
  type SandcastleAgentConfigEntry as SharedSandcastleAgentConfigEntry,
} from '@acp-client/pipeline';
import { listSelectableAgentNames } from './VirtualAgentCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { log } from '../utils/Logger';

export type AcpAgentConfigEntry = SharedAcpAgentConfigEntry;
export type SandcastleAgentConfigEntry = SharedSandcastleAgentConfigEntry;
export type AgentConfigEntry = SharedAgentConfigEntry;

export const AGENT_CONFIG_RELATIVE_PATH = path.normalize(SHARED_AGENT_CONFIG_RELATIVE_PATH);

export function isSandcastleAgentConfig(
  config: AgentConfigEntry,
): config is SandcastleAgentConfigEntry {
  return config.transport === 'sandcastle';
}

/**
 * Read agent configurations from .acp/acp-agents.json.
 * Returns a map of agent name → config.
 */
export function getAgentConfigs(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
): Record<string, AgentConfigEntry> {
  const filePath = getAgentConfigPath(workspaceCwd);
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return parseAgentConfigJson(fs.readFileSync(filePath, 'utf8'), filePath);
  } catch (error) {
    log(`Ignoring unreadable ACP agent config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

export function getAgentConfigPath(workspaceCwd: string = resolveWorkspaceIdentity().cwd): string {
  return path.join(workspaceCwd, AGENT_CONFIG_RELATIVE_PATH);
}

export function parseAgentConfigJson(
  text: string,
  filePath = AGENT_CONFIG_RELATIVE_PATH,
): Record<string, AgentConfigEntry> {
  const catalog = parseAcpAgentConfigCatalog(text);
  for (const error of catalog.errors) {
    log(`Ignoring invalid ACP agent config ${filePath}: ${error}`);
  }
  return catalog.agents;
}

export async function writeAgentConfigs(
  agents: Record<string, AgentConfigEntry>,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
): Promise<void> {
  const filePath = getAgentConfigPath(workspaceCwd);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(agents, null, 2)}\n`, 'utf8');
}

export async function upsertAgentConfig(
  name: string,
  entry: AgentConfigEntry,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
): Promise<void> {
  const agents = getAgentConfigs(workspaceCwd);
  agents[name] = entry;
  await writeAgentConfigs(agents, workspaceCwd);
}

export async function removeAgentConfig(
  name: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
): Promise<void> {
  const agents = getAgentConfigs(workspaceCwd);
  delete agents[name];
  await writeAgentConfigs(agents, workspaceCwd);
}

/**
 * Get the list of agent names available.
 */
export function getAgentNames(
  workspaceCwd?: string,
  agentConfigs: Record<string, AgentConfigEntry> = getAgentConfigs(workspaceCwd),
): string[] {
  return listSelectableAgentNames(workspaceCwd, agentConfigs);
}

/**
 * Get a specific agent config by name.
 */
export function getAgentConfig(
  name: string,
  workspaceCwd?: string,
): AgentConfigEntry | undefined {
  return getAgentConfigs(workspaceCwd)[name];
}
