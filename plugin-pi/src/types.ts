import type { ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';

export interface NativeAcpAgentConfig {
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

export interface UnsupportedSandcastleAgentConfig {
  transport: 'sandcastle';
  provider?: string;
  model?: string;
  env?: Record<string, string>;
}

export type SandcastleProvider = 'codex' | 'cursor' | 'pi' | 'vibe';
export type SandcastleEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type SandcastlePromotion = 'ask' | 'autoApply' | 'autoReject';

export interface SandcastleAgentConfig {
  transport: 'sandcastle';
  provider: SandcastleProvider;
  model: string;
  effort?: SandcastleEffort;
  displayName?: string;
  env?: Record<string, string>;
  skills?: boolean;
}

export type PiAgentConfigEntry = NativeAcpAgentConfig | SandcastleAgentConfig;

export interface PiTimeoutConfig {
  initializeMs?: number;
  newSessionMs?: number;
  authenticateMs?: number;
  promptMs?: number;
  permissionMs?: number;
  authUiMs?: number;
  promotionUiMs?: number;
}

export interface PiPipelineConfig {
  enabled: boolean;
  instructionsMaxBytes: number;
  timeouts?: PiTimeoutConfig;
}

export interface PiAcpConfig {
  filePath: string;
  agents: Record<string, NativeAcpAgentConfig>;
  pipeline: PiPipelineConfig;
  errors: string[];
}

export interface SandcastleConfig {
  filePath: string;
  promotion: SandcastlePromotion;
  agents: Record<string, SandcastleAgentConfig>;
  errors: string[];
}

export interface PiAgentCatalog {
  native: PiAcpConfig;
  sandcastle: SandcastleConfig;
  agents: Record<string, PiAgentConfigEntry>;
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
