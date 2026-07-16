import {
  PROTOCOL_VERSION,
  type Agent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from '@agentclientprotocol/sdk';
import type {
  AgentProvider,
  AgentStreamEvent,
  CreateSandboxOptions,
  Sandbox,
} from '@ai-hero/sandcastle';
import * as crypto from 'node:crypto';
import * as path from 'node:path';

import type { BridgeConfig } from './BridgeConfig.js';
import { enrichProviderRunError } from './ProviderRunError.js';
import { runGit } from './runGit.js';
import { applyWorktreeToHost, previewWorktreeChanges } from './WorktreePromotion.js';

interface BridgeSession {
  id: string;
  cwd: string;
  baseRef: string;
  branch: string;
  sandbox?: Sandbox;
  activeRun?: AbortController;
  notifications: Promise<void>;
}

export interface SandcastleRuntime {
  createSandbox(options: CreateSandboxOptions): Promise<Sandbox>;
  createProvider(config: BridgeConfig): AgentProvider;
  createSandboxProvider(config: BridgeConfig, cwd: string, branch?: string): CreateSandboxOptions['sandbox'];
}

export class SandcastleBridgeAgent implements Agent {
  private readonly sessions = new Map<string, BridgeSession>();
  private toolCallSequence = 0;

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly config: BridgeConfig,
    private readonly runtime: SandcastleRuntime,
  ) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: `Sandcastle ${this.config.provider}`,
        version: '0.1.0-pi',
      },
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        sessionCapabilities: {
          close: {},
        },
      },
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<Record<string, never>> {
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const id = crypto.randomUUID();
    const cwd = path.resolve(params.cwd);
    const branch = `sandcastle/acp/${this.config.provider}/${id}`;
    const baseRef = await runGit(cwd, ['rev-parse', 'HEAD']);
    const session: BridgeSession = {
      id,
      cwd,
      baseRef: baseRef.trim(),
      branch,
      notifications: Promise.resolve(),
    };
    this.sessions.set(id, session);

    try {
      await this.ensureSandbox(session);
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
    return { sessionId: id };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.requireSession(params.sessionId);
    if (session.activeRun) {
      throw new Error(`Session ${session.id} already has a prompt in progress.`);
    }

    const promptText = this.extractTextPrompt(params);
    const controller = new AbortController();
    session.activeRun = controller;
    let streamedText = false;

    try {
      const sandbox = await this.ensureSandbox(session);
      const result = await sandbox.run({
        agent: this.runtime.createProvider(this.config),
        prompt: promptText,
        maxIterations: this.config.maxIterations,
        signal: controller.signal,
        idleTimeoutSeconds: 600,
        name: `${this.config.provider}-${session.id.slice(0, 8)}`,
        logging: {
          type: 'file',
          path: path.join('.sandcastle', 'logs', `acp-${session.id}.log`),
          onAgentStreamEvent: event => {
            if (event.type === 'text' && event.message) {
              streamedText = true;
            }
            this.enqueueStreamEvent(session, event);
          },
        },
      });

      await session.notifications;
      if (!streamedText && result.stdout.trim()) {
        await this.sendText(session.id, result.stdout.trim());
      }
      return { stopReason: 'end_turn' };
    } catch (error) {
      if (controller.signal.aborted) {
        return { stopReason: 'cancelled' };
      }
      throw enrichProviderRunError(error, {
        provider: this.config.provider,
        cwd: session.cwd,
      });
    } finally {
      if (session.activeRun === controller) {
        session.activeRun = undefined;
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.activeRun?.abort(new Error('ACP prompt cancelled.'));
  }

  async closeSession(params: CloseSessionRequest): Promise<Record<string, never>> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      await this.discardSessionSandbox(session);
      this.sessions.delete(session.id);
    }
    return {};
  }

  async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    const session = this.requireSession(sessionId);

    switch (method) {
      case 'sandcastle/status':
        return {
          sessionId: session.id,
          provider: this.config.provider,
          model: this.config.model,
          branch: session.branch,
          baseRef: session.baseRef,
          active: Boolean(session.sandbox),
          running: Boolean(session.activeRun),
          worktreePath: session.sandbox?.worktreePath,
        };
      case 'sandcastle/preview': {
        const sandbox = await this.ensureSandbox(session);
        return {
          ...(await previewWorktreeChanges(
            sandbox.worktreePath,
            session.baseRef,
            session.branch,
          )),
        };
      }
      case 'sandcastle/apply': {
        const sandbox = await this.ensureSandbox(session);
        const preview = await previewWorktreeChanges(
          sandbox.worktreePath,
          session.baseRef,
          session.branch,
        );
        if (!preview.diff.trim()) {
          await this.discardSessionSandbox(session);
          return { success: true, filesChanged: 0, message: 'No changes to apply.' };
        }
        const result = await applyWorktreeToHost(session.cwd, preview);
        if (result.success) {
          await this.discardSessionSandbox(session);
        }
        return result;
      }
      case 'sandcastle/reject':
        await this.discardSessionSandbox(session);
        return { success: true, message: 'Sandcastle changes rejected.' };
      default:
        throw new Error(`Unsupported Sandcastle extension method: ${method}`);
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map(session => this.discardSessionSandbox(session)));
    this.sessions.clear();
  }

  private async ensureSandbox(session: BridgeSession): Promise<Sandbox> {
    if (session.sandbox) {
      return session.sandbox;
    }

    session.baseRef = (await runGit(session.cwd, ['rev-parse', 'HEAD'])).trim();
    session.branch = `sandcastle/acp/${this.config.provider}/${crypto.randomUUID()}`;
    session.sandbox = await this.runtime.createSandbox({
      cwd: session.cwd,
      branch: session.branch,
      baseBranch: session.baseRef,
      sandbox: this.runtime.createSandboxProvider(this.config, session.cwd, session.branch),
    });
    return session.sandbox;
  }

  private extractTextPrompt(params: PromptRequest): string {
    const textParts: string[] = [];
    for (const block of params.prompt) {
      if (block.type !== 'text') {
        throw new Error(`Sandcastle bridge only supports text prompts; received ${block.type}.`);
      }
      textParts.push(block.text);
    }
    const prompt = textParts.join('\n').trim();
    if (!prompt) {
      throw new Error('Sandcastle bridge requires a non-empty text prompt.');
    }
    return prompt;
  }

  private enqueueStreamEvent(session: BridgeSession, event: AgentStreamEvent): void {
    session.notifications = session.notifications.then(async () => {
      if (event.type === 'text') {
        await this.sendText(session.id, event.message);
        return;
      }
      if (event.type !== 'toolCall') {
        return;
      }
      const toolCallId = `sandcastle-tool-${++this.toolCallSequence}`;
      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: event.name,
          kind: 'other',
          status: 'completed',
          rawInput: event.formattedArgs,
        },
      });
    });
  }

  private async sendText(sessionId: string, text: string): Promise<void> {
    if (!text) {
      return;
    }
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    });
  }

  private async discardSessionSandbox(session: BridgeSession): Promise<void> {
    session.activeRun?.abort(new Error('Sandcastle session closed.'));
    const sandbox = session.sandbox;
    session.sandbox = undefined;
    if (!sandbox) {
      return;
    }

    try {
      await runGit(sandbox.worktreePath, ['reset', '--hard']);
      await runGit(sandbox.worktreePath, ['clean', '-fd']);
    } finally {
      await sandbox.close();
    }
  }

  private requireSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sandcastle session not found: ${sessionId || '(missing)'}`);
    }
    return session;
  }
}
