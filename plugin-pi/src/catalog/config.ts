import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  AGENT_CONFIG_RELATIVE_PATH,
  DEFAULT_INSTRUCTIONS_MAX_BYTES,
  parseAcpAgentConfigCatalog,
} from '@acp-client/pipeline';
import type {
  PiAcpConfig,
  PiAgentCatalog,
  SandcastleConfig,
} from '../types.js';

const CONFIG_PATH = AGENT_CONFIG_RELATIVE_PATH;

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
  return parseAgentConfigText(text, filePath).native;
}

export function loadPiAgentCatalog(workspaceCwd: string): PiAgentCatalog {
  const filePath = path.join(workspaceCwd, CONFIG_PATH);
  if (!fs.existsSync(filePath)) {
    const native = emptyConfig(filePath, [`Missing Pi ACP config: ${CONFIG_PATH}`]);
    return {
      native,
      sandcastle: emptySandcastleConfig(filePath, []),
      agents: {},
      errors: native.errors,
    };
  }

  try {
    return parseAgentConfigText(fs.readFileSync(filePath, 'utf8'), filePath);
  } catch (e: unknown) {
    const native = emptyConfig(filePath, [`Failed to read Pi ACP config: ${formatError(e)}`]);
    return {
      native,
      sandcastle: emptySandcastleConfig(filePath, []),
      agents: {},
      errors: native.errors,
    };
  }
}

function parseAgentConfigText(text: string, filePath: string): PiAgentCatalog {
  const catalog = parseAcpAgentConfigCatalog(text);

  const native: PiAcpConfig = {
    filePath,
    agents: catalog.nativeAgents,
    pipeline: catalog.pipeline,
    errors: catalog.errors,
  };

  const sandcastle: SandcastleConfig = {
    filePath,
    promotion: catalog.promotion,
    agents: catalog.sandcastleAgents,
    errors: catalog.errors,
  };

  return {
    native,
    sandcastle,
    agents: catalog.agents,
    errors: catalog.errors,
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

function emptySandcastleConfig(filePath: string, errors: string[]): SandcastleConfig {
  return {
    filePath,
    promotion: 'ask',
    agents: {},
    errors,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
