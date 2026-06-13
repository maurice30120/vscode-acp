import * as assert from 'assert';

import { SessionManager } from '../core/SessionManager';

function createManager() {
  const agentManager = {
    killAll: () => undefined,
  };

  const connectionManager = {
    dispose: () => undefined,
    getConnection: () => undefined,
  };

  const sessionUpdateHandler = {};

  const manager = new SessionManager(
    agentManager as any,
    connectionManager as any,
    sessionUpdateHandler as any,
  );

  const historyCalls: Array<{ agentName: string; sessionId: string; title: string | null | undefined }> = [];
  (manager as any).historyStore = {
    setTitle: (agentName: string, sessionId: string, title: string | null | undefined) => {
      historyCalls.push({ agentName, sessionId, title });
    },
    setFirstPromptIfMissing: () => undefined,
    appendUserMessage: () => undefined,
    appendUserMessageChunk: () => undefined,
    appendAssistantMessageChunk: () => undefined,
    buildDiscussionContext: () => null,
    clearDiscussion: () => undefined,
    touch: () => undefined,
  };

  return { manager, historyCalls };
}

suite('SessionManager', () => {
  test('applyConfigOptions buffers before session registration and drains later', () => {
    const { manager } = createManager();
    const options = [{ id: 'mode', category: 'mode', value: 'default' }] as any;

    manager.applyConfigOptions('s1', options);
    assert.strictEqual((manager as any).pendingConfigOptions.has('s1'), true);

    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).drainPending(session);

    assert.deepStrictEqual(session.configOptions, options);
    assert.strictEqual((manager as any).pendingConfigOptions.has('s1'), false);
  });

  test('applyAvailableCommands buffers before session registration and drains later', () => {
    const { manager } = createManager();
    const commands = [{ id: 'cmd-1', title: 'Run' }] as any;

    manager.applyAvailableCommands('s1', commands);
    assert.strictEqual((manager as any).pendingAvailableCommands.has('s1'), true);

    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).drainPending(session);

    assert.deepStrictEqual(session.availableCommands, commands);
    assert.strictEqual((manager as any).pendingAvailableCommands.has('s1'), false);
  });

  test('applySessionInfoUpdate patches live session title and mirrors to history store', () => {
    const { manager, historyCalls } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).sessions.set('s1', session);

    manager.applySessionInfoUpdate('s1', { title: 'Updated title' });

    assert.strictEqual(session.title, 'Updated title');
    assert.strictEqual(historyCalls.length, 1);
    assert.deepStrictEqual(historyCalls[0], {
      agentName: 'Agent A',
      sessionId: 's1',
      title: 'Updated title',
    });
  });

  test('applySessionInfoUpdate buffers title when session is not yet registered', () => {
    const { manager } = createManager();

    manager.applySessionInfoUpdate('s-buffered', { title: 'Buffered title' });
    assert.strictEqual((manager as any).pendingTitles.get('s-buffered'), 'Buffered title');

    const session = {
      sessionId: 's-buffered',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;

    (manager as any).drainPending(session);
    assert.strictEqual(session.title, 'Buffered title');
    assert.strictEqual((manager as any).pendingTitles.has('s-buffered'), false);
  });

  test('setMode routes to setConfigOption when mode config option exists', async () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: [{ id: 'mode-option', category: 'mode' }],
      availableCommands: [],
    } as any;
    (manager as any).sessions.set('s1', session);

    const calls: Array<{ sessionId: string; configId: string; value: string }> = [];
    (manager as any).setConfigOption = async (sessionId: string, configId: string, value: string) => {
      calls.push({ sessionId, configId, value });
      return null;
    };

    await manager.setMode('s1', 'code');

    assert.deepStrictEqual(calls, [{ sessionId: 's1', configId: 'mode-option', value: 'code' }]);
  });

  test('setModel routes to setConfigOption when model config option exists', async () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: [{ id: 'model-option', category: 'model' }],
      availableCommands: [],
    } as any;
    (manager as any).sessions.set('s1', session);

    const calls: Array<{ sessionId: string; configId: string; value: string }> = [];
    (manager as any).setConfigOption = async (sessionId: string, configId: string, value: string) => {
      calls.push({ sessionId, configId, value });
      return null;
    };

    await manager.setModel('s1', 'gpt-x');

    assert.deepStrictEqual(calls, [{ sessionId: 's1', configId: 'model-option', value: 'gpt-x' }]);
  });

  test('getActiveAgentName returns agent name for active session', () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;

    (manager as any).sessions.set('s1', session);
    (manager as any).activeSessionId = 's1';

    assert.strictEqual(manager.getActiveAgentName(), 'Agent A');

    (manager as any).activeSessionId = null;
    assert.strictEqual(manager.getActiveAgentName(), null);
  });

  test('sendPrompt prepends shared discussion context once', async () => {
    const prompts: any[] = [];
    const agentManager = {
      killAll: () => undefined,
    };
    const connectionManager = {
      dispose: () => undefined,
      getConnection: () => ({
        connection: {
          prompt: async (payload: any) => {
            prompts.push(payload.prompt[0].text);
            return { stopReason: 'end_turn' };
          },
        },
      }),
    };
    const manager = new SessionManager(agentManager as any, connectionManager as any, {} as any);
    (manager as any).sessions.set('s1', {
      sessionId: 's1',
      agentId: 'agent-1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    });
    (manager as any).pendingSharedDiscussionContext.set('s1', 'Previous context');

    await manager.sendPrompt('s1', 'Continue');
    await manager.sendPrompt('s1', 'Next');

    assert.strictEqual(prompts[0], 'Previous context\n\nCurrent user prompt:\nContinue');
    assert.strictEqual(prompts[1], 'Next');
  });

  test('loadSession can carry active discussion context to loaded session', async () => {
    const { manager } = createManager();
    const loadCalls: any[] = [];
    const touches: string[] = [];
    const cleared: string[] = [];
    (manager as any).historyStore = {
      buildDiscussionContext: (agentName: string, sessionId: string) =>
        agentName === 'Agent A' && sessionId === 'source' ? 'Previous context' : null,
      clearDiscussion: (_agentName: string, sessionId: string) => {
        cleared.push(sessionId);
      },
      touch: (_agentName: string, sessionId: string) => {
        touches.push(sessionId);
      },
    };
    const conn = {
      initResponse: { agentInfo: { name: 'Agent B' }, agentCapabilities: {} },
      connection: {
        loadSession: async (payload: any) => {
          loadCalls.push(payload);
          return {};
        },
      },
    };
    (manager as any).ensureConnected = async () => conn;
    (manager as any).findAgentIdForConnection = () => 'agent-b-id';
    (manager as any).capabilities.set('Agent B', { list: false, load: true, resume: false });
    (manager as any).sessions.set('source', {
      sessionId: 'source',
      agentId: 'agent-a-id',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    });
    (manager as any).activeSessionId = 'source';
    (manager as any).agentSessions.set('Agent A', 'source');
    (manager as any).disconnectAgent = async (agentName: string) => {
      (manager as any).agentSessions.delete(agentName);
      (manager as any).sessions.delete('source');
      (manager as any).activeSessionId = null;
    };

    await manager.loadSession('Agent B', 'target', { shareCurrentContext: true });

    assert.strictEqual(loadCalls.length, 1);
    assert.deepStrictEqual(cleared, ['target']);
    assert.deepStrictEqual(touches, ['target']);
    assert.strictEqual((manager as any).pendingSharedDiscussionContext.get('target'), 'Previous context');
  });

  test('resumeSession can carry active discussion context to resumed session', async () => {
    const { manager } = createManager();
    const resumeCalls: any[] = [];
    (manager as any).historyStore = {
      buildDiscussionContext: (agentName: string, sessionId: string) =>
        agentName === 'Agent A' && sessionId === 'source' ? 'Previous context' : null,
      touch: () => undefined,
    };
    const conn = {
      initResponse: { agentInfo: { name: 'Agent B' }, agentCapabilities: {} },
      connection: {
        resumeSession: async (payload: any) => {
          resumeCalls.push(payload);
          return {};
        },
      },
    };
    (manager as any).ensureConnected = async () => conn;
    (manager as any).findAgentIdForConnection = () => 'agent-b-id';
    (manager as any).capabilities.set('Agent B', { list: false, load: false, resume: true });
    (manager as any).sessions.set('source', {
      sessionId: 'source',
      agentId: 'agent-a-id',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    });
    (manager as any).activeSessionId = 'source';
    (manager as any).agentSessions.set('Agent A', 'source');
    (manager as any).disconnectAgent = async (agentName: string) => {
      (manager as any).agentSessions.delete(agentName);
      (manager as any).sessions.delete('source');
      (manager as any).activeSessionId = null;
    };

    await manager.resumeSession('Agent B', 'target', { shareCurrentContext: true });

    assert.strictEqual(resumeCalls.length, 1);
    assert.strictEqual((manager as any).pendingSharedDiscussionContext.get('target'), 'Previous context');
  });

  test('does not share context when target is already active session', () => {
    const { manager } = createManager();
    (manager as any).historyStore = {
      buildDiscussionContext: () => 'Previous context',
    };
    (manager as any).sessions.set('same', {
      sessionId: 'same',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    });
    (manager as any).activeSessionId = 'same';

    assert.strictEqual(manager.hasShareableDiscussionContext('Agent A', 'same'), false);
  });
});
