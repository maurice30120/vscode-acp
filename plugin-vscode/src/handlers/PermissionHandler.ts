import * as vscode from 'vscode';
import { log } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/**
 * Handles ACP permission requests from agents.
 * Uses a serial promise queue to prevent concurrent QuickPick dialogs.
 * Supports granular auto-approve by tool kind.
 */
export interface PermissionHandlerOptions {
  /** Auto-approve all ACP permission requests (used for Sandcastle bridge connections). */
  autoApproveAll?: boolean;
}

export class PermissionHandler {
  private queue: Promise<void> = Promise.resolve();
  private readonly toolCalls = new Map<string, ToolCallUpdate>();

  constructor(private readonly options: PermissionHandlerOptions = {}) {}

  /** Keeps the complete tool call because permission requests may only contain its ID. */
  trackSessionUpdate(params: SessionNotification): void {
    const update = params.update;
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') {
      return;
    }

    const key = toolCallKey(params.sessionId, update.toolCallId);
    this.toolCalls.set(key, mergeToolCall(this.toolCalls.get(key), update));
  }

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const result = this.queue.then(() => this.handlePermission(params));
    this.queue = result.then(() => {}, () => {});
    return result.catch((err) => {
      log(`Permission request failed: ${err}`);
      sendEvent('permission/responded', { permissionType: params.toolCall?.title || 'Permission Request', outcome: 'error' });
      return CANCELLED;
    });
  }

  private async handlePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const cachedToolCall = this.toolCalls.get(toolCallKey(params.sessionId, params.toolCall.toolCallId));
    const toolCall = mergeToolCall(cachedToolCall, params.toolCall);
    const title = toolCall.title || formatToolKind(toolCall.kind) || 'Permission Request';
    const kind = toolCall.kind;
    const detail = formatToolCallDetail(toolCall.rawInput);

    if (this.options.autoApproveAll) {
      const allowOption = params.options.find(o =>
        o.kind === 'allow_once' || o.kind === 'allow_always',
      );
      if (allowOption) {
        sendEvent('permission/requested', { permissionType: title, autoApproved: 'true' });
        return {
          outcome: { outcome: 'selected', optionId: allowOption.optionId },
        };
      }
    }

    const config = vscode.workspace.getConfiguration('acp');
    // Granular auto-approve by tool kind
    let autoApprove: string;
    switch (kind) {
      case 'read':
      case 'search':
      case 'fetch':
        autoApprove = config.get<string>('autoApprove.read', 'ask');
        break;
      case 'edit':
      case 'delete':
      case 'move':
        autoApprove = config.get<string>('autoApprove.edit', 'ask');
        break;
      case 'execute':
        autoApprove = config.get<string>('autoApprove.execute', 'ask');
        break;
      default:
        autoApprove = 'ask';
        break;
    }

    log(`requestPermission: ${title} (kind=${kind}, autoApprove=${autoApprove})`);

    if (autoApprove === 'allow') {
      const allowOption = params.options.find(o =>
        o.kind === 'allow_once' || o.kind === 'allow_always'
      );
      if (allowOption) {
        sendEvent('permission/requested', { permissionType: title, autoApproved: 'true' });
        return {
          outcome: { outcome: 'selected', optionId: allowOption.optionId },
        };
      }
    }

    // QuickPick UI for manual approval
    const items: (vscode.QuickPickItem & { optionId: string })[] = params.options.map(option => {
      const icon = option.kind.startsWith('allow') ? '$(check)' : '$(x)';
      return {
        label: `${icon} ${option.name}`,
        description: formatPermissionDescription(option.kind, detail),
        optionId: option.optionId,
      };
    });

    sendEvent('permission/requested', { permissionType: title, autoApproved: 'false' });

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: detail ? `${title} - ${detail}` : title,
      title: 'ACP Agent Permission Request',
      ignoreFocusOut: true,
    });

    if (!selection) {
      log('Permission cancelled by user');
      sendEvent('permission/responded', { permissionType: title, outcome: 'cancelled' });
      return CANCELLED;
    }

    log(`Permission selected: ${selection.optionId}`);
    sendEvent('permission/responded', {
      permissionType: title,
      action: selection.optionId,
      outcome: 'selected',
    });
    return {
      outcome: { outcome: 'selected', optionId: selection.optionId },
    };
  }
}

function formatToolCallDetail(rawInput: unknown): string | undefined {
  if (rawInput === null || rawInput === undefined || rawInput === '') {
    return undefined;
  }

  const displayValue = extractDisplayValue(rawInput);
  const normalized = typeof displayValue === 'string'
    ? displayValue
    : (() => {
        try {
          return JSON.stringify(displayValue);
        } catch {
          return String(displayValue);
        }
      })();

  const trimmed = normalized.trim();
  if (!trimmed) {
    return undefined;
  }

  const maxLength = 180;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function extractDisplayValue(rawInput: unknown): unknown {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return rawInput;
  }

  const input = rawInput as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'path', 'query', 'url']) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      return input[key];
    }
  }

  return rawInput;
}

function toolCallKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function mergeToolCall(
  previous: ToolCallUpdate | undefined,
  update: ToolCallUpdate,
): ToolCallUpdate {
  const definedEntries = Object.entries(update).filter(([, value]) => value !== undefined);
  return { ...previous, ...Object.fromEntries(definedEntries) } as ToolCallUpdate;
}

function formatToolKind(kind: string | null | undefined): string | undefined {
  if (!kind) {
    return undefined;
  }
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function formatPermissionDescription(kind: string | undefined, detail: string | undefined): string {
  if (kind && detail) {
    return `${kind} - ${detail}`;
  }

  return detail || kind || '';
}
