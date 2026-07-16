import type { EventEmitter } from 'node:events';

import type { PipelinePlanReadyEvent, PipelineStatus } from '../PipelineEvents';

export interface PipelineTimelineEmitter {
  emitStatus(
    sessionId: string,
    status: PipelineStatus,
    message: string,
    stepId?: string,
    branchId?: string,
    role?: string,
    agentName?: string,
    implementerUsesSandcastle?: boolean,
  ): void;
  emitPlanReady(
    sessionId: string,
    event: PipelinePlanReadyEvent,
    approvalMessage: string,
    approvalStepId: string,
    implementerUsesSandcastle?: boolean,
  ): void;
}

export function createPipelineTimelineEmitter(emitter: EventEmitter): PipelineTimelineEmitter {
  return {
    emitStatus(
      sessionId,
      status,
      message,
      stepId,
      branchId,
      role,
      agentName,
      implementerUsesSandcastle,
    ) {
      emitter.emit('status', {
        sessionId,
        status,
        message,
        stepId,
        branchId,
        role,
        agentName,
        implementerUsesSandcastle,
      });
    },

    emitPlanReady(
      sessionId,
      event,
      approvalMessage,
      approvalStepId,
      implementerUsesSandcastle,
    ) {
      emitter.emit('plan-ready', event);
      emitter.emit('status', {
        sessionId,
        status: 'awaiting_approval',
        message: approvalMessage,
        stepId: approvalStepId,
        implementerUsesSandcastle,
      });
    },
  };
}
