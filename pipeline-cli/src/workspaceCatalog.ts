import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  NativeAcpAgentConfig,
  PiAgentConfigEntry,
  SandcastleAgentConfig,
} from '@acp-client/pi-extension/host';

const CONFIG_PATH = path.join('.acp', 'acp-agents.json');
const SANDCASTLE_PROVIDERS = new Set(['codex', 'cursor', 'pi', 'vibe']);
const SANDCASTLE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

export interface WorkspaceAgentCatalog {
  filePath: string;
  agents: Record<string, PiAgentConfigEntry>;
  errors: string[];
}

/**
 * Loads the canonical workspace configuration used by the VS Code extension.
 *
 * The file is a flat map of agent names to native ACP or Sandcastle process
 * definitions. It deliberately does not understand the former Pi-specific
 * `{ agents, pipeline }` embedded catalog shape.
 */
export function loadWorkspaceAgentCatalog(workspaceCwd: string): WorkspaceAgentCatalog {
  const filePath = path.join(workspaceCwd, CONFIG_PATH);
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      agents: {},
      errors: [`Missing workspace ACP configuration: ${CONFIG_PATH}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error: unknown) {
    return {
      filePath,
      agents: {},
      errors: [`Unable to parse ${CONFIG_PATH}: ${formatError(error)}`],
    };
  }

  if (!isRecord(parsed)) {
    return {
      filePath,
      agents: {},
      errors: [`${CONFIG_PATH} must contain an object keyed by agent name.`],
    };
  }

  if (isRecord(parsed.agents)) {
    return {
      filePath,
      agents: {},
      errors: [
        `${CONFIG_PATH} uses the obsolete embedded catalog shape. `
          + 'Move each agent entry to the top level of the JSON object.',
      ],
    };
  }

  const agents: Record<string, PiAgentConfigEntry> = {};
  const errors: string[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    const config = parseAgent(name, value, errors);
    if (config) {
      agents[name] = config;
    }
  }

  return { filePath, agents, errors };
}

function parseAgent(
  name: string,
  value: unknown,
  errors: string[],
): PiAgentConfigEntry | null {
  if (!isRecord(value)) {
    errors.push(`Agent "${name}" must be an object.`);
    return null;
  }

  if (value.transport === 'sandcastle') {
    return parseSandcastleAgent(name, value, errors);
  }
  return parseNativeAgent(name, value, errors);
}

function parseNativeAgent(
  name: string,
  value: Record<string, unknown>,
  errors: string[],
): NativeAcpAgentConfig | null {
  if (value.transport !== undefined && value.transport !== 'acp') {
    errors.push(`Agent "${name}" transport must be "acp" or "sandcastle".`);
    return null;
  }
  const command = readNonEmptyString(value.command);
  if (!command) {
    errors.push(`Agent "${name}" command must be a non-empty string.`);
    return null;
  }
  const args = readStringArray(value.args, `Agent "${name}" args`, errors);
  const env = readStringRecord(value.env, `Agent "${name}" env`, errors);
  if (args === null || env === null) {
    return null;
  }

  return {
    transport: value.transport === 'acp' ? 'acp' : undefined,
    command,
    args: args ?? undefined,
    env: env ?? undefined,
    loginShell: typeof value.loginShell === 'boolean' ? value.loginShell : undefined,
    displayName: readOptionalString(value.displayName),
    use_idea_mcp: typeof value.use_idea_mcp === 'boolean' ? value.use_idea_mcp : undefined,
    use_custom_mcp: typeof value.use_custom_mcp === 'boolean' ? value.use_custom_mcp : undefined,
    skills: typeof value.skills === 'boolean' ? value.skills : undefined,
  };
}

function parseSandcastleAgent(
  name: string,
  value: Record<string, unknown>,
  errors: string[],
): SandcastleAgentConfig | null {
  const provider = readNonEmptyString(value.provider);
  const model = readNonEmptyString(value.model);
  if (!provider || !SANDCASTLE_PROVIDERS.has(provider)) {
    errors.push(`Agent "${name}" provider must be codex, cursor, pi, or vibe.`);
    return null;
  }
  if (!model) {
    errors.push(`Agent "${name}" model must be a non-empty string.`);
    return null;
  }

  const effort = readOptionalString(value.effort);
  if (effort && !SANDCASTLE_EFFORTS.has(effort)) {
    errors.push(`Agent "${name}" effort must be low, medium, high, or xhigh.`);
    return null;
  }
  const env = readStringRecord(value.env, `Agent "${name}" env`, errors);
  if (env === null) {
    return null;
  }

  const maxIterations = value.maxIterations;
  if (
    maxIterations !== undefined
    && (
      typeof maxIterations !== 'number'
      || !Number.isInteger(maxIterations)
      || maxIterations < 1
      || maxIterations > 20
    )
  ) {
    errors.push(`Agent "${name}" maxIterations must be an integer between 1 and 20.`);
    return null;
  }

  return {
    transport: 'sandcastle',
    provider: provider as SandcastleAgentConfig['provider'],
    model,
    effort: effort as SandcastleAgentConfig['effort'],
    maxIterations,
    displayName: readOptionalString(value.displayName),
    env: env ?? undefined,
    skills: typeof value.skills === 'boolean' ? value.skills : undefined,
  };
}

function readStringArray(
  value: unknown,
  scope: string,
  errors: string[],
): string[] | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    errors.push(`${scope} must be an array of strings.`);
    return null;
  }
  return [...value];
}

function readStringRecord(
  value: unknown,
  scope: string,
  errors: string[],
): Record<string, string> | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) {
    errors.push(`${scope} must be an object containing string values.`);
    return null;
  }
  return value as Record<string, string>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
