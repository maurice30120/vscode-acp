import type { AgentProvider } from '@ai-hero/sandcastle';

export interface VibeProviderOptions {
  env?: Record<string, string>;
}

export function createVibeProvider(
  model: string,
  options: VibeProviderOptions = {},
): AgentProvider {
  return {
    name: 'vibe',
    env: {
      ...(options.env ?? {}),
      VIBE_ACTIVE_MODEL: model,
      VIBE_HOME: '/home/agent/.vibe',
    },
    captureSessions: false,
    buildPrintCommand({ prompt }) {
      return {
        command: `vibe --prompt ${shellEscape(prompt)} --output streaming --trust`,
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

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function parseVibeStreamLine(line: string): ReturnType<AgentProvider['parseStreamLine']> {
  if (!line.startsWith('{')) {
    return [];
  }
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const role = obj.role;
    const content = typeof obj.content === 'string' ? obj.content : undefined;
    const reasoningContent = typeof obj.reasoning_content === 'string' ? obj.reasoning_content : undefined;
    if (role === 'assistant') {
      if (content) {
        return [
          { type: 'text', text: content },
          { type: 'result', result: content },
        ];
      }
      if (reasoningContent) {
        return [{ type: 'text', text: reasoningContent }];
      }
    }
    if (typeof obj.session_id === 'string') {
      return [{ type: 'session_id', sessionId: obj.session_id }];
    }
  } catch {
    return [];
  }
  return [];
}
