import type { PipelineAgentRunInput, PipelineAgentRunner } from '@acp-client/pipeline';
import type {
  ClientSideConnection,
  PromptResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';

import { SessionAuthHandler } from './authHandler.js';
import { defaultAcpConnector, type AcpConnector, type ConnectedAcpAgent } from './defaultConnector.js';
import { RunAbortedError } from './runAbortedError.js';
import { SessionUpdateHandler } from './sessionUpdateHandler.js';
import { loadPiAcpConfig } from '../catalog/config.js';
import type { Logger, NativeAcpAgentConfig, PiPermissionContext } from '../types.js';

export interface EphemeralAcpRunnerOptions {
  getAgentConfigs?: () => Record<string, NativeAcpAgentConfig>;
  getPermissionContext?: () => PiPermissionContext | undefined;
  connector?: AcpConnector;
  logger?: Logger;
}

export class EphemeralAcpRunner {
  private readonly connector: AcpConnector;

  constructor(
    private readonly workspaceCwd: string,
    private readonly options: EphemeralAcpRunnerOptions = {},
  ) {
    this.connector = options.connector ?? defaultAcpConnector;
  }

  run: PipelineAgentRunner = async (input: PipelineAgentRunInput) => {
    const result = await this.runAgent(input);
    return { text: result.text };
  };

  async runAgent(input: PipelineAgentRunInput): Promise<{ text: string }> {
    const config = this.readAgentConfig(input.agentName);
    const sessionUpdateHandler = new SessionUpdateHandler();
    let connected: ConnectedAcpAgent | null = null;
    let sessionId: string | null = null;
    let collectedText = '';
    let disposed = false;

    const dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      connected?.dispose();
    };

    const throwIfAborted = (): void => {
      if (input.signal?.aborted) {
        throw new RunAbortedError();
      }
    };

    const onAbort = (): void => {
      void (async () => {
        if (sessionId && connected) {
          try {
            await connected.connInfo.connection.cancel({ sessionId });
          } catch (e: unknown) {
            this.options.logger?.error('Ephemeral ACP cancel failed', e);
          }
        }
        dispose();
      })();
    };

    input.signal?.addEventListener('abort', onAbort, { once: true });

    const listener = (update: SessionNotification) => {
      if (sessionId && update.sessionId !== sessionId) {
        return;
      }

      const updateData = update.update;
      if (updateData.sessionUpdate === 'agent_message_chunk') {
        const content = updateData.content;
        if (content.type === 'text') {
          collectedText += content.text;
        }
      }

      input.onSessionUpdate?.(update);
    };
    sessionUpdateHandler.addListener(listener);

    try {
      throwIfAborted();
      connected = await this.connector({
        agentName: input.agentName,
        config,
        workspaceCwd: input.workspaceCwd,
        sessionUpdateHandler,
        getPermissionContext: this.options.getPermissionContext ?? (() => undefined),
        logger: this.options.logger,
      });
      throwIfAborted();

      const session = await this.createSessionWithAuth(
        input.agentName,
        connected.agentId,
        connected,
        input.workspaceCwd,
        throwIfAborted,
      );
      sessionId = session.sessionId;
      throwIfAborted();

      const response = await connected.connInfo.connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text: input.promptText }],
      });
      this.throwIfCancelled(response, input.signal);
      return { text: collectedText.trim() };
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
      sessionUpdateHandler.removeListener(listener);
      dispose();
    }
  }

  private readAgentConfig(agentName: string): NativeAcpAgentConfig {
    const configs = this.options.getAgentConfigs?.() ?? loadPiAcpConfig(this.workspaceCwd).agents;
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Agent "${agentName}" is not configured in .pi/acp-agents.json.`);
    }
    return config;
  }

  private async createSessionWithAuth(
    agentName: string,
    agentId: string,
    connected: ConnectedAcpAgent,
    workspaceCwd: string,
    throwIfAborted: () => void,
  ): Promise<{ sessionId: string }> {
    throwIfAborted();
    try {
      return await connected.connInfo.connection.newSession({ cwd: workspaceCwd, mcpServers: [] });
    } catch (e: unknown) {
      const authHandler = new SessionAuthHandler(
        () => connected.dispose(),
        this.options.getPermissionContext ?? (() => undefined),
      );
      if (!authHandler.isAuthRequiredError(e)) {
        throw e;
      }
      await authHandler.runAuthFlow(agentName, agentId, connected.connInfo);
      throwIfAborted();
      return connected.connInfo.connection.newSession({ cwd: workspaceCwd, mcpServers: [] });
    }
  }

  private throwIfCancelled(response: PromptResponse, signal: AbortSignal | undefined): void {
    if (signal?.aborted || response.stopReason === 'cancelled') {
      throw new RunAbortedError();
    }
  }
}

export type MinimalAcpConnection = Pick<ClientSideConnection, 'newSession' | 'prompt' | 'cancel' | 'authenticate'>;
