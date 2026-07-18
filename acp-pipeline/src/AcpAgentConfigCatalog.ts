export const AGENT_CONFIG_RELATIVE_PATH = '.acp/acp-agents.json';
export const DEFAULT_INSTRUCTIONS_MAX_BYTES = 256 * 1024;

export interface AcpAgentConfigEntry {
  transport?: 'acp';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  loginShell?: boolean;
  displayName?: string;
  use_idea_mcp?: boolean;
  use_custom_mcp?: boolean;
  skills?: boolean;
}

export type SandcastleProvider = 'codex' | 'cursor' | 'pi' | 'vibe';
export type SandcastleEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type SandcastlePromotion = 'ask' | 'autoApply' | 'autoReject';

export interface SandcastleAgentConfigEntry {
  transport: 'sandcastle';
  provider: SandcastleProvider;
  model: string;
  displayName?: string;
  env?: Record<string, string>;
  effort?: SandcastleEffort;
  maxIterations?: number;
  skills?: boolean;
}

export type AgentConfigEntry = AcpAgentConfigEntry | SandcastleAgentConfigEntry;

export interface AcpPipelineRuntimeConfig {
  enabled: boolean;
  instructionsMaxBytes: number;
}

export interface AcpAgentConfigCatalog {
  nativeAgents: Record<string, AcpAgentConfigEntry>;
  sandcastleAgents: Record<string, SandcastleAgentConfigEntry>;
  agents: Record<string, AgentConfigEntry>;
  pipeline: AcpPipelineRuntimeConfig;
  promotion: SandcastlePromotion;
  errors: string[];
}

const SANDCASTLE_PROVIDERS = new Set<string>(['codex', 'cursor', 'pi', 'vibe']);
const SANDCASTLE_EFFORTS = new Set<string>(['low', 'medium', 'high', 'xhigh']);
const MIN_SANDCASTLE_MAX_ITERATIONS = 1;
const MAX_SANDCASTLE_MAX_ITERATIONS = 20;

export function parseAcpAgentConfigCatalog(text: string): AcpAgentConfigCatalog {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return emptyCatalog([`JSON parse error: ${formatError(error)}`]);
  }

  if (!isRecord(parsed)) {
    return emptyCatalog(['ACP agent config must be an object.']);
  }

  const errors: string[] = [];
  const nativeAgents: Record<string, AcpAgentConfigEntry> = {};
  const sandcastleAgents: Record<string, SandcastleAgentConfigEntry> = {};
  const agents: Record<string, AgentConfigEntry> = {};

  for (const [name, value] of Object.entries(parsed)) {
    if (!isRecord(value)) {
      errors.push(`agents.${name} must be an object.`);
      continue;
    }

    if (value.transport === 'sandcastle') {
      const agent = parseSandcastleAgent(name, value, errors);
      if (agent) {
        sandcastleAgents[name] = agent;
        agents[name] = agent;
      }
      continue;
    }

    const agent = parseNativeAgent(name, value, errors);
    if (agent) {
      nativeAgents[name] = agent;
      agents[name] = agent;
    }
  }

  return {
    nativeAgents,
    sandcastleAgents,
    agents,
    pipeline: defaultPipelineConfig(),
    promotion: 'ask',
    errors,
  };
}

function emptyCatalog(errors: string[]): AcpAgentConfigCatalog {
  return {
    nativeAgents: {},
    sandcastleAgents: {},
    agents: {},
    pipeline: defaultPipelineConfig(),
    promotion: 'ask',
    errors,
  };
}

function defaultPipelineConfig(): AcpPipelineRuntimeConfig {
  return {
    enabled: true,
    instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
  };
}

function parseNativeAgent(
  name: string,
  value: Record<string, unknown>,
  errors: string[],
): AcpAgentConfigEntry | null {
  if (value.transport !== undefined && value.transport !== 'acp') {
    errors.push(`agents.${name}.transport must be "acp" or "sandcastle" when provided.`);
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

  return compactObject<AcpAgentConfigEntry>({
    transport: value.transport === 'acp' ? 'acp' as const : undefined,
    command: value.command.trim(),
    args,
    env,
    loginShell: typeof value.loginShell === 'boolean' ? value.loginShell : undefined,
    displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
    use_idea_mcp: typeof value.use_idea_mcp === 'boolean' ? value.use_idea_mcp : undefined,
    use_custom_mcp: typeof value.use_custom_mcp === 'boolean' ? value.use_custom_mcp : undefined,
    skills: typeof value.skills === 'boolean' ? value.skills : undefined,
  });
}

function parseSandcastleAgent(
  name: string,
  value: Record<string, unknown>,
  errors: string[],
): SandcastleAgentConfigEntry | null {
  const provider = readSandcastleProvider(value.provider, `agents.${name}.provider`, errors);
  const model = readNonEmptyString(value.model, `agents.${name}.model`, errors);
  const effort = value.effort === undefined
    ? undefined
    : readSandcastleEffort(value.effort, `agents.${name}.effort`, errors);
  const maxIterations = value.maxIterations === undefined
    ? undefined
    : readBoundedInteger(
      value.maxIterations,
      `agents.${name}.maxIterations`,
      MIN_SANDCASTLE_MAX_ITERATIONS,
      MAX_SANDCASTLE_MAX_ITERATIONS,
      errors,
    );
  const env = value.env === undefined ? undefined : readStringRecord(value.env, `agents.${name}.env`, errors);
  if (!provider || !model || effort === null || maxIterations === null || env === null) {
    return null;
  }

  return compactObject<SandcastleAgentConfigEntry>({
    transport: 'sandcastle' as const,
    provider,
    model,
    effort,
    maxIterations,
    displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
    env,
    skills: typeof value.skills === 'boolean' ? value.skills : undefined,
  });
}

function readSandcastleProvider(
  value: unknown,
  scope: string,
  errors: string[],
): SandcastleProvider | null {
  if (typeof value === 'string' && SANDCASTLE_PROVIDERS.has(value)) {
    return value as SandcastleProvider;
  }
  errors.push(`${scope} must be one of: ${[...SANDCASTLE_PROVIDERS].join(', ')}.`);
  return null;
}

function readSandcastleEffort(
  value: unknown,
  scope: string,
  errors: string[],
): SandcastleEffort | null {
  if (typeof value === 'string' && SANDCASTLE_EFFORTS.has(value)) {
    return value as SandcastleEffort;
  }
  errors.push(`${scope} must be one of: ${[...SANDCASTLE_EFFORTS].join(', ')}.`);
  return null;
}

function readBoundedInteger(
  value: unknown,
  scope: string,
  min: number,
  max: number,
  errors: string[],
): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  errors.push(`${scope} must be an integer between ${min} and ${max}.`);
  return null;
}

function readNonEmptyString(value: unknown, scope: string, errors: string[]): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${scope} must be a non-empty string.`);
    return null;
  }
  return value.trim();
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

function compactObject<T extends object>(value: Partial<T>): T {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
