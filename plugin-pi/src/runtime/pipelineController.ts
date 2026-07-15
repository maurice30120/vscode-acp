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
import { loadPiAgentCatalog } from '../catalog/config.js';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
} from '../catalog/pipelineCatalog.js';
import type { Logger, PiPermissionContext } from '../types.js';

export interface PipelineControllerOptions {
  logger?: Logger;
  runner?: { run: PipelineAgentRunner };
  heartbeatIntervalMs?: number;
  streamFlushDelayMs?: number;
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
  private readonly streamFlushDelayMs: number;
  private permissionContext: PiPermissionContext | undefined;
  private pendingPlan: PipelinePlanReadyEvent | null = null;
  private activeSessionId: string | null = null;
  private lastStatuses: PipelineStatusEvent[] = [];
  private verbose = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt = 0;
  private lastActivityLabel = 'pipeline activity';
  private activityStartedAt = 0;
  private lastSessionUpdateAt = 0;
  private sessionUpdateCount = 0;
  private agentTextChunkCount = 0;
  private agentThoughtChunkCount = 0;
  private lastSessionUpdateKind = '';
  private readonly streamBuffers = new Map<string, PipelineStreamBuffer>();

  constructor(
    private readonly workspaceCwd: string,
    private readonly pi: Pick<ExtensionAPI, 'sendMessage'>,
    private readonly options: PipelineControllerOptions = {},
  ) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.streamFlushDelayMs = options.streamFlushDelayMs ?? 350;
    this.runner = options.runner ?? new EphemeralAcpRunner(workspaceCwd, {
      getPermissionContext: () => this.permissionContext,
      getAgentConfigs: () => loadPiAgentCatalog(this.workspaceCwd).agents,
      getSandcastlePromotion: () => loadPiAgentCatalog(this.workspaceCwd).sandcastle.promotion,
      requestSandcastlePromotion: request => this.requestSandcastlePromotion(request),
      logger: options.logger,
    });
    this.service = new PipelineService(
      () => this.workspaceCwd,
      {
        getPipelineDefinitions: () => getPipelineDefinitions(this.workspaceCwd, this.options.logger),
        getPipelineDefinitionForAgent: agentName =>
          getPipelineDefinitionForAgent(this.workspaceCwd, agentName, this.options.logger),
        getAgentConfigs: () => loadPiAgentCatalog(this.workspaceCwd).agents,
        isAgentSandcastle: (agentName, agentConfigs) =>
          (agentConfigs[agentName] as { transport?: string } | undefined)?.transport === 'sandcastle',
        runAgent: this.runner.run,
        isRunAbortedError: error => error instanceof RunAbortedError,
      },
    );

    this.service.on('plan-ready', event => {
      this.flushSessionStreamBuffers(event.sessionId);
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
        this.flushSessionStreamBuffers(sessionId);
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
        this.flushSessionStreamBuffers(sessionId);
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
      this.flushSessionStreamBuffers(sessionId);
      this.sendDisplayMessage('ACP Pipeline Completed', output || 'Pipeline completed.', {
        kind: 'completed',
        sessionId,
      });
      return output;
    } finally {
      this.permissionContext = undefined;
      this.flushSessionStreamBuffers(sessionId);
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
    this.flushSessionStreamBuffers(sessionId);
    this.stopHeartbeat();
  }

  cancel(): void {
    if (!this.activeSessionId) {
      throw new Error('No active pipeline run to cancel.');
    }
    this.service.cancel(this.activeSessionId);
    this.pendingPlan = null;
    this.flushSessionStreamBuffers(this.activeSessionId);
    this.activeSessionId = null;
    this.stopHeartbeat();
  }

  getLastStatuses(): PipelineStatusEvent[] {
    return [...this.lastStatuses];
  }

  formatActivitySnapshot(): string {
    if (!this.activeSessionId) {
      const lastStatus = this.lastStatuses.at(-1);
      if (!lastStatus) {
        return 'No active pipeline run.';
      }
      return `No active pipeline run.\n\nLast status: ${lastStatus.status.replace(/_/g, ' ')} — ${lastStatus.message}`;
    }

    const lines = [
      `Active pipeline session: ${this.activeSessionId}`,
      `Current activity: ${this.lastActivityLabel}`,
      `Elapsed on current activity: ${this.formatDuration(Date.now() - this.activityStartedAt)}`,
      `Last pipeline event: ${this.formatDuration(Date.now() - this.lastActivityAt)} ago`,
      `Agent updates received: ${this.sessionUpdateCount}`,
      `Agent text chunks received: ${this.agentTextChunkCount}`,
      `Agent thought chunks received: ${this.agentThoughtChunkCount}`,
    ];
    if (this.lastSessionUpdateAt > 0) {
      lines.push(`Last agent update: ${this.formatDuration(Date.now() - this.lastSessionUpdateAt)} ago (${this.lastSessionUpdateKind || 'unknown'})`);
    } else {
      lines.push('Last agent update: none yet');
    }
    return lines.join('\n');
  }

  setVerbose(enabled: boolean): void {
    this.verbose = enabled;
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  dispose(): Promise<void> {
    this.stopHeartbeat();
    this.flushAllStreamBuffers();
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

  private async requestSandcastlePromotion(request: {
    agentName: string;
    sessionId: string;
    preview: {
      filesChanged: number;
      branch: string;
      baseRef: string;
      worktreePath: string;
    };
  }): Promise<'approve' | 'reject' | 'cancelled'> {
    const content = [
      `Agent: ${request.agentName}`,
      `Files changed: ${request.preview.filesChanged}`,
      `Branch: ${request.preview.branch || '(unknown)'}`,
      `Base: ${request.preview.baseRef || '(unknown)'}`,
    ].join('\n');
    this.sendDisplayMessage('ACP Pipeline Sandcastle Promotion', content, {
      kind: 'sandcastle-promotion',
      sessionId: request.sessionId,
      agentName: request.agentName,
      filesChanged: request.preview.filesChanged,
      branch: request.preview.branch,
      baseRef: request.preview.baseRef,
      worktreePath: request.preview.worktreePath,
    });

    const ctx = this.permissionContext;
    if (!ctx?.hasUI) {
      return 'cancelled';
    }

    const labels = ['Apply Sandcastle changes', 'Reject Sandcastle changes'];
    const selected = await ctx.ui.select('Sandcastle promotion', labels);
    if (selected === labels[0]) {
      return 'approve';
    }
    if (selected === labels[1]) {
      return 'reject';
    }
    return 'cancelled';
  }

  private handleStatusEvent(event: PipelineStatusEvent): void {
    if (event.sessionId !== this.activeSessionId) {
      return;
    }

    this.flushSessionStreamBuffers(event.sessionId);
    this.lastActivityAt = Date.now();
    this.lastActivityLabel = this.formatActivityLabel(event);
    this.activityStartedAt = this.lastActivityAt;
    this.lastSessionUpdateAt = 0;
    this.sessionUpdateCount = 0;
    this.agentTextChunkCount = 0;
    this.agentThoughtChunkCount = 0;
    this.lastSessionUpdateKind = '';
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
    if (event.sessionId !== this.activeSessionId) {
      return;
    }

    this.lastActivityAt = Date.now();
    this.lastSessionUpdateAt = this.lastActivityAt;
    this.lastActivityLabel = this.formatActivityLabel(event);
    this.sessionUpdateCount += 1;
    this.lastSessionUpdateKind = event.update.update.sessionUpdate;
    const textUpdate = this.extractSessionUpdateText(event.update);
    if (textUpdate?.kind === 'agent_message_chunk') {
      this.agentTextChunkCount += 1;
    }
    if (textUpdate?.kind === 'agent_thought_chunk') {
      this.agentThoughtChunkCount += 1;
    }

    if (textUpdate) {
      this.bufferStreamChunk(event, textUpdate);
      return;
    }

    if (!this.verbose) {
      return;
    }

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
    this.activityStartedAt = this.lastActivityAt;
    this.lastSessionUpdateAt = 0;
    this.sessionUpdateCount = 0;
    this.agentTextChunkCount = 0;
    this.agentThoughtChunkCount = 0;
    this.lastSessionUpdateKind = '';
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
        this.formatHeartbeatMessage(),
        {
          kind: 'activity-heartbeat',
          sessionId,
          lastActivityLabel: this.lastActivityLabel,
          activityElapsedMs: Date.now() - this.activityStartedAt,
          sessionUpdateCount: this.sessionUpdateCount,
          agentTextChunkCount: this.agentTextChunkCount,
          agentThoughtChunkCount: this.agentThoughtChunkCount,
          lastSessionUpdateKind: this.lastSessionUpdateKind || undefined,
          lastSessionUpdateAgoMs: this.lastSessionUpdateAt > 0 ? Date.now() - this.lastSessionUpdateAt : undefined,
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
    const preview = text ? `\n\n${text.text}` : '';
    return `${label} — ${event.phase} — ${updateKind}${preview}`;
  }

  private bufferStreamChunk(
    event: PipelineSessionUpdateEvent,
    textUpdate: ExtractedSessionText,
  ): void {
    const key = this.getStreamBufferKey(event, textUpdate);
    let buffer = this.streamBuffers.get(key);
    if (!buffer) {
      buffer = {
        key,
        sessionId: event.sessionId,
        title: this.formatStreamTitle(event, textUpdate),
        details: {
          kind: textUpdate.detailKind,
          sessionId: event.sessionId,
          phase: event.phase,
          stepId: event.stepId,
          branchId: event.branchId,
          role: event.role,
          agentName: event.agentName,
          teamId: event.teamId,
          updateKind: textUpdate.kind,
        },
        text: '',
        timer: null,
      };
      this.streamBuffers.set(key, buffer);
    }

    buffer.text += textUpdate.text;
    if (this.shouldFlushStreamBuffer(buffer.text)) {
      this.flushStreamBuffer(buffer);
      return;
    }

    if (buffer.timer) {
      return;
    }
    buffer.timer = setTimeout(() => {
      buffer.timer = null;
      this.flushStreamBuffer(buffer);
    }, this.streamFlushDelayMs);
  }

  private shouldFlushStreamBuffer(text: string): boolean {
    return text.length >= 800 || /\n\n$/.test(text) || /[.!?。！？]\s$/.test(text);
  }

  private flushSessionStreamBuffers(sessionId: string): void {
    for (const buffer of this.streamBuffers.values()) {
      if (buffer.sessionId === sessionId) {
        this.flushStreamBuffer(buffer);
      }
    }
  }

  private flushAllStreamBuffers(): void {
    for (const buffer of this.streamBuffers.values()) {
      this.flushStreamBuffer(buffer);
    }
  }

  private flushStreamBuffer(buffer: PipelineStreamBuffer): void {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const text = buffer.text;
    buffer.text = '';
    this.streamBuffers.delete(buffer.key);
    if (text.trim().length === 0) {
      return;
    }

    this.sendDisplayMessage(buffer.title, this.formatStreamChunkMessage(text), buffer.details);
  }

  private formatStreamChunkMessage(text: string): string {
    return this.normalizeStreamText(text);
  }

  private formatStreamTitle(
    event: PipelineSessionUpdateEvent,
    textUpdate: ExtractedSessionText,
  ): string {
    const label = this.formatActivityLabel(event);
    const streamLabel = textUpdate.kind === 'agent_thought_chunk' ? 'Thought' : 'Output';
    return `ACP Pipeline ${streamLabel} · ${label}`;
  }

  private getStreamBufferKey(
    event: PipelineSessionUpdateEvent,
    textUpdate: ExtractedSessionText,
  ): string {
    return [
      event.sessionId,
      event.phase,
      event.stepId ?? '',
      event.branchId ?? '',
      event.role ?? '',
      event.agentName ?? '',
      textUpdate.kind,
    ].join('\u0000');
  }

  private normalizeStreamText(text: string): string {
    return text
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private formatHeartbeatMessage(): string {
    const lines = [
      `Still running: ${this.lastActivityLabel}.`,
      `Elapsed on this activity: ${this.formatDuration(Date.now() - this.activityStartedAt)}.`,
    ];
    if (this.lastSessionUpdateAt > 0) {
      lines.push(`Last agent update: ${this.formatDuration(Date.now() - this.lastSessionUpdateAt)} ago (${this.lastSessionUpdateKind || 'unknown'}).`);
    } else {
      lines.push('Last agent update: none yet.');
    }
    lines.push(`Agent updates: ${this.sessionUpdateCount}; text chunks: ${this.agentTextChunkCount}; thought chunks: ${this.agentThoughtChunkCount}.`);
    lines.push('Use /pipeline verbose on to show raw agent chunks, or /pipeline status for a snapshot.');
    return lines.join('\n');
  }

  private extractSessionUpdateText(update: SessionNotification): ExtractedSessionText | null {
    const updateData = update.update;
    if (
      updateData.sessionUpdate !== 'agent_message_chunk'
      && updateData.sessionUpdate !== 'agent_thought_chunk'
    ) {
      return null;
    }
    const content = updateData.content;
    if (content.type !== 'text') {
      return null;
    }
    if (content.text.length === 0) {
      return null;
    }
    if (updateData.sessionUpdate === 'agent_thought_chunk') {
      return {
        kind: 'agent_thought_chunk',
        detailKind: 'agent-thought-chunk',
        text: content.text,
      };
    }
    return {
      kind: 'agent_message_chunk',
      detailKind: 'agent-message-chunk',
      text: content.text,
    };
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

  private formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) {
      return `${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  }
}

type ExtractedSessionText = {
  kind: 'agent_message_chunk' | 'agent_thought_chunk';
  detailKind: 'agent-message-chunk' | 'agent-thought-chunk';
  text: string;
};

type PipelineStreamBuffer = {
  key: string;
  sessionId: string;
  title: string;
  details: Record<string, unknown>;
  text: string;
  timer: ReturnType<typeof setTimeout> | null;
};
