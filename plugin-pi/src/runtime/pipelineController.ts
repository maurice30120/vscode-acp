import { randomUUID } from 'node:crypto';

import {
  PipelineService,
  type PipelineDefinition,
  type PipelineAgentRunner,
  type PipelinePlanReadyEvent,
  type PipelineSessionUpdateEvent,
  type PipelineStatusEvent,
} from '@acp-client/pipeline';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SessionNotification } from '@agentclientprotocol/sdk';

import { EphemeralAcpRunner } from '../acp/ephemeralRunner.js';
import { RunAbortedError } from '../acp/runAbortedError.js';
import { loadPiAcpConfig } from '../catalog/config.js';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
} from '../catalog/pipelineCatalog.js';
import type { Logger, PiPermissionContext } from '../types.js';

export interface PipelineControllerOptions {
  logger?: Logger;
  runner?: { run: PipelineAgentRunner };
  heartbeatIntervalMs?: number;
}

export interface PipelineRunCommandResult {
  sessionId: string;
  plan?: string;
  output?: string;
  awaitingApproval: boolean;
}

export class PipelineController {
  private readonly service: PipelineService;
  private readonly runner: { run: PipelineAgentRunner };
  private readonly heartbeatIntervalMs: number;
  private permissionContext: PiPermissionContext | undefined;
  private pendingPlan: PipelinePlanReadyEvent | null = null;
  private activeSessionId: string | null = null;
  private lastStatuses: PipelineStatusEvent[] = [];
  private verbose = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt = 0;
  private lastActivityLabel = 'pipeline activity';

  constructor(
    private readonly workspaceCwd: string,
    private readonly pi: Pick<ExtensionAPI, 'sendMessage'>,
    private readonly options: PipelineControllerOptions = {},
  ) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.runner = options.runner ?? new EphemeralAcpRunner(workspaceCwd, {
      getPermissionContext: () => this.permissionContext,
      logger: options.logger,
    });
    this.service = new PipelineService(
      () => this.workspaceCwd,
      {
        getPipelineDefinitions: () => getPipelineDefinitions(this.workspaceCwd, this.options.logger),
        getPipelineDefinitionForAgent: agentName =>
          getPipelineDefinitionForAgent(this.workspaceCwd, agentName, this.options.logger),
        getAgentConfigs: () => loadPiAcpConfig(this.workspaceCwd).agents,
        runAgent: this.runner.run,
        isRunAbortedError: error => error instanceof RunAbortedError,
      },
    );

    this.service.on('plan-ready', event => {
      this.pendingPlan = event;
      this.activeSessionId = event.sessionId;
      this.sendDisplayMessage('ACP Pipeline Plan', event.plan, {
        kind: 'plan-ready',
        sessionId: event.sessionId,
        stepId: event.stepId,
        revised: event.revised ?? false,
      });
    });

    this.service.on('status', event => {
      this.lastStatuses.push(event);
      this.options.logger?.log(`${event.status}: ${event.message}`);
      this.handleStatusEvent(event);
    });

    this.service.on('session-update', event => {
      this.handleSessionUpdateEvent(event);
    });
  }

  listPipelines(): PipelineDefinition[] {
    return getPipelineDefinitions(this.workspaceCwd, this.options.logger);
  }

  formatPipelineList(): string {
    const definitions = this.listPipelines();
    if (definitions.length === 0) {
      return 'No ACP pipelines found.';
    }
    return definitions
      .map(definition => `- [${definition.id}] ${definition.title}`)
      .join('\n');
  }

  async runPipeline(
    pipelineName: string,
    prompt: string,
    ctx?: ExtensionContext | ExtensionCommandContext,
  ): Promise<PipelineRunCommandResult> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Pipeline prompt is required.');
    }

    this.permissionContext = ctx;
    const sessionId = randomUUID();
    this.activeSessionId = sessionId;
    this.pendingPlan = null;
    this.startHeartbeat(sessionId);

    try {
      const output = await this.service.createPlan(sessionId, trimmedPrompt, pipelineName || undefined);
      const pendingPlan = this.pendingPlan as PipelinePlanReadyEvent | null;
      const awaitingApproval = pendingPlan?.sessionId === sessionId;
      if (!awaitingApproval) {
        this.sendDisplayMessage('ACP Pipeline Completed', output || 'Pipeline completed.', {
          kind: 'completed',
          sessionId,
        });
      }
      return {
        sessionId,
        plan: awaitingApproval ? output : undefined,
        output: awaitingApproval ? undefined : output,
        awaitingApproval,
      };
    } finally {
      this.permissionContext = undefined;
      if (!this.pendingPlan) {
        this.activeSessionId = null;
        this.stopHeartbeat();
      }
    }
  }

  async approve(ctx?: ExtensionContext | ExtensionCommandContext, approvedPlan?: string): Promise<string> {
    if (!this.pendingPlan) {
      throw new Error('No pending pipeline plan to approve.');
    }

    this.permissionContext = ctx;
    const sessionId = this.pendingPlan.sessionId;
    const plan = approvedPlan?.trim() || this.pendingPlan.plan;
    this.pendingPlan = null;
    this.startHeartbeat(sessionId);

    try {
      const output = await this.service.approvePlan(sessionId, plan);
      this.sendDisplayMessage('ACP Pipeline Completed', output || 'Pipeline completed.', {
        kind: 'completed',
        sessionId,
      });
      return output;
    } finally {
      this.permissionContext = undefined;
      this.activeSessionId = null;
      this.stopHeartbeat();
    }
  }

  reject(): void {
    if (!this.pendingPlan) {
      throw new Error('No pending pipeline plan to reject.');
    }
    const sessionId = this.pendingPlan.sessionId;
    this.service.rejectPlan(sessionId);
    this.pendingPlan = null;
    this.activeSessionId = null;
    this.stopHeartbeat();
  }

  cancel(): void {
    if (!this.activeSessionId) {
      throw new Error('No active pipeline run to cancel.');
    }
    this.service.cancel(this.activeSessionId);
    this.pendingPlan = null;
    this.activeSessionId = null;
    this.stopHeartbeat();
  }

  getLastStatuses(): PipelineStatusEvent[] {
    return [...this.lastStatuses];
  }

  setVerbose(enabled: boolean): void {
    this.verbose = enabled;
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  dispose(): Promise<void> {
    this.stopHeartbeat();
    return this.service.dispose();
  }

  private sendDisplayMessage(title: string, content: string, details: Record<string, unknown>): void {
    this.pi.sendMessage({
      customType: 'acp-pipeline',
      content: `## ${title}\n\n${content}`,
      display: true,
      details,
    });
  }

  private handleStatusEvent(event: PipelineStatusEvent): void {
    if (event.sessionId !== this.activeSessionId) {
      return;
    }

    this.lastActivityAt = Date.now();
    this.lastActivityLabel = this.formatActivityLabel(event);
    this.sendDisplayMessage('ACP Pipeline Activity', this.formatStatusMessage(event), {
      kind: 'activity-status',
      ...event,
    });

    if (this.verbose) {
      this.sendDisplayMessage('ACP Pipeline Verbose Status', this.formatVerboseStatus(event), {
        kind: 'verbose-status',
        event,
      });
    }

    if (this.isTerminalStatus(event.status) || event.status === 'awaiting_approval') {
      this.stopHeartbeat();
    }
  }

  private handleSessionUpdateEvent(event: PipelineSessionUpdateEvent): void {
    if (event.sessionId !== this.activeSessionId || !this.verbose) {
      return;
    }

    this.lastActivityAt = Date.now();
    this.lastActivityLabel = this.formatActivityLabel(event);
    this.sendDisplayMessage('ACP Pipeline Verbose Update', this.formatSessionUpdateMessage(event), {
      kind: 'verbose-session-update',
      sessionId: event.sessionId,
      phase: event.phase,
      stepId: event.stepId,
      branchId: event.branchId,
      role: event.role,
      agentName: event.agentName,
      teamId: event.teamId,
      update: event.update,
    });
  }

  private startHeartbeat(sessionId: string): void {
    this.stopHeartbeat();
    this.lastActivityAt = Date.now();
    this.lastActivityLabel = 'pipeline activity';
    this.heartbeatTimer = setInterval(() => {
      if (!this.activeSessionId || this.activeSessionId !== sessionId) {
        this.stopHeartbeat();
        return;
      }
      const idleMs = Date.now() - this.lastActivityAt;
      if (idleMs < this.heartbeatIntervalMs) {
        return;
      }
      this.lastActivityAt = Date.now();
      this.sendDisplayMessage(
        'ACP Pipeline Activity',
        `Still running: ${this.lastActivityLabel}.`,
        {
          kind: 'activity-heartbeat',
          sessionId,
          lastActivityLabel: this.lastActivityLabel,
        },
      );
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private formatStatusMessage(event: PipelineStatusEvent): string {
    const parts = [this.formatActivityLabel(event), event.status.replace(/_/g, ' ')];
    return `${parts.filter(Boolean).join(' — ')}\n\n${event.message}`;
  }

  private formatVerboseStatus(event: PipelineStatusEvent): string {
    return `${this.formatStatusMessage(event)}\n\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``;
  }

  private formatSessionUpdateMessage(event: PipelineSessionUpdateEvent): string {
    const text = this.extractSessionUpdateText(event.update);
    const label = this.formatActivityLabel(event);
    const updateKind = event.update.update.sessionUpdate;
    const preview = text ? `\n\n${text}` : '';
    return `${label} — ${event.phase} — ${updateKind}${preview}`;
  }

  private extractSessionUpdateText(update: SessionNotification): string {
    const updateData = update.update;
    if (updateData.sessionUpdate !== 'agent_message_chunk') {
      return '';
    }
    const content = updateData.content;
    if (content.type !== 'text') {
      return '';
    }
    return content.text.trim();
  }

  private formatActivityLabel(event: Pick<PipelineStatusEvent | PipelineSessionUpdateEvent, 'stepId' | 'branchId' | 'role' | 'agentName'>): string {
    const scope = event.branchId
      ? `${event.stepId ?? 'step'}:${event.branchId}`
      : event.stepId ?? 'pipeline';
    const actor = event.agentName ?? event.role;
    return actor ? `${scope} (${actor})` : scope;
  }

  private isTerminalStatus(status: PipelineStatusEvent['status']): boolean {
    return status === 'completed'
      || status === 'rejected'
      || status === 'error'
      || status === 'cancelled';
  }
}
