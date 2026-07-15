import {
  codex,
  createSandbox,
  cursor,
  pi,
  type AgentProvider,
} from '@ai-hero/sandcastle';
import { docker } from '@ai-hero/sandcastle/sandboxes/docker';

import type { BridgeConfig } from './BridgeConfig.js';
import type { SandcastleRuntime } from './BridgeAgent.js';
import { buildSandboxMounts } from './SandboxMounts.js';

export { prepareCodexHome } from './SandboxMounts.js';

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
      return vibe(config.model, {
        env: config.env,
      });
    }
    return cursor(config.model);
  },
  createSandboxProvider(config: BridgeConfig, cwd: string) {
    return docker({
      imageName: config.imageName,
      cpus: 2,
      mounts: buildSandboxMounts(config, cwd),
    });
  },
};

interface VibeOptions {
  env?: Record<string, string>;
}

function vibe(model: string, options: VibeOptions = {}): AgentProvider {
  return {
    name: 'vibe',
    env: {
      VIBE_ACTIVE_MODEL: model,
      ...(options.env ?? {}),
    },
    captureSessions: false,
    buildPrintCommand({ prompt }) {
      return {
        command: 'vibe -p --output streaming --trust',
        stdin: prompt,
      };
    },
    buildInteractiveArgs({ prompt }) {
      const args = ['vibe'];
      if (prompt) {
        args.push(prompt);
      }
      return args;
    },
    parseStreamLine(line) {
      return parseVibeStreamLine(line);
    },
  };
}

function parseVibeStreamLine(line: string): ReturnType<AgentProvider['parseStreamLine']> {
  if (!line.startsWith('{')) {
    return [];
  }
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const role = obj.role;
    const content = typeof obj.content === 'string' ? obj.content : undefined;
    if (role === 'assistant' && content) {
      return [
        { type: 'text', text: content },
        { type: 'result', result: content },
      ];
    }
    if (typeof obj.session_id === 'string') {
      return [{ type: 'session_id', sessionId: obj.session_id }];
    }
  } catch {
    return [];
  }
  return [];
}
