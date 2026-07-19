import {
  createDockerSandboxProvider,
  prepareCodexHome,
} from '@acp-client/sandcastle';
import {
  codex,
  createSandbox,
  cursor,
  pi,
} from '@ai-hero/sandcastle';

import type { BridgeConfig } from './BridgeConfig';
import type { SandcastleRuntime } from './SandcastleAcpAgent';
import { createVibeProvider } from './VibeProvider';

export { prepareCodexHome };

/** Runtime Sandcastle par défaut : sandbox Docker, providers Codex/Cursor et montages d'auth Codex. */
export const defaultSandcastleRuntime: SandcastleRuntime = {
  createSandbox,
  createProvider(config: BridgeConfig) {
    if (config.provider === 'codex') {
      return codex(config.model, {
        effort: config.effort,
        env: config.env,
        captureSessions: false,
      });
    }
    if (config.provider === 'pi') {
      return pi(config.model, {
        thinking: config.effort,
        env: config.env,
        captureSessions: false,
      });
    }
    if (config.provider === 'vibe') {
      return createVibeProvider(config.model, {
        env: config.env,
      });
    }
    return cursor(config.model);
  },
  createSandboxProvider(config: BridgeConfig, cwd: string, branch?: string) {
    return createDockerSandboxProvider(config, cwd, branch);
  },
};
