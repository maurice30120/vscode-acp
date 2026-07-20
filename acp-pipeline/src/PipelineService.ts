import { EventEmitter } from 'node:events';

import type { PipelineDefinition } from './PipelineTypes';
import { PipelineRunEngine, type PipelineRunEngineDependencies } from './PipelineRunEngine';
import { PipelineRuntime } from './PipelineRuntime';
import { PipelineRuntimeAgentAdapter } from './PipelineRuntimeAgentAdapter';
import type { CompiledPipelineProgram, PipelinePauseSnapshot, PipelineRuntimeResult } from './PipelineV3Types';

export type {
  PipelineStatus,
  PipelineStatusEvent,
  PipelinePlanReadyEvent,
  PipelineSessionUpdateEvent,
  PipelineExecutorKind,
} from './PipelineEvents';

export interface PipelineServiceDependencies {
  getPipelineDefinitions?: () => PipelineDefinition[];
  getPipelineDefinitionForAgent?: (agentName: string) => PipelineDefinition | null;
  getPipelinePrograms?: () => CompiledPipelineProgram[];
  getPipelineProgramForAgent?: (agentName: string) => CompiledPipelineProgram | null;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: PipelineRunEngineDependencies['runAcpAgent'];
  runAgent?: PipelineRunEngineDependencies['runAgent'];
  isAgentSandcastle?: PipelineRunEngineDependencies['isAgentSandcastle'];
  isRunAbortedError?: PipelineRunEngineDependencies['isRunAbortedError'];
}

export class PipelineService extends EventEmitter {
  private readonly engine: PipelineRunEngine;
  private readonly v3Runs = new Map<string, PipelineRuntime>();
  private readonly v3RejectedRuns = new Set<string>();

  constructor(
    private readonly workspaceCwd: () => string,
    private readonly dependencies: PipelineServiceDependencies = {},
  ) {
    super();
    this.engine = new PipelineRunEngine(workspaceCwd, dependencies);
    this.engine.on('status', event => {
      this.emit('status', event);
    });
    this.engine.on('plan-ready', event => {
      this.emit('plan-ready', event);
    });
    this.engine.on('session-update', event => {
      this.emit('session-update', event);
    });
  }

  async createPlan(sessionId: string, userPrompt: string, pipelineAgentName?: string): Promise<string> {
    const program = this.readPipelineProgram(pipelineAgentName);
    if (program) {
      return this.startV3Pipeline(sessionId, program, userPrompt);
    }
    return this.engine.createPlan(sessionId, userPrompt, pipelineAgentName);
  }

  async approvePlan(sessionId: string, approvedPlan: string): Promise<string> {
    const runtime = this.v3Runs.get(sessionId);
    if (runtime) {
      const snapshot = await runtime.inspect(sessionId);
      const pause = snapshot?.pendingPause;
      if (!pause) {
        throw new Error('No pending pipeline pause for this session.');
      }
      return this.handleV3Result(
        sessionId,
        await runtime.resume(sessionId, {
          pauseId: pause.id,
          kind: 'approve',
          value: approvedPlan.trim(),
        }),
      );
    }
    return this.engine.approvePlan(sessionId, approvedPlan);
  }

  rejectPlan(sessionId: string): void {
    const runtime = this.v3Runs.get(sessionId);
    if (runtime) {
      this.v3RejectedRuns.add(sessionId);
      void runtime.inspect(sessionId).then(snapshot => {
        const pause = snapshot?.pendingPause;
        if (pause) {
          void runtime.resume(sessionId, { pauseId: pause.id, kind: 'reject' })
            .then(result => this.handleV3Result(sessionId, result));
        }
      });
      return;
    }
    this.engine.rejectPlan(sessionId);
  }

  cancel(sessionId: string): void {
    const runtime = this.v3Runs.get(sessionId);
    if (runtime) {
      void runtime.cancel(sessionId);
      this.v3Runs.delete(sessionId);
      return;
    }
    this.engine.cancel(sessionId);
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
    for (const [sessionId, runtime] of this.v3Runs.entries()) {
      await runtime.cancel(sessionId);
    }
    this.v3Runs.clear();
    this.removeAllListeners();
  }

  private async startV3Pipeline(
    sessionId: string,
    program: CompiledPipelineProgram,
    userPrompt: string,
  ): Promise<string> {
    if (!this.dependencies.runAgent) {
      throw new Error('PipelineService v3 execution requires runAgent dependency.');
    }
    const runtime = new PipelineRuntime(
      new PipelineRuntimeAgentAdapter({
        workspaceCwd: this.workspaceCwd,
        runAgent: this.dependencies.runAgent,
      }),
      {
        runIdFactory: () => sessionId,
        programs: [program],
        onEvent: event => {
          const rejected = event.type === 'cancelled' && this.v3RejectedRuns.has(event.runId);
          this.emit('status', {
            sessionId: event.runId,
            status: rejected ? 'rejected' : mapRuntimeEventToStatus(event.type),
            message: rejected ? 'Pipeline pause rejected.' : event.message ?? mapRuntimeEventToMessage(event.type, event.nodeId),
            stepId: event.nodeId,
          });
        },
      },
    );
    this.v3Runs.set(sessionId, runtime);
    return this.handleV3Result(
      sessionId,
      await runtime.start(program, { inputs: { userPrompt } }),
    );
  }

  private handleV3Result(sessionId: string, result: PipelineRuntimeResult): string {
    if (result.status === 'paused') {
      this.emitV3Pause(sessionId, result.pause);
      return result.pause.content;
    }
    if (result.status === 'completed') {
      this.v3Runs.delete(sessionId);
      return stringifyArtifactValue(result.artifact?.value);
    }
    if (result.status === 'cancelled') {
      this.v3Runs.delete(sessionId);
      this.v3RejectedRuns.delete(sessionId);
      return '';
    }
    this.v3Runs.delete(sessionId);
    this.v3RejectedRuns.delete(sessionId);
    throw new Error(result.error.message);
  }

  private emitV3Pause(sessionId: string, pause: PipelinePauseSnapshot): void {
    if (pause.type === 'approval') {
      this.emit('plan-ready', {
        sessionId,
        plan: pause.content,
        stepId: pause.nodeId,
        role: pause.nodeId,
        revised: false,
        implementerUsesSandcastle: false,
      });
      this.emit('status', {
        sessionId,
        status: 'awaiting_approval',
        message: 'Pipeline paused for approval.',
        stepId: pause.nodeId,
      });
      return;
    }
    this.emit('status', {
      sessionId,
      status: 'awaiting_approval',
      message: `Pipeline paused for ${pause.type}.`,
      stepId: pause.nodeId,
    });
  }

  private readPipelineProgram(pipelineAgentName?: string): CompiledPipelineProgram | null {
    if (pipelineAgentName) {
      const program = this.dependencies.getPipelineProgramForAgent?.(pipelineAgentName);
      if (program) {
        return program;
      }
    }
    const programs = this.dependencies.getPipelinePrograms?.() ?? [];
    if (pipelineAgentName) {
      return programs.find(program => program.title === pipelineAgentName || program.id === pipelineAgentName) ?? null;
    }
    return programs[0] ?? null;
  }
}

function mapRuntimeEventToStatus(type: string): string {
  switch (type) {
    case 'node_started':
      return 'running';
    case 'paused':
      return 'awaiting_approval';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'running';
  }
}

function mapRuntimeEventToMessage(type: string, nodeId: string | undefined): string {
  switch (type) {
    case 'node_started':
      return `Pipeline node "${nodeId ?? 'unknown'}" started.`;
    case 'node_completed':
      return `Pipeline node "${nodeId ?? 'unknown'}" completed.`;
    case 'paused':
      return 'Pipeline paused.';
    case 'completed':
      return 'Pipeline completed.';
    case 'failed':
      return 'Pipeline failed.';
    case 'cancelled':
      return 'Pipeline cancelled.';
    default:
      return 'Pipeline running.';
  }
}

function stringifyArtifactValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
