import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NativeAcpAgentConfig, PiAcpConfig } from '../types.js';

const CONFIG_PATH = path.join('.pi', 'acp-agents.json');
const DEFAULT_INSTRUCTIONS_MAX_BYTES = 256 * 1024;

export function loadPiAcpConfig(workspaceCwd: string): PiAcpConfig {
  const filePath = path.join(workspaceCwd, CONFIG_PATH);
  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      agents: {},
      pipeline: {
        enabled: true,
        instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
      },
      errors: [`Missing Pi ACP config: ${CONFIG_PATH}`],
    };
  }

  try {
    return parsePiAcpConfig(fs.readFileSync(filePath, 'utf8'), filePath);
  } catch (e: unknown) {
    return {
      filePath,
      agents: {},
      pipeline: {
        enabled: true,
        instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
      },
      errors: [`Failed to read Pi ACP config: ${formatError(e)}`],
    };
  }
}

export function parsePiAcpConfig(text: string, filePath = CONFIG_PATH): PiAcpConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e: unknown) {
    return emptyConfig(filePath, [`JSON parse error: ${formatError(e)}`]);
  }

  if (!isRecord(parsed)) {
    return emptyConfig(filePath, ['Pi ACP config must be an object.']);
  }

  const errors: string[] = [];
  const agents: Record<string, NativeAcpAgentConfig> = {};
  const agentsValue = parsed.agents;

  if (!isRecord(agentsValue)) {
    errors.push('agents must be an object.');
  } else {
    for (const [name, value] of Object.entries(agentsValue)) {
      const agent = parseAgent(name, value, errors);
      if (agent) {
        agents[name] = agent;
      }
    }
  }

  const pipeline = parsePipelineConfig(parsed.pipeline, errors);

  return {
    filePath,
    agents,
    pipeline,
    errors,
  };
}

function emptyConfig(filePath: string, errors: string[]): PiAcpConfig {
  return {
    filePath,
    agents: {},
    pipeline: {
      enabled: true,
      instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
    },
    errors,
  };
}

function parseAgent(
  name: string,
  value: unknown,
  errors: string[],
): NativeAcpAgentConfig | null {
  if (!isRecord(value)) {
    errors.push(`agents.${name} must be an object.`);
    return null;
  }

  if (value.transport === 'sandcastle') {
    errors.push(`agents.${name} uses transport "sandcastle", which is not supported by the Pi plugin v1.`);
    return null;
  }

  if (value.transport !== undefined && value.transport !== 'acp') {
    errors.push(`agents.${name}.transport must be "acp" when provided.`);
    return null;
  }

  if (typeof value.command !== 'string' || value.command.trim().length === 0) {
    errors.push(`agents.${name}.command must be a non-empty string.`);
    return null;
  }

  const args = value.args === undefined ? undefined : readStringArray(value.args, `agents.${name}.args`, errors);
  const env = value.env === undefined ? undefined : readStringRecord(value.env, `agents.${name}.env`, errors);
  if (args === null || env === null) {
    return null;
  }

  return {
    transport: value.transport === 'acp' ? 'acp' : undefined,
    command: value.command.trim(),
    args,
    env,
    displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
    use_idea_mcp: typeof value.use_idea_mcp === 'boolean' ? value.use_idea_mcp : undefined,
    use_custom_mcp: typeof value.use_custom_mcp === 'boolean' ? value.use_custom_mcp : undefined,
    skills: typeof value.skills === 'boolean' ? value.skills : undefined,
  };
}

function parsePipelineConfig(value: unknown, errors: string[]) {
  if (value === undefined) {
    return {
      enabled: true,
      instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
    };
  }

  if (!isRecord(value)) {
    errors.push('pipeline must be an object when provided.');
    return {
      enabled: true,
      instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
    };
  }

  const enabled = value.enabled === undefined
    ? true
    : typeof value.enabled === 'boolean'
      ? value.enabled
      : (() => {
          errors.push('pipeline.enabled must be a boolean.');
          return true;
        })();

  const instructionsMaxBytes = value.instructionsMaxBytes === undefined
    ? DEFAULT_INSTRUCTIONS_MAX_BYTES
    : typeof value.instructionsMaxBytes === 'number'
      && Number.isInteger(value.instructionsMaxBytes)
      && value.instructionsMaxBytes > 0
        ? value.instructionsMaxBytes
        : (() => {
            errors.push('pipeline.instructionsMaxBytes must be a positive integer.');
            return DEFAULT_INSTRUCTIONS_MAX_BYTES;
          })();

  return { enabled, instructionsMaxBytes };
}

function readStringArray(value: unknown, scope: string, errors: string[]): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    errors.push(`${scope} must be an array of strings.`);
    return null;
  }
  return value;
}

function readStringRecord(value: unknown, scope: string, errors: string[]): Record<string, string> | null {
  if (!isRecord(value)) {
    errors.push(`${scope} must be an object of string values.`);
    return null;
  }
  const result: Record<string, string> = {};
  for (const [key, recordValue] of Object.entries(value)) {
    if (typeof recordValue !== 'string') {
      errors.push(`${scope}.${key} must be a string.`);
      return null;
    }
    result[key] = recordValue;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
