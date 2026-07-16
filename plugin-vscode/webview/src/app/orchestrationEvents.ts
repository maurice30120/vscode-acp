import type { PipelinePhase, PipelinePlanStatus } from '../chatTypes';
import { normalizePipelinePhase as normalizeSharedPipelinePhase } from '../../../src/ui/PipelineTypes';
import { createDefaultTeamTimeline } from './OrchestrationProjector';
import type { AppAction } from './state';

export type OrchestrationHostMessage = {
  type: 'pipelinePlanReady';
  plan?: string;
  role?: PipelinePhase;
  agentName?: string;
  implementerUsesSandcastle?: boolean;
  revised?: boolean;
} | {
  type: 'pipelinePlanApprovalFailed';
} | {
  type: 'pipelineStatus';
  status?: string;
  message?: string;
  stepId?: string;
  role?: PipelinePhase;
  agentName?: string;
};

export function normalizePipelinePhase(value: unknown): PipelinePhase | undefined {
  return normalizeSharedPipelinePhase(value) ?? undefined;
}

export function normalizePipelineStatus(value: unknown): PipelinePlanStatus | null {
  switch (value) {
    case 'awaiting_approval':
      return 'pending';
    case 'implementing':
    case 'completed':
    case 'rejected':
    case 'error':
    case 'cancelled':
      return value;
    default:
      return null;
  }
}

export function mapOrchestrationMessageToActions(
  message: OrchestrationHostMessage,
  _currentTimeline: ReturnType<typeof createDefaultTeamTimeline>,
): AppAction[] {
  switch (message.type) {
    case 'pipelinePlanReady': {
      if (typeof message.plan !== 'string') {
        return [];
      }

      const actions: AppAction[] = [
        message.revised === true
          ? {
              type: 'revisePipelinePlan',
              plan: message.plan,
              role: normalizePipelinePhase(message.role),
              agentName: typeof message.agentName === 'string' ? message.agentName : undefined,
              implementerUsesSandcastle: message.implementerUsesSandcastle === true,
            }
          : {
              type: 'appendPipelinePlan',
              plan: message.plan,
              role: normalizePipelinePhase(message.role),
              agentName: typeof message.agentName === 'string' ? message.agentName : undefined,
              implementerUsesSandcastle: message.implementerUsesSandcastle === true,
            },
      ];

      return actions;
    }

    case 'pipelinePlanApprovalFailed':
      return [{ type: 'revertPipelinePlanApproval' }];

    case 'pipelineStatus': {
      const actions: AppAction[] = [];
      const status = normalizePipelineStatus(message.status);
      if (status) {
        actions.push({
          type: 'updatePipelinePlanStatus',
          status,
          message: typeof message.message === 'string' ? message.message : undefined,
        });
      }

      const role = normalizePipelinePhase(message.role);
      if (role) {
        actions.push({
          type: 'setActivePipelineRole',
          role,
          agentName: typeof message.agentName === 'string' ? message.agentName : null,
        });
      }

      return actions;
    }

    default:
      return [];
  }
}

export function mapSessionOrchestrationMetaToActions(
  role: PipelinePhase | undefined,
  agentName: string | undefined,
): AppAction[] {
  if (!role && !agentName) {
    return [];
  }

  return [{
    type: 'setActivePipelineRole',
    role: role ?? null,
    agentName: agentName ?? null,
  }];
}

export function shouldFinalizeTeamRoleTurn(
  activeRole: PipelinePhase | null,
  assistantText: string | undefined,
): boolean {
  return Boolean(activeRole && activeRole !== 'planner' && assistantText?.trim());
}
