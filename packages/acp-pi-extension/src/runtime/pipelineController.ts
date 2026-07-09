import { randomUUID } from 'node:crypto';

import {
  PipelineService,
  type PipelineDefinition,
  type PipelineAgentRunner,
  type PipelinePlanReadyEvent,
  type PipelineStatusEvent,
} from '@acp-client/pipeline';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';

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
  private permissionContext: PiPermissionContext | undefined;
  private pendingPlan: PipelinePlanReadyEvent | null = null;
  private activeSessionId: string | null = null;
  private lastStatuses: PipelineStatusEvent[] = [];

  constructor(
    private readonly workspaceCwd: string,
    private readonly pi: Pick<ExtensionAPI, 'sendMessage'>,
    private readonly options: PipelineControllerOptions = {},
  ) {
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
      .map(definition => `- ${definition.title} (${definition.id})`)
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
  }

  cancel(): void {
    if (!this.activeSessionId) {
      throw new Error('No active pipeline run to cancel.');
    }
    this.service.cancel(this.activeSessionId);
    this.pendingPlan = null;
    this.activeSessionId = null;
  }

  getLastStatuses(): PipelineStatusEvent[] {
    return [...this.lastStatuses];
  }

  dispose(): Promise<void> {
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
}
