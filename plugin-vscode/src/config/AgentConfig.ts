import * as fs from 'fs';
import * as path from 'path';
import {
  loadAgentCatalog,
  parseAcpConfig,
  parseSandcastleConfig,
  type AgentConfigEntry,
  type NativeAcpAgentConfig,
  type SandcastleAgentConfig,
} from '@acp-client/runtime';

import { listSelectableAgentNames } from './VirtualAgentCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { log } from '../utils/Logger';

export type AcpAgentConfigEntry = NativeAcpAgentConfig;
export type SandcastleAgentConfigEntry = SandcastleAgentConfig;
export type { AgentConfigEntry };

export const AGENT_CONFIG_RELATIVE_PATH = path.join('.acp', 'acp-agents.json');
export const SANDCASTLE_CONFIG_RELATIVE_PATH = path.join('.acp', '.sandcastle', 'config.json');

export function isSandcastleAgentConfig(
  config: AgentConfigEntry,
): config is SandcastleAgentConfigEntry {
  return config.transport === 'sandcastle';
}

/**
 * Read native and Sandcastle agent configurations from the canonical workspace-root files.
 * Returns a map of agent name → config.
 */
export function getAgentConfigs(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
): Record<string, AgentConfigEntry> {
  const catalog = loadAgentCatalog(workspaceCwd);
  for (const error of catalog.errors) {
    log(`Ignoring invalid ACP agent configuration: ${error}`);
  }
  return catalog.agents;
}

export function getAgentConfigPath(workspaceCwd: string = resolveWorkspaceIdentity().cwd): string {
  return path.join(workspaceCwd, AGENT_CONFIG_RELATIVE_PATH);
}

export function parseAgentConfigJson(
  text: string,
  filePath = AGENT_CONFIG_RELATIVE_PATH,
): Record<string, AgentConfigEntry> {
  const config = parseAcpConfig(text, filePath);
  for (const error of config.errors) {
    log(`Ignoring invalid ACP agent config ${filePath}: ${error}`);
  }
  return config.agents;
}

export function parseSandcastleConfigJson(
  text: string,
  filePath = SANDCASTLE_CONFIG_RELATIVE_PATH,
): Record<string, AgentConfigEntry> {
  const config = parseSandcastleConfig(text, filePath);
  for (const error of config.errors) {
    log(`Ignoring invalid Sandcastle config ${filePath}: ${error}`);
  }
  return config.agents;
}

export async function writeAgentConfigs(
  agents: Record<string, AgentConfigEntry>,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
): Promise<void> {
  const filePath = getAgentConfigPath(workspaceCwd);
  const nativeAgents: Record<string, AgentConfigEntry> = {};
  const sandcastleAgents: Record<string, AgentConfigEntry> = {};
  for (const [name, entry] of Object.entries(agents)) {
    (isSandcastleAgentConfig(entry) ? sandcastleAgents : nativeAgents)[name] = entry;
  }
  const sandcastlePath = path.join(workspaceCwd, SANDCASTLE_CONFIG_RELATIVE_PATH);
  const nativeEnvelope = readJsonObject(filePath);
  const sandcastleEnvelope = readJsonObject(sandcastlePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.mkdir(path.dirname(sandcastlePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify({ ...nativeEnvelope, agents: nativeAgents }, null, 2)}\n`, 'utf8');
  await fs.promises.writeFile(sandcastlePath, `${JSON.stringify({ ...sandcastleEnvelope, agents: sandcastleAgents }, null, 2)}\n`, 'utf8');
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

/** Get the list of agent names available. */
export function getAgentNames(
  workspaceCwd?: string,
  agentConfigs: Record<string, AgentConfigEntry> = getAgentConfigs(workspaceCwd),
): string[] {
  return listSelectableAgentNames(workspaceCwd, agentConfigs);
}

/** Get a specific agent config by name. */
export function getAgentConfig(
  name: string,
  workspaceCwd?: string,
): AgentConfigEntry | undefined {
  return getAgentConfigs(workspaceCwd)[name];
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
