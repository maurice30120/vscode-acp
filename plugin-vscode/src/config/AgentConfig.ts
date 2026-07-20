import * as fs from 'fs';
import * as path from 'path';
import { listSelectableAgentNames } from './VirtualAgentCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { log } from '../utils/Logger';

/**
 * Configuration for a single ACP agent.
 */
export interface AcpAgentConfigEntry {
  /** Legacy entries omit transport and are treated as native ACP processes. */
  transport?: 'acp';
  /** NPX package to run (e.g., "@anthropic-ai/claude-code@latest") */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Display name */
  displayName?: string;
  /** Enable IDEA MCP server */
  use_idea_mcp?: boolean;
  /** Enable custom MCP server */
  use_custom_mcp?: boolean;
  /** When false, disables `.agents/skills` wiring for this agent. */
  skills?: boolean;
}

export interface SandcastleAgentConfigEntry {
  transport: 'sandcastle';
  provider: 'codex' | 'cursor' | 'pi' | 'vibe';
  model: string;
  displayName?: string;
  env?: Record<string, string>;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  maxIterations?: number;
  /** When false, disables `.agents/skills` wiring for this agent. */
  skills?: boolean;
}

export type AgentConfigEntry = AcpAgentConfigEntry | SandcastleAgentConfigEntry;

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
  const filePath = getAgentConfigPath(workspaceCwd);
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const nativeAgents = parseAgentConfigJson(fs.readFileSync(filePath, 'utf8'), filePath);
    const sandcastlePath = path.join(workspaceCwd, SANDCASTLE_CONFIG_RELATIVE_PATH);
    if (!fs.existsSync(sandcastlePath)) {
      return nativeAgents;
    }
    const sandcastleAgents = parseSandcastleConfigJson(fs.readFileSync(sandcastlePath, 'utf8'), sandcastlePath);
    for (const name of Object.keys(sandcastleAgents)) {
      if (nativeAgents[name]) {
        delete nativeAgents[name];
        delete sandcastleAgents[name];
        log(`Ignoring duplicate ACP agent "${name}" declared in both canonical config files.`);
      }
    }
    return { ...nativeAgents, ...sandcastleAgents };
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    log(`Ignoring invalid ACP agent config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }

  if (!isPlainObject(parsed)) {
    log(`Ignoring invalid ACP agent config ${filePath}: root value must be an object.`);
    return {};
  }

  if (!isPlainObject(parsed.agents)) {
    log(`Ignoring invalid ACP agent config ${filePath}: agents must be an object.`);
    return {};
  }
  const entries = parsed.agents;
  const agents: Record<string, AgentConfigEntry> = {};
  for (const [name, value] of Object.entries(entries)) {
    const entry = normalizeAgentConfigEntry(name, value, filePath);
    if (entry) {
      agents[name] = entry;
    }
  }

  return agents;
}

export function parseSandcastleConfigJson(
  text: string,
  filePath = SANDCASTLE_CONFIG_RELATIVE_PATH,
): Record<string, AgentConfigEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    log(`Ignoring invalid Sandcastle config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.agents)) {
    log(`Ignoring invalid Sandcastle config ${filePath}: agents must be an object.`);
    return {};
  }
  const agents: Record<string, AgentConfigEntry> = {};
  for (const [name, value] of Object.entries(parsed.agents)) {
    const entry = normalizeAgentConfigEntry(name, value, filePath);
    if (entry && isSandcastleAgentConfig(entry)) {
      agents[name] = entry;
    }
  }
  return agents;
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

function normalizeAgentConfigEntry(
  name: string,
  value: unknown,
  filePath: string,
): AgentConfigEntry | undefined {
  if (!isPlainObject(value)) {
    log(`Ignoring invalid ACP agent "${name}" in ${filePath}: entry must be an object.`);
    return undefined;
  }

  if (value.transport === 'sandcastle') {
    if (
      (value.provider !== 'codex' && value.provider !== 'cursor' && value.provider !== 'pi' && value.provider !== 'vibe')
      || typeof value.model !== 'string'
    ) {
      log(`Ignoring invalid Sandcastle agent "${name}" in ${filePath}: provider and model are required.`);
      return undefined;
    }
    if (
      value.maxIterations !== undefined
      && (
        typeof value.maxIterations !== 'number'
        || !Number.isInteger(value.maxIterations)
        || value.maxIterations < 1
        || value.maxIterations > 20
      )
    ) {
      log(`Ignoring invalid Sandcastle agent "${name}" in ${filePath}: maxIterations must be an integer between 1 and 20.`);
      return undefined;
    }
    return value as SandcastleAgentConfigEntry;
  }

  if (value.transport !== undefined && value.transport !== 'acp') {
    log(`Ignoring invalid ACP agent "${name}" in ${filePath}: unsupported transport "${String(value.transport)}".`);
    return undefined;
  }

  if (typeof value.command !== 'string' || value.command.length === 0) {
    log(`Ignoring invalid ACP agent "${name}" in ${filePath}: command is required.`);
    return undefined;
  }

  return value as AcpAgentConfigEntry;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
