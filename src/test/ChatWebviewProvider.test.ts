import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
import type { EditorContext } from '../ui/EditorContext';

suite('ChatWebviewProvider', () => {
  const workspaceRoot = path.join(path.parse(process.cwd()).root, 'workspace');
  const examplePath = path.join(workspaceRoot, 'src', 'example.ts');

  function createProvider(editorContext: EditorContext | null = null) {
    const sentPrompts: string[] = [];
    const recordedPrompts: string[] = [];
    const messages: any[] = [];
    const touchedSessions: string[] = [];
    const transcriptUserMessages: string[] = [];

    const sessionManager = {
      getActiveSessionId: () => 'session-1',
      getActiveAgentName: () => 'agent-1',
      getSession: () => ({
        sessionId: 'session-1',
        agentDisplayName: 'Agent One',
        cwd: workspaceRoot,
        modes: null,
        models: null,
        configOptions: null,
        availableCommands: [],
      }),
      getSessionContextFamily: () => null,
      recordFirstPrompt: (_sessionId: string, prompt: string) => {
        recordedPrompts.push(prompt);
      },
      recordUserMessage: (_sessionId: string, prompt: string) => {
        transcriptUserMessages.push(prompt);
      },
      recordAssistantMessageChunk: () => undefined,
      recordUserMessageChunk: () => undefined,
      isLoading: () => false,
      sendPrompt: async (_sessionId: string, prompt: string) => {
        sentPrompts.push(prompt);
        return { stopReason: 'end_turn' };
      },
      touchHistory: (sessionId: string) => {
        touchedSessions.push(sessionId);
      },
    };
    const sessionUpdateHandler = {
      addListener: () => undefined,
      removeListener: () => undefined,
    };
    const provider = new ChatWebviewProvider(
      vscode.Uri.file(workspaceRoot),
      sessionManager as any,
      sessionUpdateHandler as any,
      () => editorContext,
    );

    (provider as any).view = {
      webview: {
        postMessage: (message: any) => {
          messages.push(message);
          return Promise.resolve(true);
        },
      },
    };
    (provider as any).isViewReady = true;

    return { provider, sentPrompts, recordedPrompts, messages, touchedSessions, transcriptUserMessages };
  }

  const editorContext: EditorContext = {
    filePath: examplePath,
    cursorLine: 7,
    cursorCharacter: 3,
    language: 'ts',
    selection: {
      startLine: 7,
      startCharacter: 1,
      endLine: 7,
      endCharacter: 10,
      text: 'const x = 1;',
    },
    currentLine: null,
    openEditors: [],
  };

  test('sends raw prompt when editor context link is disabled', async () => {
    const { provider, sentPrompts, recordedPrompts, transcriptUserMessages } = createProvider(editorContext);

    await (provider as any).handleSendPrompt('raw prompt');

    assert.deepStrictEqual(sentPrompts, ['raw prompt']);
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
    assert.deepStrictEqual(transcriptUserMessages, ['raw prompt']);
  });

  test('sends enriched prompt to agent and records only raw prompt', async () => {
    const { provider, sentPrompts, recordedPrompts, messages } = createProvider(editorContext);
    provider.setEditorContextLinked(true);

    await (provider as any).handleSendPrompt('raw prompt');

    assert.strictEqual(sentPrompts.length, 1);
    assert.ok(sentPrompts[0].includes('VS Code context:'));
    assert.ok(sentPrompts[0].includes('const x = 1;'));
    assert.ok(sentPrompts[0].endsWith('User prompt:\nraw prompt'));
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
    assert.strictEqual(messages.some(message => message.type === 'info'), false);
  });

  test('falls back to raw prompt and posts info when linked context is unavailable', async () => {
    const { provider, sentPrompts, recordedPrompts, messages } = createProvider(null);
    provider.setEditorContextLinked(true);

    await (provider as any).handleSendPrompt('raw prompt');

    assert.deepStrictEqual(sentPrompts, ['raw prompt']);
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
    assert.ok(messages.some(message => message.type === 'info'));
    assert.ok(messages.some(message => message.type === 'promptStart'));
    assert.ok(messages.some(message => message.type === 'promptEnd'));
  });

  test('includes context family metadata in session state snapshot', () => {
    const { provider, messages } = createProvider(null);
    const sessionManager = (provider as any).sessionManager;
    sessionManager.getSessionContextFamily = () => ({
      contextFamilyId: 'ctx-1',
      contextLinkedFrom: {
        agentName: 'Agent A',
        sessionId: 'source',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      contextLinkedAt: '2026-01-02T00:00:00.000Z',
    });

    (provider as any).sendCurrentState();

    const stateMessage = messages.find(message => message.type === 'state');
    assert.strictEqual(stateMessage.session.contextFamily.contextFamilyId, 'ctx-1');
    assert.strictEqual(stateMessage.session.contextFamily.contextLinkedFrom.agentName, 'Agent A');
  });
});
