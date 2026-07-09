import type { ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';

export interface NativeAcpAgentConfig {
  transport?: 'acp';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  displayName?: string;
  use_idea_mcp?: boolean;
  use_custom_mcp?: boolean;
  skills?: boolean;
}

export interface UnsupportedSandcastleAgentConfig {
  transport: 'sandcastle';
  provider?: string;
  model?: string;
  env?: Record<string, string>;
}

export type PiAgentConfigEntry = NativeAcpAgentConfig | UnsupportedSandcastleAgentConfig;

export interface PiPipelineConfig {
  enabled: boolean;
  instructionsMaxBytes: number;
}

export interface PiAcpConfig {
  filePath: string;
  agents: Record<string, NativeAcpAgentConfig>;
  pipeline: PiPipelineConfig;
  errors: string[];
}

export type PiPermissionContext = Pick<ExtensionContext, 'hasUI' | 'ui'> | Pick<ExtensionCommandContext, 'hasUI' | 'ui'>;

export interface Logger {
  log(message: string): void;
  error(message: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  log(message) {
    console.log(`[acp-pi] ${message}`);
  },
  error(message, error) {
    if (error === undefined) {
      console.error(`[acp-pi] ${message}`);
    } else {
      console.error(`[acp-pi] ${message}`, error);
    }
  },
};
