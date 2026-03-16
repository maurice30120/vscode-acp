import {
  JSX,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  ChatHistoryItem,
  CurrentToolCall,
  CurrentTurn,
  FileSelection,
  MarkdownRenderItem,
  MarkdownRenderedItem,
  MessageHistoryItem,
  ModelOption,
  ModelsState,
  ModeOption,
  ModesState,
  PersistedWebviewState,
  PlanEntry,
  PlanHistoryItem,
  PlanUpdate,
  SessionSnapshot,
  SessionUpdate,
  SlashCommand,
  ThoughtHistoryItem,
  ToolCallHistoryItem,
  ToolCallStatus,
} from './chatTypes';
import { getState, onMessage, postMessage, setState, type HostToWebviewMessage } from './vscode';

const MIN_INPUT_HEIGHT = 90;
const MAX_INPUT_HEIGHT = 400;
const DEFAULT_INPUT_HEIGHT = 140;
const FALLBACK_TURN_ID = 'fallback-turn';

type AppState = {
  persisted: PersistedWebviewState;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  composerUnlocked: boolean;
  isModeDropdownOpen: boolean;
  isModelDropdownOpen: boolean;
  slashSelectedIdx: number;
  slashPopupSuppressedFor: string | null;
  placeholderOverride: string | null;
  renderedMarkdown: Record<number, string>;
  currentTurn: CurrentTurn | null;
  collapsedTools: Record<string, boolean>;
};

type AppAction =
  | { type: 'setPromptText'; text: string }
  | { type: 'setInputAreaHeight'; height: number }
  | { type: 'toggleModeDropdown' }
  | { type: 'toggleModelDropdown' }
  | { type: 'closePickers' }
  | { type: 'setSlashSelectedIdx'; index: number }
  | { type: 'suppressSlashPopup'; promptText: string | null }
  | { type: 'setPlaceholderOverride'; placeholder: string | null }
  | { type: 'setCollapsedTools'; key: string; collapsed: boolean }
  | { type: 'showSessionConnected'; session: SessionSnapshot }
  | { type: 'showNoSession' }
  | { type: 'appendUserMessage'; text: string }
  | { type: 'appendErrorMessage'; text: string }
  | { type: 'attachFile'; text: string }
  | { type: 'promptStart'; turnId: string }
  | { type: 'promptEnd' }
  | { type: 'clearChat' }
  | { type: 'updateModes'; modes: ModesState }
  | { type: 'updateModels'; models: ModelsState }
  | { type: 'updateCurrentMode'; modeId: string | null }
  | { type: 'updateCurrentModel'; modelId: string | null }
  | { type: 'updateAvailableCommands'; commands: SlashCommand[] }
  | { type: 'appendThoughtChunk'; text: string }
  | { type: 'setCurrentThoughtOpen'; isOpen: boolean }
  | { type: 'appendAssistantChunk'; text: string }
  | { type: 'appendToolCall'; toolCallId: string; title: string; status: ToolCallStatus }
  | { type: 'updateToolCall'; toolCallId: string; title?: string; status: ToolCallStatus }
  | { type: 'appendPlan'; plan: PlanUpdate }
  | { type: 'setRenderedMarkdown'; items: MarkdownRenderedItem[] };

type HistoryTurnBlock = {
  kind: 'turn';
  key: string;
  thought: { item: ThoughtHistoryItem; historyIndex: number } | null;
  assistant: { item: MessageHistoryItem; historyIndex: number } | null;
  toolCalls: Array<{ item: ToolCallHistoryItem; historyIndex: number }>;
  firstIndex: number;
};

type HistoryBlock =
  | { kind: 'message'; item: MessageHistoryItem; historyIndex: number }
  | { kind: 'plan'; item: PlanHistoryItem; historyIndex: number }
  | HistoryTurnBlock;

type ParsedUserMessage = {
  badgeText: string;
  body?: string;
};

function emptyPersistedState(): PersistedWebviewState {
  return {
    chatHistory: [],
    sessionState: null,
    hasActiveSession: false,
  };
}

function normalizeModesState(value: unknown): ModesState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ModesState>;
  return {
    availableModes: Array.isArray(candidate.availableModes)
      ? candidate.availableModes
          .filter((mode): mode is ModeOption => Boolean(mode && typeof mode === 'object'))
          .map((mode) => ({
            id: String(mode.id ?? ''),
            name: String(mode.name ?? mode.id ?? 'Mode'),
            description: typeof mode.description === 'string' ? mode.description : undefined,
          }))
          .filter((mode) => mode.id.length > 0)
      : [],
    currentModeId:
      typeof candidate.currentModeId === 'string' ? candidate.currentModeId : candidate.currentModeId ?? null,
  };
}

function normalizeModelsState(value: unknown): ModelsState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ModelsState>;
  return {
    availableModels: Array.isArray(candidate.availableModels)
      ? candidate.availableModels
          .filter((model): model is ModelOption => Boolean(model && typeof model === 'object'))
          .map((model) => ({
            modelId: String(model.modelId ?? ''),
            name: String(model.name ?? model.modelId ?? 'Model'),
            description: typeof model.description === 'string' ? model.description : undefined,
          }))
          .filter((model) => model.modelId.length > 0)
      : [],
    currentModelId:
      typeof candidate.currentModelId === 'string'
        ? candidate.currentModelId
        : candidate.currentModelId ?? null,
  };
}

function normalizeSlashCommands(value: unknown): SlashCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((command): command is SlashCommand => Boolean(command && typeof command === 'object'))
    .map((command) => ({
      name: String(command.name ?? ''),
      description: String(command.description ?? ''),
      input:
        command.input && typeof command.input === 'object'
          ? {
              hint: typeof command.input.hint === 'string' ? command.input.hint : undefined,
            }
          : undefined,
    }))
    .filter((command) => command.name.length > 0);
}

function normalizeSessionSnapshot(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SessionSnapshot>;
  return {
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
    agentName: typeof candidate.agentName === 'string' ? candidate.agentName : undefined,
    cwd: typeof candidate.cwd === 'string' ? candidate.cwd : undefined,
    modes: normalizeModesState(candidate.modes),
    models: normalizeModelsState(candidate.models),
    availableCommands: normalizeSlashCommands(candidate.availableCommands),
  };
}

function normalizePlanEntry(entry: unknown): PlanEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const candidate = entry as Partial<PlanEntry>;
  return {
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    content: typeof candidate.content === 'string' ? candidate.content : undefined,
  };
}

function normalizePlanUpdate(value: unknown): PlanUpdate {
  const candidate = value && typeof value === 'object' ? (value as PlanUpdate) : {};
  return {
    ...candidate,
    sessionUpdate: 'plan',
    entries: Array.isArray(candidate.entries)
      ? candidate.entries.map(normalizePlanEntry).filter((entry): entry is PlanEntry => entry !== null)
      : [],
  };
}

function normalizeFileSelection(value: unknown): FileSelection | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<FileSelection>;
  return {
    startLine: typeof candidate.startLine === 'number' ? candidate.startLine : undefined,
    startCharacter: typeof candidate.startCharacter === 'number' ? candidate.startCharacter : undefined,
    endLine: typeof candidate.endLine === 'number' ? candidate.endLine : undefined,
    endCharacter: typeof candidate.endCharacter === 'number' ? candidate.endCharacter : undefined,
    text: typeof candidate.text === 'string' ? candidate.text : undefined,
    cursorLine: typeof candidate.cursorLine === 'number' ? candidate.cursorLine : undefined,
    cursorCharacter: typeof candidate.cursorCharacter === 'number' ? candidate.cursorCharacter : undefined,
  };
}

function normalizeMarkdownRenderedItems(value: unknown): MarkdownRenderedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      index: typeof item.index === 'number' ? item.index : -1,
      html: typeof item.html === 'string' ? item.html : '',
    }))
    .filter((item) => item.index >= 0);
}

function normalizeSessionUpdate(value: unknown): SessionUpdate {
  if (!value || typeof value !== 'object') {
    return { sessionUpdate: 'unknown' };
  }

  const candidate = value as Record<string, unknown>;
  const sessionUpdate = typeof candidate.sessionUpdate === 'string' ? candidate.sessionUpdate : 'unknown';

  switch (sessionUpdate) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk': {
      const content =
        candidate.content && typeof candidate.content === 'object'
          ? (candidate.content as Record<string, unknown>)
          : null;
      return {
        sessionUpdate,
        content: content
          ? {
              type: typeof content.type === 'string' ? content.type : undefined,
              text: typeof content.text === 'string' ? content.text : undefined,
            }
          : undefined,
      };
    }

    case 'tool_call':
    case 'tool_call_update':
      return {
        sessionUpdate,
        toolCallId: typeof candidate.toolCallId === 'string' ? candidate.toolCallId : undefined,
        title: typeof candidate.title === 'string' ? candidate.title : undefined,
        status: normalizeToolCallStatus(candidate.status),
      };

    case 'plan':
      return normalizePlanUpdate(candidate);

    case 'current_mode_update':
      return {
        sessionUpdate,
        currentModeId: typeof candidate.currentModeId === 'string' ? candidate.currentModeId : null,
        modeId: typeof candidate.modeId === 'string' ? candidate.modeId : null,
      };

    case 'available_commands_update':
      return {
        sessionUpdate,
        availableCommands: normalizeSlashCommands(candidate.availableCommands),
      };

    default:
      return {
        sessionUpdate,
        ...candidate,
      };
  }
}

function normalizeMessageHistoryItem(value: unknown): MessageHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<MessageHistoryItem>;
  if (candidate.kind !== 'message') {
    return null;
  }

  const role = candidate.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'error') {
    return null;
  }

  return {
    kind: 'message',
    role,
    text: String(candidate.text ?? ''),
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : undefined,
  };
}

function normalizeThoughtHistoryItem(value: unknown): ThoughtHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ThoughtHistoryItem>;
  if (candidate.kind !== 'thought') {
    return null;
  }

  return {
    kind: 'thought',
    text: String(candidate.text ?? ''),
    durationSec: typeof candidate.durationSec === 'number' ? candidate.durationSec : 0,
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : undefined,
  };
}

function normalizeToolCallHistoryItem(value: unknown): ToolCallHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ToolCallHistoryItem>;
  if (candidate.kind !== 'toolCall') {
    return null;
  }

  return {
    kind: 'toolCall',
    toolCallId: String(candidate.toolCallId ?? 'unknown'),
    title: String(candidate.title ?? 'Tool Call'),
    status: normalizeToolCallStatus(candidate.status),
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : undefined,
  };
}

function normalizePlanHistoryItem(value: unknown): PlanHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PlanHistoryItem>;
  if (candidate.kind !== 'plan') {
    return null;
  }

  return {
    kind: 'plan',
    plan: normalizePlanUpdate(candidate.plan),
  };
}

function normalizeChatHistoryItem(value: unknown): ChatHistoryItem | null {
  return (
    normalizeMessageHistoryItem(value) ??
    normalizeThoughtHistoryItem(value) ??
    normalizeToolCallHistoryItem(value) ??
    normalizePlanHistoryItem(value)
  );
}

function normalizePersistedState(value: unknown): PersistedWebviewState {
  if (!value || typeof value !== 'object') {
    return emptyPersistedState();
  }

  const candidate = value as Partial<PersistedWebviewState>;
  return {
    chatHistory: Array.isArray(candidate.chatHistory)
      ? candidate.chatHistory
          .map(normalizeChatHistoryItem)
          .filter((item): item is ChatHistoryItem => item !== null)
      : [],
    sessionState: normalizeSessionSnapshot(candidate.sessionState),
    hasActiveSession: Boolean(candidate.hasActiveSession),
  };
}

function createCurrentTurn(turnId: string): CurrentTurn {
  return {
    turnId,
    assistantText: '',
    thought: null,
    toolCalls: [],
    historyToolCallIndexes: [],
  };
}

function createInitialState(): AppState {
  const persisted = normalizePersistedState(getState<PersistedWebviewState>());
  return {
    persisted,
    promptText: '',
    inputAreaHeight: DEFAULT_INPUT_HEIGHT,
    isProcessing: false,
    composerUnlocked: persisted.hasActiveSession,
    isModeDropdownOpen: false,
    isModelDropdownOpen: false,
    slashSelectedIdx: 0,
    slashPopupSuppressedFor: null,
    placeholderOverride: null,
    renderedMarkdown: {},
    currentTurn: null,
    collapsedTools: {},
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeToolCallStatus(status: unknown): ToolCallStatus {
  switch (status) {
    case 'running':
    case 'completed':
    case 'failed':
      return status;
    default:
      return 'pending';
  }
}

function ensureSessionState(state: AppState): SessionSnapshot {
  return state.persisted.sessionState ?? { availableCommands: [] };
}

function ensureCurrentTurn(state: AppState): CurrentTurn {
  return state.currentTurn ?? createCurrentTurn(FALLBACK_TURN_ID);
}

function updateHistoryToolCall(
  chatHistory: ChatHistoryItem[],
  toolCallId: string,
  status: ToolCallStatus,
  title?: string,
): ChatHistoryItem[] {
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const item = chatHistory[index];
    if (item.kind === 'toolCall' && item.toolCallId === toolCallId) {
      const nextItem: ToolCallHistoryItem = {
        ...item,
        status,
        title: title ?? item.title,
      };
      return [
        ...chatHistory.slice(0, index),
        nextItem,
        ...chatHistory.slice(index + 1),
      ];
    }
  }

  return chatHistory;
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'setPromptText':
      return {
        ...state,
        promptText: action.text,
      };

    case 'setInputAreaHeight':
      return {
        ...state,
        inputAreaHeight: clamp(action.height, MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT),
      };

    case 'toggleModeDropdown':
      return {
        ...state,
        isModeDropdownOpen: !state.isModeDropdownOpen,
        isModelDropdownOpen: false,
      };

    case 'toggleModelDropdown':
      return {
        ...state,
        isModeDropdownOpen: false,
        isModelDropdownOpen: !state.isModelDropdownOpen,
      };

    case 'closePickers':
      return {
        ...state,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
      };

    case 'setSlashSelectedIdx':
      return {
        ...state,
        slashSelectedIdx: action.index,
      };

    case 'suppressSlashPopup':
      return {
        ...state,
        slashPopupSuppressedFor: action.promptText,
      };

    case 'setPlaceholderOverride':
      return {
        ...state,
        placeholderOverride: action.placeholder,
      };

    case 'setCollapsedTools':
      return {
        ...state,
        collapsedTools: {
          ...state.collapsedTools,
          [action.key]: action.collapsed,
        },
      };

    case 'showSessionConnected':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          hasActiveSession: true,
          sessionState: normalizeSessionSnapshot(action.session) ?? action.session,
        },
        composerUnlocked: true,
      };

    case 'showNoSession':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          hasActiveSession: false,
          sessionState: null,
        },
        composerUnlocked: false,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
      };

    case 'appendUserMessage':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            { kind: 'message', role: 'user', text: action.text },
          ],
        },
      };

    case 'appendErrorMessage':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            { kind: 'message', role: 'error', text: action.text },
          ],
        },
      };

    case 'attachFile':
      return {
        ...state,
        promptText: action.text,
        composerUnlocked: true,
      };

    case 'promptStart':
      return {
        ...state,
        isProcessing: true,
        currentTurn: createCurrentTurn(action.turnId),
        slashPopupSuppressedFor: null,
      };

    case 'promptEnd': {
      if (!state.currentTurn) {
        return {
          ...state,
          isProcessing: false,
        };
      }

      const nextHistory = [...state.persisted.chatHistory];
      if (state.currentTurn.thought?.text) {
        const endTime = state.currentTurn.thought.finishedAt ?? Date.now();
        const durationSec = state.currentTurn.thought.startedAt
          ? Math.round((endTime - state.currentTurn.thought.startedAt) / 1000)
          : 0;
        nextHistory.push({
          kind: 'thought',
          text: state.currentTurn.thought.text,
          durationSec,
          turnId: state.currentTurn.turnId,
        });
      }

      if (state.currentTurn.assistantText) {
        nextHistory.push({
          kind: 'message',
          role: 'assistant',
          text: state.currentTurn.assistantText,
          turnId: state.currentTurn.turnId,
        });
      }

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: nextHistory,
        },
        isProcessing: false,
        currentTurn: null,
      };
    }

    case 'clearChat':
      return {
        ...state,
        persisted: emptyPersistedState(),
        isProcessing: false,
        composerUnlocked: false,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
        slashPopupSuppressedFor: null,
        placeholderOverride: null,
        renderedMarkdown: {},
        currentTurn: null,
      };

    case 'updateModes': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            modes: action.modes,
          },
        },
      };
    }

    case 'updateModels': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            models: action.models,
          },
        },
      };
    }

    case 'updateCurrentMode': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            modes: {
              ...(sessionState.modes ?? { availableModes: [] }),
              currentModeId: action.modeId,
            },
          },
        },
      };
    }

    case 'updateCurrentModel': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            models: {
              ...(sessionState.models ?? { availableModels: [] }),
              currentModelId: action.modelId,
            },
          },
        },
      };
    }

    case 'updateAvailableCommands': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            availableCommands: action.commands,
          },
        },
      };
    }

    case 'appendThoughtChunk': {
      const currentTurn = ensureCurrentTurn(state);
      return {
        ...state,
        currentTurn: {
          ...currentTurn,
          thought: currentTurn.thought
            ? {
                ...currentTurn.thought,
                text: currentTurn.thought.text + action.text,
              }
            : {
                text: action.text,
                startedAt: Date.now(),
                finishedAt: null,
                isOpen: true,
              },
        },
      };
    }

    case 'setCurrentThoughtOpen':
      if (!state.currentTurn?.thought) {
        return state;
      }

      return {
        ...state,
        currentTurn: {
          ...state.currentTurn,
          thought: {
            ...state.currentTurn.thought,
            isOpen: action.isOpen,
          },
        },
      };

    case 'appendAssistantChunk': {
      const currentTurn = ensureCurrentTurn(state);
      const assistantText = currentTurn.assistantText + action.text;
      const shouldCloseThought = assistantText.trim().length > 0 && currentTurn.thought;
      return {
        ...state,
        currentTurn: {
          ...currentTurn,
          assistantText,
          thought:
            currentTurn.thought && shouldCloseThought
              ? {
                  ...currentTurn.thought,
                  finishedAt: currentTurn.thought.finishedAt ?? Date.now(),
                  isOpen: false,
                }
              : currentTurn.thought,
        },
      };
    }

    case 'appendToolCall': {
      const currentTurn = ensureCurrentTurn(state);
      const historyIndex = state.persisted.chatHistory.length;
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'toolCall',
              toolCallId: action.toolCallId,
              title: action.title,
              status: action.status,
              turnId: currentTurn.turnId,
            },
          ],
        },
        currentTurn: {
          ...currentTurn,
          toolCalls: [
            ...currentTurn.toolCalls,
            {
              toolCallId: action.toolCallId,
              title: action.title,
              status: action.status,
            },
          ],
          historyToolCallIndexes: [...currentTurn.historyToolCallIndexes, historyIndex],
        },
      };
    }

    case 'updateToolCall': {
      const nextHistory = updateHistoryToolCall(
        state.persisted.chatHistory,
        action.toolCallId,
        action.status,
        action.title,
      );
      const nextTurn = state.currentTurn
        ? {
            ...state.currentTurn,
            toolCalls: state.currentTurn.toolCalls.map((toolCall) =>
              toolCall.toolCallId === action.toolCallId
                ? {
                    ...toolCall,
                    status: action.status,
                    title: action.title ?? toolCall.title,
                  }
                : toolCall,
            ),
          }
        : null;

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: nextHistory,
        },
        currentTurn: nextTurn,
      };
    }

    case 'appendPlan':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'plan',
              plan: normalizePlanUpdate(action.plan),
            },
          ],
        },
      };

    case 'setRenderedMarkdown': {
      const renderedMarkdown = { ...state.renderedMarkdown };
      for (const item of action.items) {
        renderedMarkdown[item.index] = item.html;
      }
      return {
        ...state,
        renderedMarkdown,
      };
    }

    default:
      return state;
  }
}

function getRestoreMarkdownItems(chatHistory: ChatHistoryItem[]): MarkdownRenderItem[] {
  return chatHistory.flatMap((item, index) =>
    item.kind === 'message' && item.role === 'assistant'
      ? [{ index, text: item.text }]
      : [],
  );
}

function getPromptEndMarkdownItem(state: AppState): MarkdownRenderItem | null {
  if (!state.currentTurn?.assistantText) {
    return null;
  }

  let index = state.persisted.chatHistory.length;
  if (state.currentTurn.thought?.text) {
    index += 1;
  }

  return {
    index,
    text: state.currentTurn.assistantText,
  };
}

function parseUserMessage(text: string): ParsedUserMessage | null {
  const newlineIndex = text.indexOf('\n');
  const firstLine = newlineIndex >= 0 ? text.slice(0, newlineIndex) : text;
  const parenOpen = firstLine.indexOf(' (');
  if (parenOpen <= 0) {
    return null;
  }

  const fileName = firstLine.slice(0, parenOpen);
  const cursorMatch = firstLine.match(/\[cursor (\d+:\d+)\]/);
  const cursorPos = cursorMatch?.[1];
  const rest = newlineIndex >= 0 ? text.slice(newlineIndex + 1).trimStart() : '';
  return {
    badgeText: cursorPos ? `${fileName} · ${cursorPos}` : fileName,
    body: rest || undefined,
  };
}

function buildAttachedFilePrompt(message: Extract<HostToWebviewMessage, { type: 'file-attached' }>, promptText: string): string {
  const name = message.name || message.path || 'attached file';
  const selection = message.selection;
  const cursorLine = selection?.cursorLine ?? selection?.startLine;
  const cursorCharacter = selection?.cursorCharacter ?? selection?.startCharacter;
  const existingText = promptText || '';
  const existingSuffix = existingText.length > 0 ? existingText : '';

  if (selection?.text) {
    const rangeTag =
      selection.startLine &&
      selection.startCharacter &&
      selection.endLine &&
      selection.endCharacter
        ? ` [${selection.startLine}:${selection.startCharacter}-${selection.endLine}:${selection.endCharacter}]`
        : '';
    const cursorTag = cursorLine && cursorCharacter ? ` [cursor ${cursorLine}:${cursorCharacter}]` : '';
    return `${name}${rangeTag}${cursorTag}\n${selection.text}\n\n${existingSuffix}`;
  }

  if (selection && (cursorLine || cursorCharacter)) {
    const lineValue = cursorLine ?? '?';
    const characterValue = cursorCharacter ?? '?';
    return `${name} (${message.path}) [cursor ${lineValue}:${characterValue}]\n\n${existingSuffix}`;
  }

  return `${name} (${message.path})\n\n${existingSuffix}`;
}

function getBasePlaceholder(commands: SlashCommand[]): string {
  return commands.length > 0 ? 'Type a message or / for commands...' : 'Type a message...';
}

function getSlashFilteredCommands(promptText: string, commands: SlashCommand[]): SlashCommand[] {
  if (!promptText.startsWith('/')) {
    return [];
  }

  const firstSpace = promptText.indexOf(' ');
  if (firstSpace >= 0) {
    return [];
  }

  const query = promptText.slice(1).toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(query));
}

function getStatusIcon(status: ToolCallStatus): string {
  switch (status) {
    case 'running':
      return '⟳';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    default:
      return '…';
  }
}

function getPlanEntryIcon(status?: string): string {
  if (status === 'completed') {
    return '✅';
  }
  if (status === 'in_progress') {
    return '🔄';
  }
  return '⬜';
}

function getThoughtSummary(text: string, durationSec: number | null, isStreaming: boolean): JSX.Element | string {
  if (isStreaming) {
    return (
      <>
        <span className="thought-indicator" />
        Thinking...
      </>
    );
  }

  if (durationSec && durationSec > 0) {
    return `Thought for ${durationSec}s`;
  }

  return text.length > 0 ? 'Thought' : '';
}

function hasTurnAssociation(item: ChatHistoryItem): item is ThoughtHistoryItem | ToolCallHistoryItem | MessageHistoryItem {
  if (item.kind === 'plan') {
    return false;
  }

  if (item.kind === 'message') {
    return item.role === 'assistant' && typeof item.turnId === 'string';
  }

  return typeof item.turnId === 'string';
}

function createHistoryTurnBlock(key: string, firstIndex: number): HistoryTurnBlock {
  return {
    kind: 'turn',
    key,
    thought: null,
    assistant: null,
    toolCalls: [],
    firstIndex,
  };
}

function buildHistoryBlocks(chatHistory: ChatHistoryItem[], excludedIndexes: Set<number>): HistoryBlock[] {
  const blocks: HistoryBlock[] = [];
  const turnBlocks = new Map<string, HistoryTurnBlock>();
  const emittedTurnIds = new Set<string>();

  for (let index = 0; index < chatHistory.length; index += 1) {
    if (excludedIndexes.has(index)) {
      continue;
    }

    const item = chatHistory[index];
    if (!hasTurnAssociation(item) || !item.turnId) {
      continue;
    }

    const turn = turnBlocks.get(item.turnId) ?? createHistoryTurnBlock(`turn-${item.turnId}`, index);
    turn.firstIndex = Math.min(turn.firstIndex, index);
    if (item.kind === 'thought') {
      turn.thought = { item, historyIndex: index };
    } else if (item.kind === 'toolCall') {
      turn.toolCalls.push({ item, historyIndex: index });
    } else {
      turn.assistant = { item, historyIndex: index };
    }
    turnBlocks.set(item.turnId, turn);
  }

  let fallbackTurn: HistoryTurnBlock | null = null;
  const flushFallbackTurn = () => {
    if (!fallbackTurn) {
      return;
    }
    blocks.push(fallbackTurn);
    fallbackTurn = null;
  };

  for (let index = 0; index < chatHistory.length; index += 1) {
    if (excludedIndexes.has(index)) {
      continue;
    }

    const item = chatHistory[index];
    if (hasTurnAssociation(item) && item.turnId) {
      flushFallbackTurn();
      if (!emittedTurnIds.has(item.turnId)) {
        const turnBlock = turnBlocks.get(item.turnId);
        if (turnBlock) {
          blocks.push(turnBlock);
          emittedTurnIds.add(item.turnId);
        }
      }
      continue;
    }

    switch (item.kind) {
      case 'message':
        if (item.role === 'assistant') {
          fallbackTurn ??= createHistoryTurnBlock(`legacy-turn-${index}`, index);
          fallbackTurn.assistant = { item, historyIndex: index };
          flushFallbackTurn();
        } else {
          flushFallbackTurn();
          blocks.push({ kind: 'message', item, historyIndex: index });
        }
        break;

      case 'thought':
        fallbackTurn ??= createHistoryTurnBlock(`legacy-turn-${index}`, index);
        fallbackTurn.thought = { item, historyIndex: index };
        break;

      case 'toolCall':
        fallbackTurn ??= createHistoryTurnBlock(`legacy-turn-${index}`, index);
        fallbackTurn.toolCalls.push({ item, historyIndex: index });
        break;

      case 'plan':
        flushFallbackTurn();
        blocks.push({ kind: 'plan', item, historyIndex: index });
        break;
    }
  }

  flushFallbackTurn();
  return blocks;
}

function getToolCollapseState(
  turnKey: string,
  toolCount: number,
  collapsedTools: Record<string, boolean>,
): boolean {
  if (turnKey in collapsedTools) {
    return collapsedTools[turnKey];
  }

  return toolCount > 3;
}

type MessageBubbleProps = {
  item: MessageHistoryItem;
  renderedHtml?: string;
};

function MessageBubble({ item, renderedHtml }: MessageBubbleProps): JSX.Element {
  const parsedUserMessage = item.role === 'user' ? parseUserMessage(item.text) : null;

  if (item.role === 'assistant') {
    return (
      <div
        className={`message assistant${renderedHtml ? ' md-rendered' : ''}`}
        {...(renderedHtml ? { dangerouslySetInnerHTML: { __html: renderedHtml } } : {})}
      >
        {!renderedHtml ? item.text : null}
      </div>
    );
  }

  if (item.role === 'error') {
    return <div className="message error">{item.text}</div>;
  }

  if (!parsedUserMessage) {
    return <div className="message user">{item.text}</div>;
  }

  return (
    <div className="message user">
      <span className="file-badge">📄 {parsedUserMessage.badgeText}</span>
      {parsedUserMessage.body ? <div className="message-text">{parsedUserMessage.body}</div> : null}
    </div>
  );
}

type ThoughtBlockProps = {
  text: string;
  durationSec: number | null;
  isStreaming: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
};

function ThoughtBlock({ text, durationSec, isStreaming, open, onToggle }: ThoughtBlockProps): JSX.Element {
  return (
    <details
      className={`thought-block${isStreaming ? ' streaming' : ''}`}
      {...(typeof open === 'boolean' ? { open } : {})}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
    >
      <summary>{getThoughtSummary(text, durationSec, isStreaming)}</summary>
      <div className="thought-content">{text}</div>
    </details>
  );
}

type TurnToolsProps = {
  turnKey: string;
  toolCalls: CurrentToolCall[] | Array<{ item: ToolCallHistoryItem; historyIndex: number }>;
  collapsed: boolean;
  onToggle: () => void;
};

function TurnTools({ turnKey, toolCalls, collapsed, onToggle }: TurnToolsProps): JSX.Element | null {
  if (toolCalls.length === 0) {
    return null;
  }

  const items = toolCalls.map((toolCall) =>
    'item' in toolCall
      ? {
          key: `${turnKey}-tool-${toolCall.historyIndex}`,
          toolCallId: toolCall.item.toolCallId,
          title: toolCall.item.title,
          status: toolCall.item.status,
        }
      : {
          key: `${turnKey}-tool-${toolCall.toolCallId}`,
          toolCallId: toolCall.toolCallId,
          title: toolCall.title,
          status: toolCall.status,
        },
  );

  const count = items.length;
  const summaryLabel = `${collapsed ? '▸' : '▾'} ${count} tool call${count !== 1 ? 's' : ''}`;

  return (
    <div className="turn-tools">
      <div className="turn-tools-summary" data-count={count} onClick={onToggle} onKeyDown={undefined} role="button" tabIndex={0}>
        {summaryLabel}
      </div>
      <div className={`turn-tools-list${collapsed ? ' collapsed' : ''}`}>
        {items.map((toolCall) => (
          <div className="tool-call-inline" id={`tc-${toolCall.toolCallId}`} key={toolCall.key}>
            <span className={`tc-icon ${toolCall.status}`}>{getStatusIcon(toolCall.status)}</span>
            <span className="tc-title">{toolCall.title || 'Tool Call'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type TurnBlockProps = {
  turnKey: string;
  thought: ThoughtBlockProps | null;
  assistantText?: string;
  assistantHtml?: string;
  toolCalls: CurrentToolCall[] | Array<{ item: ToolCallHistoryItem; historyIndex: number }>;
  collapsed: boolean;
  onToggleTools: () => void;
};

function TurnBlock({
  turnKey,
  thought,
  assistantText,
  assistantHtml,
  toolCalls,
  collapsed,
  onToggleTools,
}: TurnBlockProps): JSX.Element | null {
  const hasAssistantContent = typeof assistantText === 'string' && assistantText.trim().length > 0;
  const hasAssistant = Boolean(assistantHtml) || assistantText !== undefined;
  const hasVisibleContent = Boolean(thought) || hasAssistant || toolCalls.length > 0;

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className="turn" key={turnKey}>
      {thought ? <ThoughtBlock {...thought} /> : null}
      {hasAssistant ? (
        <div
          className={`message assistant${assistantHtml ? ' md-rendered' : ''}`}
          {...(assistantHtml ? { dangerouslySetInnerHTML: { __html: assistantHtml } } : {})}
        >
          {!assistantHtml && hasAssistantContent ? assistantText : !assistantHtml ? assistantText : null}
        </div>
      ) : null}
      <TurnTools turnKey={turnKey} toolCalls={toolCalls} collapsed={collapsed} onToggle={onToggleTools} />
    </div>
  );
}

type PlanBlockProps = {
  item: PlanHistoryItem;
};

function PlanBlock({ item }: PlanBlockProps): JSX.Element {
  return (
    <div className="plan">
      <div className="plan-title">Plan</div>
      {item.plan.entries?.map((entry, index) => (
        <div
          className={`plan-entry${entry.status === 'completed' ? ' completed' : ''}`}
          key={`plan-entry-${index}`}
        >
          {getPlanEntryIcon(entry.status)} {entry.title || entry.description || entry.content || ''}
        </div>
      ))}
    </div>
  );
}

type PickerProps<T> = {
  label: string;
  title: string;
  icon: string;
  currentValue: string | null;
  items: T[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  itemDescription: (item: T) => string | undefined;
  isOpen: boolean;
  onToggle: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onSelect: (item: T, event: ReactMouseEvent<HTMLDivElement>) => void;
};

function Picker<T>({
  label,
  title,
  icon,
  currentValue,
  items,
  itemKey,
  itemLabel,
  itemDescription,
  isOpen,
  onToggle,
  onSelect,
}: PickerProps<T>): JSX.Element {
  return (
    <div className="picker-wrap" onClick={(event) => event.stopPropagation()}>
      <button className="picker-btn" title={title} type="button" onClick={onToggle}>
        <span className="picker-icon">{icon}</span>
        <span className="picker-label">{label}</span>
        <span className="picker-chevron">▾</span>
      </button>
      <div className={`picker-dropdown${isOpen ? ' open' : ''}`}>
        {items.map((item) => {
          const key = itemKey(item);
          const selected = key === currentValue;
          return (
            <div
              className={`picker-dropdown-item${selected ? ' selected' : ''}`}
              key={key}
              onClick={(event) => onSelect(item, event)}
            >
              <span className="check">{selected ? '✓' : ''}</span>
              <span className="item-label">{itemLabel(item)}</span>
              {itemDescription(item) ? <span className="item-desc">{itemDescription(item)}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, undefined, createInitialState);
  const stateRef = useRef(state);
  const restoreMarkdownItemsRef = useRef(getRestoreMarkdownItems(state.persisted.chatHistory));
  const turnCounterRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const slashPopupRef = useRef<HTMLDivElement | null>(null);

  stateRef.current = state;

  const sessionState = state.persisted.sessionState;
  const availableCommands = sessionState?.availableCommands ?? [];
  const basePlaceholder = getBasePlaceholder(availableCommands);
  const slashFilteredCommands = getSlashFilteredCommands(state.promptText, availableCommands);
  const isSlashPopupOpen =
    slashFilteredCommands.length > 0 &&
    state.slashPopupSuppressedFor !== state.promptText;
  const placeholder =
    state.promptText.startsWith('/') && state.placeholderOverride
      ? state.placeholderOverride
      : basePlaceholder;
  const disabledBySession = !state.persisted.hasActiveSession && !state.composerUnlocked;
  const excludedToolIndexes = new Set(state.currentTurn?.historyToolCallIndexes ?? []);
  const historyBlocks = buildHistoryBlocks(state.persisted.chatHistory, excludedToolIndexes);

  useEffect(() => {
    setState(state.persisted);
  }, [state.persisted]);

  useEffect(() => {
    if (restoreMarkdownItemsRef.current.length > 0) {
      postMessage({ type: 'renderMarkdown', items: restoreMarkdownItemsRef.current });
      restoreMarkdownItemsRef.current = [];
    }

    postMessage({ type: 'ready' });

    return onMessage((message) => {
      switch (message.type) {
        case 'state':
          if (message.session) {
            dispatch({
              type: 'showSessionConnected',
              session: normalizeSessionSnapshot(message.session) ?? {},
            });
          } else {
            dispatch({ type: 'showNoSession' });
          }
          break;

        case 'externalUserMessage':
          if (typeof message.text === 'string') {
            dispatch({ type: 'appendUserMessage', text: message.text });
          }
          break;

        case 'file-attached':
          dispatch({
            type: 'attachFile',
            text: buildAttachedFilePrompt(
              {
                type: 'file-attached',
                path: typeof message.path === 'string' ? message.path : undefined,
                name: typeof message.name === 'string' ? message.name : undefined,
                selection: normalizeFileSelection(message.selection),
              },
              stateRef.current.promptText,
            ),
          });
          requestAnimationFrame(() => {
            promptInputRef.current?.focus();
          });
          break;

        case 'promptStart': {
          turnCounterRef.current += 1;
          dispatch({
            type: 'promptStart',
            turnId: `turn-${Date.now()}-${turnCounterRef.current}`,
          });
          break;
        }

        case 'promptEnd': {
          const markdownItem = getPromptEndMarkdownItem(stateRef.current);
          dispatch({ type: 'promptEnd' });
          if (markdownItem) {
            postMessage({ type: 'renderMarkdown', items: [markdownItem] });
          }
          break;
        }

        case 'clearChat':
          dispatch({ type: 'clearChat' });
          break;

        case 'error':
          dispatch({
            type: 'appendErrorMessage',
            text: typeof message.message === 'string' ? message.message : 'An error occurred',
          });
          break;

        case 'sessionUpdate':
          handleSessionUpdate(dispatch, normalizeSessionUpdate(message.update));
          break;

        case 'modesUpdate': {
          const modes = normalizeModesState(message.modes);
          if (modes) {
            dispatch({ type: 'updateModes', modes });
          }
          break;
        }

        case 'modelsUpdate': {
          const models = normalizeModelsState(message.models);
          if (models) {
            dispatch({ type: 'updateModels', models });
          }
          break;
        }

        case 'markdownRendered':
          dispatch({
            type: 'setRenderedMarkdown',
            items: normalizeMarkdownRenderedItems(message.items),
          });
          break;
      }
    });
  }, []);

  useEffect(() => {
    if (!state.promptText.startsWith('/')) {
      if (state.placeholderOverride !== null) {
        dispatch({ type: 'setPlaceholderOverride', placeholder: null });
      }
      if (state.slashPopupSuppressedFor !== null) {
        dispatch({ type: 'suppressSlashPopup', promptText: null });
      }
    }
  }, [state.placeholderOverride, state.promptText, state.slashPopupSuppressedFor]);

  useEffect(() => {
    const maxIndex = Math.max(slashFilteredCommands.length - 1, 0);
    const nextIndex = slashFilteredCommands.length === 0 ? 0 : Math.min(state.slashSelectedIdx, maxIndex);
    if (nextIndex !== state.slashSelectedIdx) {
      dispatch({ type: 'setSlashSelectedIdx', index: nextIndex });
    }
  }, [slashFilteredCommands.length, state.slashSelectedIdx]);

  useEffect(() => {
    const selectedItem = slashPopupRef.current?.querySelector<HTMLElement>(
      `.slash-popup-item[data-index="${state.slashSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [state.slashSelectedIdx, isSlashPopupOpen]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [historyBlocks, state.currentTurn, state.renderedMarkdown]);

  useEffect(() => {
    const closePickers = () => {
      dispatch({ type: 'closePickers' });
    };

    document.addEventListener('click', closePickers);
    return () => {
      document.removeEventListener('click', closePickers);
    };
  }, []);

  function focusPromptInput(): void {
    requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }

  function handleSend(explicitText?: string): void {
    const text = (explicitText ?? state.promptText).trim();
    if (!text || state.isProcessing) {
      return;
    }

    dispatch({ type: 'appendUserMessage', text });
    dispatch({ type: 'setPromptText', text: '' });
    dispatch({ type: 'setPlaceholderOverride', placeholder: null });
    dispatch({ type: 'suppressSlashPopup', promptText: null });
    postMessage({ type: 'sendPrompt', text });
  }

  function handleCancel(): void {
    postMessage({ type: 'cancelTurn' });
  }

  function handleWelcomeCommand(command: string): void {
    postMessage({ type: 'executeCommand', command });
  }

  function handleResizeStart(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = stateRef.current.inputAreaHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      dispatch({ type: 'setInputAreaHeight', height: startHeight + delta });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function selectSlashCommand(command: SlashCommand | undefined): void {
    if (!command) {
      return;
    }

    dispatch({ type: 'suppressSlashPopup', promptText: state.promptText });
    if (command.input) {
      dispatch({ type: 'setPromptText', text: `/${command.name} ` });
      dispatch({
        type: 'setPlaceholderOverride',
        placeholder: command.input.hint || 'Type input...',
      });
      focusPromptInput();
      return;
    }

    dispatch({ type: 'setPromptText', text: `/${command.name}` });
    dispatch({ type: 'setPlaceholderOverride', placeholder: null });
    handleSend(`/${command.name}`);
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (isSlashPopupOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        dispatch({
          type: 'setSlashSelectedIdx',
          index: Math.min(state.slashSelectedIdx + 1, slashFilteredCommands.length - 1),
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        dispatch({
          type: 'setSlashSelectedIdx',
          index: Math.max(state.slashSelectedIdx - 1, 0),
        });
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        selectSlashCommand(slashFilteredCommands[state.slashSelectedIdx]);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        selectSlashCommand(slashFilteredCommands[state.slashSelectedIdx]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        dispatch({ type: 'suppressSlashPopup', promptText: state.promptText });
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (state.isProcessing) {
        handleCancel();
      } else {
        handleSend();
      }
    }
  }

  function handleModeSelect(mode: ModeOption, event: ReactMouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (sessionState?.modes?.currentModeId === mode.id) {
      return;
    }
    dispatch({ type: 'updateCurrentMode', modeId: mode.id });
    postMessage({ type: 'setMode', modeId: mode.id });
  }

  function handleModelSelect(model: ModelOption, event: ReactMouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (sessionState?.models?.currentModelId === model.modelId) {
      return;
    }
    dispatch({ type: 'updateCurrentModel', modelId: model.modelId });
    postMessage({ type: 'setModel', modelId: model.modelId });
  }

  const emptyStateVisible =
    !state.persisted.hasActiveSession &&
    state.persisted.chatHistory.length === 0 &&
    !state.currentTurn;

  return (
    <>
      <div className={`session-banner${state.persisted.hasActiveSession ? ' visible' : ''}`}>
        <span className="dot" />
        <div className="info">
          <div className="agent">{sessionState?.agentName || 'Agent'}</div>
          <div className="cwd">{sessionState?.cwd || ''}</div>
        </div>
        <span className="status">{state.isProcessing ? <span className="spinner" /> : null}</span>
      </div>

      <div className="messages" id="messages" ref={messagesRef}>
        {emptyStateVisible ? (
          <div className="empty-state" id="emptyState">
            <div className="icon">🤖</div>
            <div className="title">ACP Chat</div>
            <div className="subtitle">Connect to an AI coding agent to start chatting.</div>
            <div className="actions">
              <button
                className="action-btn primary"
                id="welcomeConnectAgent"
                type="button"
                onClick={() => handleWelcomeCommand('acp.connectAgent')}
              >
                🔌 Connect to Agent
              </button>
              <button
                className="action-btn secondary"
                id="welcomeAddAgent"
                type="button"
                onClick={() => handleWelcomeCommand('acp.addAgent')}
              >
                ⚙ Add Agent
              </button>
            </div>
            <div className="hint">
              or press <kbd>Ctrl+Shift+A</kbd> anytime
            </div>
          </div>
        ) : null}

        {historyBlocks.map((block) => {
          if (block.kind === 'message') {
            return <MessageBubble item={block.item} key={`message-${block.historyIndex}`} />;
          }

          if (block.kind === 'plan') {
            return <PlanBlock item={block.item} key={`plan-${block.historyIndex}`} />;
          }

          const assistantHtml = block.assistant
            ? state.renderedMarkdown[block.assistant.historyIndex]
            : undefined;
          const collapsed = getToolCollapseState(block.key, block.toolCalls.length, state.collapsedTools);
          return (
            <TurnBlock
              assistantHtml={assistantHtml}
              assistantText={block.assistant?.item.text}
              collapsed={collapsed}
              key={block.key}
              onToggleTools={() =>
                dispatch({
                  type: 'setCollapsedTools',
                  key: block.key,
                  collapsed: !collapsed,
                })
              }
              thought={
                block.thought
                  ? {
                      text: block.thought.item.text,
                      durationSec: block.thought.item.durationSec,
                      isStreaming: false,
                    }
                  : null
              }
              toolCalls={block.toolCalls}
              turnKey={block.key}
            />
          );
        })}

        {state.currentTurn ? (
          <TurnBlock
            assistantText={state.currentTurn.assistantText.trim().length > 0 ? state.currentTurn.assistantText : undefined}
            collapsed={getToolCollapseState('current-turn', state.currentTurn.toolCalls.length, state.collapsedTools)}
            onToggleTools={() =>
              dispatch({
                type: 'setCollapsedTools',
                key: 'current-turn',
                collapsed: !getToolCollapseState('current-turn', state.currentTurn?.toolCalls.length ?? 0, state.collapsedTools),
              })
            }
            thought={
              state.currentTurn.thought
                ? {
                    text: state.currentTurn.thought.text,
                    durationSec: null,
                    isStreaming: state.currentTurn.thought.finishedAt === null,
                    open: state.currentTurn.thought.isOpen,
                    onToggle: (open) => dispatch({ type: 'setCurrentThoughtOpen', isOpen: open }),
                  }
                : null
            }
            toolCalls={state.currentTurn.toolCalls}
            turnKey="current-turn"
          />
        ) : null}
      </div>

      <div
        className={`input-area${disabledBySession ? ' disabled' : ''}`}
        id="inputArea"
        style={{ height: state.inputAreaHeight }}
      >
        <div
          className={`slash-popup${isSlashPopupOpen ? ' open' : ''}`}
          id="slashPopup"
          ref={slashPopupRef}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="slash-popup-header">Commands</div>
          {slashFilteredCommands.map((command, index) => (
            <div
              className={`slash-popup-item${index === state.slashSelectedIdx ? ' active' : ''}`}
              data-index={index}
              key={command.name}
              onClick={() => selectSlashCommand(command)}
              onMouseEnter={() => dispatch({ type: 'setSlashSelectedIdx', index })}
            >
              <span className="cmd-name">/{command.name}</span>
              <span className="cmd-desc">{command.description}</span>
            </div>
          ))}
        </div>

        <div className="input-resize-handle" id="resizeHandle" onMouseDown={handleResizeStart} />

        <div className="input-toolbar">
          {sessionState?.modes?.availableModes.length ? (
            <Picker
              currentValue={sessionState.modes.currentModeId ?? null}
              icon="⚡"
              isOpen={state.isModeDropdownOpen}
              itemDescription={(mode) => mode.description}
              itemKey={(mode) => mode.id}
              itemLabel={(mode) => mode.name}
              items={sessionState.modes.availableModes}
              label={
                sessionState.modes.availableModes.find(
                  (mode) => mode.id === sessionState.modes?.currentModeId,
                )?.name ?? 'Mode'
              }
              onSelect={handleModeSelect}
              onToggle={(event) => {
                event.stopPropagation();
                dispatch({ type: 'toggleModeDropdown' });
              }}
              title={
                sessionState.modes.availableModes.find(
                  (mode) => mode.id === sessionState.modes?.currentModeId,
                )?.description ?? 'Select mode'
              }
            />
          ) : (
            <div className="picker-wrap hidden" />
          )}

          {sessionState?.models?.availableModels.length ? (
            <Picker
              currentValue={sessionState.models.currentModelId ?? null}
              icon="🧠"
              isOpen={state.isModelDropdownOpen}
              itemDescription={(model) => model.description}
              itemKey={(model) => model.modelId}
              itemLabel={(model) => model.name}
              items={sessionState.models.availableModels}
              label={
                sessionState.models.availableModels.find(
                  (model) => model.modelId === sessionState.models?.currentModelId,
                )?.name ?? 'Model'
              }
              onSelect={handleModelSelect}
              onToggle={(event) => {
                event.stopPropagation();
                dispatch({ type: 'toggleModelDropdown' });
              }}
              title={
                sessionState.models.availableModels.find(
                  (model) => model.modelId === sessionState.models?.currentModelId,
                )?.description ?? 'Select model'
              }
            />
          ) : (
            <div className="picker-wrap hidden" />
          )}
          <span className="toolbar-spacer" />
        </div>

        <div className="input-editor-wrap">
          <textarea
            disabled={disabledBySession || state.isProcessing}
            id="promptInput"
            onChange={(event) => {
              dispatch({ type: 'setPromptText', text: event.target.value });
              if (state.slashPopupSuppressedFor && state.slashPopupSuppressedFor !== event.target.value) {
                dispatch({ type: 'suppressSlashPopup', promptText: null });
              }
            }}
            onKeyDown={handlePromptKeyDown}
            placeholder={placeholder}
            ref={promptInputRef}
            rows={2}
            value={state.promptText}
          />
        </div>

        <div className="input-send-row">
          <button
            className={`send-stop-btn ${state.isProcessing ? 'stop' : 'send'}`}
            disabled={!state.isProcessing && (disabledBySession || state.promptText.trim().length === 0)}
            id="sendStopBtn"
            type="button"
            onClick={() => {
              if (state.isProcessing) {
                handleCancel();
              } else {
                handleSend();
              }
            }}
          >
            {state.isProcessing ? '■ Stop' : 'Send lol'}
          </button>
        </div>
      </div>
    </>
  );
}

function handleSessionUpdate(
  dispatch: Dispatch<AppAction>,
  update: SessionUpdate,
): void {
  if (!update || typeof update !== 'object') {
    return;
  }

  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content =
        'content' in update && update.content && typeof update.content === 'object'
          ? (update.content as { type?: string; text?: string })
          : undefined;
      const contentText = content?.type === 'text' && typeof content.text === 'string' ? content.text : undefined;
      if (contentText) {
        dispatch({ type: 'appendAssistantChunk', text: contentText });
      }
      break;
    }

    case 'user_message_chunk':
      break;

    case 'agent_thought_chunk': {
      const content =
        'content' in update && update.content && typeof update.content === 'object'
          ? (update.content as { type?: string; text?: string })
          : undefined;
      const contentText = content?.type === 'text' && typeof content.text === 'string' ? content.text : undefined;
      if (contentText) {
        dispatch({ type: 'appendThoughtChunk', text: contentText });
      }
      break;
    }

    case 'tool_call': {
      const toolCallId = 'toolCallId' in update && typeof update.toolCallId === 'string' ? update.toolCallId : 'unknown';
      const title = 'title' in update && typeof update.title === 'string' ? update.title : 'Tool Call';
      dispatch({
        type: 'appendToolCall',
        toolCallId,
        title,
        status: normalizeToolCallStatus('status' in update ? update.status : undefined),
      });
      break;
    }

    case 'tool_call_update': {
      const toolCallId = 'toolCallId' in update && typeof update.toolCallId === 'string' ? update.toolCallId : 'unknown';
      const title = 'title' in update && typeof update.title === 'string' ? update.title : undefined;
      dispatch({
        type: 'updateToolCall',
        toolCallId,
        title,
        status: normalizeToolCallStatus('status' in update ? update.status : 'completed'),
      });
      break;
    }

    case 'plan':
      dispatch({
        type: 'appendPlan',
        plan: normalizePlanUpdate(update),
      });
      break;

    case 'current_mode_update':
      dispatch({
        type: 'updateCurrentMode',
        modeId:
          ('currentModeId' in update && typeof update.currentModeId === 'string'
            ? update.currentModeId
            : 'modeId' in update && typeof update.modeId === 'string'
              ? update.modeId
              : null),
      });
      break;

    case 'available_commands_update':
      dispatch({
        type: 'updateAvailableCommands',
        commands: normalizeSlashCommands('availableCommands' in update ? update.availableCommands : undefined),
      });
      break;
  }
}
