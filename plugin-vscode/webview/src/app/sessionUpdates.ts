import type { AgentID, PipelinePhase, SessionUpdate } from '../chatTypes';
import {
  normalizePlanUpdate,
  normalizeSlashCommands,
  normalizeToolCallStatus,
} from './normalizers';
import type { AppAction } from './state';

function getTextContent(update: SessionUpdate): string | undefined {
  const content =
    'content' in update && update.content && typeof update.content === 'object'
      ? (update.content as { type?: string; text?: string; messageId?: string; agentId?: AgentID })
      : undefined;
  return content?.type === 'text' && typeof content.text === 'string' ? content.text : undefined;
}

function getMessageMetadata(update: SessionUpdate, fallbackAgentId?: AgentID): { messageId?: string; agentId?: AgentID } {
  if ('messageId' in update && typeof update.messageId === 'string') {
    return {
      messageId: update.messageId,
      agentId: 'agentId' in update && typeof update.agentId === 'string' ? update.agentId : fallbackAgentId,
    };
  }
  const content = 'content' in update && update.content && typeof update.content === 'object'
    ? (update.content as { messageId?: string; agentId?: AgentID })
    : undefined;
  return {
    messageId: content?.messageId,
    agentId: content?.agentId || fallbackAgentId,
  };
}

export function mapSessionUpdateToActions(
  update: SessionUpdate,
  phase?: PipelinePhase,
  agentId?: AgentID,
  agentName?: string,
): AppAction[] {
  if (!update || typeof update !== 'object') {
    return [];
  }

  const isPlannerPhase = phase === 'planner';
  if (
    isPlannerPhase &&
    update.sessionUpdate !== 'agent_message_chunk' &&
    update.sessionUpdate !== 'agent_thought_chunk' &&
    update.sessionUpdate !== 'tool_call' &&
    update.sessionUpdate !== 'tool_call_update'
  ) {
    return [];
  }

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const contentText = getTextContent(update);
      if (!contentText) {
        return [];
      }
      const metadata = getMessageMetadata(update, agentId);
      if (isPlannerPhase) {
        return [
          { type: 'appendPlanningDraftChunk', text: contentText, messageId: metadata.messageId, agentId: metadata.agentId },
        ];
      }
      if (!phase) {
        return [
          { type: 'appendAssistantChunk', text: contentText, messageId: metadata.messageId, agentId: metadata.agentId },
        ];
      }
      return [
        { type: 'clearPipelineActivity' },
        { type: 'appendAssistantChunk', text: contentText, messageId: metadata.messageId, agentId: metadata.agentId },
      ];
    }

    case 'user_message_chunk':
      {
        const contentText = getTextContent(update);
        const metadata = getMessageMetadata(update, agentId);
        return contentText ? [{ type: 'appendUserChunk', text: contentText, messageId: metadata.messageId, agentId: metadata.agentId }] : [];
      }

    case 'agent_thought_chunk': {
      const contentText = getTextContent(update);
      const metadata = getMessageMetadata(update, agentId);
      if (!contentText) {
        return [];
      }
      if (phase && !isPlannerPhase) {
        return [{
          type: 'updatePipelineActivity',
          role: phase,
          agentName: agentName ?? metadata.agentId,
        }];
      }
      return [{ type: 'appendThoughtChunk', text: contentText, messageId: metadata.messageId, agentId: metadata.agentId }];
    }

    case 'tool_call': {
      const toolCallId = 'toolCallId' in update && typeof update.toolCallId === 'string' ? update.toolCallId : 'unknown';
      const title = 'title' in update && typeof update.title === 'string' ? update.title : 'Tool Call';
      return [
        {
          type: 'appendToolCall',
          toolCallId,
          title,
          status: normalizeToolCallStatus('status' in update ? update.status : undefined),
        },
      ];
    }

    case 'tool_call_update': {
      const toolCallId = 'toolCallId' in update && typeof update.toolCallId === 'string' ? update.toolCallId : 'unknown';
      const title = 'title' in update && typeof update.title === 'string' ? update.title : undefined;
      return [
        {
          type: 'updateToolCall',
          toolCallId,
          title,
          status: normalizeToolCallStatus('status' in update ? update.status : 'completed'),
        },
      ];
    }

    case 'sandcastle_status': {
      const status = 'status' in update ? update.status : undefined;
      if (
        status !== 'starting' &&
        status !== 'running' &&
        status !== 'completed' &&
        status !== 'cancelled' &&
        status !== 'failed'
      ) {
        return [];
      }
      if (status === 'completed' || status === 'cancelled' || status === 'failed') {
        return [{ type: 'setCurrentTurnStatus', status: null }];
      }
      return [{
        type: 'setCurrentTurnStatus',
        status: {
          kind: 'sandcastle',
          status,
          provider: 'provider' in update && typeof update.provider === 'string' ? update.provider : undefined,
          model: 'model' in update && typeof update.model === 'string' ? update.model : undefined,
          worktreePath: 'worktreePath' in update && typeof update.worktreePath === 'string' ? update.worktreePath : undefined,
          updatedAt: 'updatedAt' in update && typeof update.updatedAt === 'string' ? update.updatedAt : undefined,
          elapsedMs: 'elapsedMs' in update && typeof update.elapsedMs === 'number' ? update.elapsedMs : undefined,
        },
      }];
    }

    case 'plan':
      return [
        {
          type: 'appendPlan',
          plan: normalizePlanUpdate(update),
        },
      ];

    case 'current_mode_update':
      return [
        {
          type: 'updateCurrentMode',
          modeId:
            ('currentModeId' in update && typeof update.currentModeId === 'string'
              ? update.currentModeId
              : 'modeId' in update && typeof update.modeId === 'string'
                ? update.modeId
                : null),
        },
      ];

    case 'available_commands_update':
      return [
        {
          type: 'updateAvailableCommands',
          commands: normalizeSlashCommands('availableCommands' in update ? update.availableCommands : undefined),
        },
      ];

    case 'config_option_update':
      return [
        {
          type: 'updateConfigOptions',
          configOptions: 'configOptions' in update && Array.isArray(update.configOptions)
            ? update.configOptions
            : [],
        },
      ];

    default:
      return [];
  }
}
