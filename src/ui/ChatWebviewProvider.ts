import * as vscode from 'vscode';
import { marked } from 'marked';
import type { SessionNotification } from '@agentclientprotocol/sdk';

import { SessionManager } from '../core/SessionManager';
import { SessionUpdateHandler, SessionUpdateListener } from '../handlers/SessionUpdateHandler';
import { logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';

type WebviewMessage = {
  type: string;
  [key: string]: unknown;
};

type FileSelection = {
  startLine?: number;
  startCharacter?: number;
  endLine?: number;
  endCharacter?: number;
  text?: string;
  cursorLine?: number;
  cursorCharacter?: number;
} | null;

/**
 * WebviewViewProvider for the ACP chat sidebar.
 * Renders chat messages, tool calls, plans, and handles user input.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'acp-chat';

  private view?: vscode.WebviewView;
  private updateListener: SessionUpdateListener;
  private _hasChatContent = false;
  private isViewReady = false;
  private pendingMessages: WebviewMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });

    this.updateListener = (update: SessionNotification) => {
      this.handleSessionUpdate(update);
    };
    this.sessionUpdateHandler.addListener(this.updateListener);
  }

  /**
   * Render markdown text to HTML using marked.
   */
  private renderMarkdown(text: string): string {
    try {
      return marked.parse(text) as string;
    } catch {
      return this.escapeHtml(text);
    }
  }

  /**
   * Escape HTML special characters to prevent injection.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;
    this.isViewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview')],
    };

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'sendPrompt':
          this._hasChatContent = true;
          await this.handleSendPrompt(String(message.text ?? ''));
          break;
        case 'cancelTurn':
          await this.handleCancelTurn();
          break;
        case 'setMode':
          await this.handleSetMode(String(message.modeId ?? ''));
          break;
        case 'setModel':
          await this.handleSetModel(String(message.modelId ?? ''));
          break;
        case 'executeCommand':
          if (typeof message.command === 'string' && message.command) {
            await vscode.commands.executeCommand(message.command);
          }
          break;
        case 'ready':
          this.isViewReady = true;
          this.sendCurrentState();
          this.flushPendingMessages();
          break;
        case 'renderMarkdown': {
          const items = Array.isArray(message.items)
            ? message.items as Array<{ index: number; text: string }>
            : [];
          const rendered = items.map((item) => ({
            index: item.index,
            html: this.renderMarkdown(item.text),
          }));
          this.postMessage({ type: 'markdownRendered', items: rendered });
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.isViewReady = false;
    });

    webviewView.webview.html = await this.getHtmlContent(webviewView.webview);
  }

  /**
   * Forward session update to webview.
   */
  private handleSessionUpdate(update: SessionNotification): void {

  private handleSessionUpdate(update: SessionNotification): void {
    const activeId = this.sessionManager.getActiveSessionId();
    if (update.sessionId !== activeId) {
      return;
    }

    const updateData = update.update as any;
    if (updateData?.sessionUpdate === 'available_commands_update') {
      const session = this.sessionManager.getSession(update.sessionId);
      if (session) {
        session.availableCommands = updateData.availableCommands || [];
      }
    }

    this.postMessage({
      type: 'sessionUpdate',
      update: update.update,
      sessionId: update.sessionId,
    });
  }

  /**
   * Handle a prompt sent from the webview.
   */
  private async handleSendPrompt(text: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      this.postMessage({
        type: 'error',
        message: 'No active session. Create a session first.',
      });
      return;
    }

    sendEvent('chat/messageSent', {
      agentName: this.sessionManager.getActiveAgentName() ?? '',
    }, {
      messageLength: text.length,
    });

    this.postMessage({ type: 'promptStart' });

    try {
      const response = await this.sessionManager.sendPrompt(activeId, text);
      this.postMessage({
        type: 'promptEnd',
        stopReason: response.stopReason,
        usage: (response as any).usage,
      });
    } catch (e: any) {
      logError('Prompt failed', e);
      this.postMessage({
        type: 'error',
        message: e.message || 'Prompt failed',
      });
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  /**
   * Handle cancel request from webview.
   */
  private async handleCancelTurn(): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      return;
    }

    try {
      await this.sessionManager.cancelTurn(activeId);
    } catch (e) {
      logError('Cancel failed', e);
    }
  }

  /**
   * Handle mode change from webview picker.
   */
  private async handleSetMode(modeId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !modeId) {
      return;
    }

    try {
      await this.sessionManager.setMode(activeId, modeId);
    } catch (e: any) {
      logError('Failed to set mode', e);
      this.postMessage({ type: 'error', message: `Failed to set mode: ${e.message}` });
    }
  }

  /**
   * Handle model change from webview picker.
   */
  private async handleSetModel(modelId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !modelId) {
      return;
    }

    try {
      await this.sessionManager.setModel(activeId, modelId);
    } catch (e: any) {
      logError('Failed to set model', e);
      this.postMessage({ type: 'error', message: `Failed to set model: ${e.message}` });
    }
  }

  /**
   * Send current session state to the webview on load.
   */
  private sendCurrentState(): void {
    if (!this.view || !this.isViewReady) {
      return;
    }

    const activeId = this.sessionManager.getActiveSessionId();
    const session = activeId ? this.sessionManager.getSession(activeId) : null;
    this.view.webview.postMessage({
      type: 'state',
      activeSessionId: activeId,
      session: session ? {
        sessionId: session.sessionId,
        agentName: session.agentDisplayName,
        cwd: session.cwd,
        modes: session.modes,
        models: session.models,
        availableCommands: session.availableCommands,
      } : null,
    });
  }

  /**
   * Post a message to the webview if it exists.
   */
  private postMessage(message: WebviewMessage): void {
    if (!this.view || !this.isViewReady) {
      this.pendingMessages.push(message);
      return;
    }

    this.view.webview.postMessage(message);
  }

  private flushPendingMessages(): void {
    if (!this.view || !this.isViewReady || this.pendingMessages.length === 0) {
      return;
    }

    const messages = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of messages) {
      this.view.webview.postMessage(message);
    }
  }

  /**
   * Notify webview of a new active session.
   */
  notifyActiveSessionChanged(): void {
    this.sendCurrentState();
  }

  /**
   * Notify webview of mode state changes.
   */
  notifyModesUpdate(modes: any): void {
    if (!this.isViewReady) {
      return;
    }
    this.postMessage({ type: 'modesUpdate', modes });
  }

  /**
   * Notify webview of model state changes.
   */
  notifyModelsUpdate(models: any): void {
    if (!this.isViewReady) {
      return;
    }
    this.postMessage({ type: 'modelsUpdate', models });
  }

  /**
   * Clear the chat history and reset to welcome state.
   * Called when starting a new conversation.
   */
  clearChat(): void {
    this._hasChatContent = false;
    this.postMessage({ type: 'clearChat' });
  }

  /**
   * Whether the chat has any messages.
   */
  get hasChatContent(): boolean {
    return this._hasChatContent;
  }

  /**
   * Allows the extension host to send a quick prompt via the webview.
   */
  async sendPromptFromExtension(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    if (!this.sessionManager.getActiveSessionId()) {
      await this.handleSendPrompt(text);
      return;
    }

    this._hasChatContent = true;
    this.postMessage({ type: 'externalUserMessage', text });
    await this.handleSendPrompt(text);
  }

  /**
   * Attach a file URI — notify the webview to include it in the next prompt.
   */
  attachFile(uri: vscode.Uri, selection?: FileSelection): void {
    const payload: WebviewMessage = {
      type: 'file-attached',
      path: uri.fsPath,
      name: uri.fsPath.split(/[\\/]/).pop() || uri.fsPath,
    };

    if (selection) {
      payload.selection = selection;
    }

    this.postMessage(payload);
    this.view?.show?.(true);
  }

  dispose(): void {
    this.sessionUpdateHandler.removeListener(this.updateListener);
  }

  /**
   * Load HTML template for the webview, replacing nonce and CSP source.
   */
  private async getHtmlContent(webview: vscode.Webview): Promise<string> {
    const nonce = getNonce();
    const templateUri = vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'chat.html');

    try {
      const bytes = await vscode.workspace.fs.readFile(templateUri);
      return Buffer.from(bytes).toString('utf8')
        .replace(/__NONCE__/g, nonce)
        .replace(/__CSP_SOURCE__/g, webview.cspSource);
    } catch (e: any) {
      logError('Failed to load webview template', e);
      return '<!DOCTYPE html><html><body><pre>Failed to load webview template</pre></body></html>';
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
