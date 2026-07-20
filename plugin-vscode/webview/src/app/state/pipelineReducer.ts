import type { AppState, PipelineAction } from './types';
import { commitCurrentTurnToHistory, formatPipelineRoleLabel } from './helpers';

const PIPELINE_ACTIONS = new Set<PipelineAction['type']>([
  'appendPipelinePlan',
  'revisePipelinePlan',
  'updatePipelinePlanStatus',
  'revertPipelinePlanApproval',
  'updatePipelineTimeline',
  'setActivePipelineRole',
  'updatePipelineActivity',
  'clearPipelineActivity',
  'appendPipelineRoleOutput',
  'finalizeTeamRoleTurn',
]);

export function isPipelineAction(action: { type: string }): action is PipelineAction {
  return PIPELINE_ACTIONS.has(action.type as PipelineAction['type']);
}

export function pipelineReducer(state: AppState, action: PipelineAction): AppState {
  switch (action.type) {
    case 'appendPipelinePlan': {
      const chatHistory = commitCurrentTurnToHistory(
        state.persisted.chatHistory,
        state.currentTurn,
      );
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory,
        },
        orchestration: {
          ...state.orchestration,
          plan: {
            plan: action.plan,
            status: 'pending',
            role: action.role,
            agentName: action.agentName,
            implementerUsesSandcastle: action.implementerUsesSandcastle,
          },
        },
        isProcessing: false,
        currentTurn: null,
      };
    }

    case 'revisePipelinePlan': {
      const chatHistory = commitCurrentTurnToHistory(
        state.persisted.chatHistory,
        state.currentTurn,
      );
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory,
        },
        orchestration: {
          ...state.orchestration,
          plan: {
            plan: action.plan,
            status: 'pending',
            role: action.role ?? state.orchestration.plan?.role,
            agentName: action.agentName ?? state.orchestration.plan?.agentName,
            implementerUsesSandcastle:
              action.implementerUsesSandcastle ?? state.orchestration.plan?.implementerUsesSandcastle,
          },
        },
        isProcessing: false,
        currentTurn: null,
      };
    }

    case 'updatePipelineTimeline':
      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          timeline: action.timeline,
        },
      };

    case 'setActivePipelineRole': {
      const nextAgentName = action.agentName ?? null;
      if (
        state.orchestration.activeRole === action.role
        && state.orchestration.activeAgentName === nextAgentName
      ) {
        return state;
      }
      const nextState = finalizeActiveRoleOutput(state);
      return {
        ...nextState,
        orchestration: {
          ...nextState.orchestration,
          activeRole: action.role,
          activeAgentName: nextAgentName,
        },
      };
    }

    case 'appendPipelineRoleOutput':
      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          roleOutputs: [
            ...state.orchestration.roleOutputs,
            {
              role: action.role,
              agentName: action.agentName,
              text: action.text,
              title: action.title,
            },
          ],
        },
      };

    case 'updatePipelineActivity':
      return {
        ...state,
        pipelineActivity: {
          role: action.role,
          agentName: action.agentName,
        },
      };

    case 'clearPipelineActivity':
      return state.pipelineActivity ? { ...state, pipelineActivity: null } : state;

    case 'finalizeTeamRoleTurn': {
      const { activeRole, activeAgentName } = state.orchestration;
      if (!activeRole || activeRole === 'planner' || !state.currentTurn?.assistantText.trim()) {
        return state;
      }

      const roleLabel = formatPipelineRoleLabel(activeRole);
      const agentSuffix = activeAgentName ? ` (${activeAgentName})` : '';

      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          roleOutputs: [
            ...state.orchestration.roleOutputs,
            {
              role: activeRole,
              agentName: activeAgentName ?? undefined,
              text: state.currentTurn.assistantText,
              title: `${roleLabel}${agentSuffix}`,
            },
          ],
        },
        isProcessing: false,
        currentTurn: null,
      };
    }

    case 'updatePipelinePlanStatus': {
      const currentPlan = state.orchestration.plan;
      if (!currentPlan) {
        return state;
      }
      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          plan: {
            ...currentPlan,
            status: action.status,
            message: action.message,
          },
        },
      };
    }

    case 'revertPipelinePlanApproval': {
      const currentPlan = state.orchestration.plan;
      if (!currentPlan) {
        return state;
      }
      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          plan: {
            ...currentPlan,
            status: 'pending',
            message: undefined,
          },
        },
      };
    }

    default:
      return state;
  }
}

function finalizeActiveRoleOutput(state: AppState): AppState {
  const { activeRole, activeAgentName } = state.orchestration;
  const assistantText = state.currentTurn?.assistantText;
  if (!activeRole || activeRole === 'planner' || !assistantText?.trim() || !state.currentTurn) {
    return state;
  }

  const roleLabel = formatPipelineRoleLabel(activeRole);
  const agentSuffix = activeAgentName ? ` (${activeAgentName})` : '';

  return {
    ...state,
    orchestration: {
      ...state.orchestration,
      roleOutputs: [
        ...state.orchestration.roleOutputs,
        {
          role: activeRole,
          agentName: activeAgentName ?? undefined,
          text: assistantText,
          title: `${roleLabel}${agentSuffix}`,
        },
      ],
    },
    currentTurn: {
      ...state.currentTurn,
      assistantText: '',
    },
  };
}
