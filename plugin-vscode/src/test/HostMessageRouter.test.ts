import * as assert from 'assert';

import { routeHostMessage } from '../../webview/src/app/hostMessageRouter';
import {
  appReducer,
  createInitialState,
  emptyPersistedState,
} from '../../webview/src/testing';

suite('HostMessageRouter', () => {
  test('pipelineStatus maps to orchestration actions', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, {
      type: 'updatePipelineTimeline',
      timeline: [
        { id: 'planner', label: 'Planner', status: 'done' },
        { id: 'approval', label: 'Approval', status: 'done' },
        { id: 'implementer', label: 'Implementer', status: 'pending' },
        { id: 'reviewer', label: 'Reviewer', status: 'pending' },
      ],
    });

    const result = routeHostMessage(
      {
        type: 'pipelineStatus',
        status: 'implementing',
        role: 'implementer',
        agentName: 'builder',
      },
      {
        getState: () => state,
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.ok(result.actions.some(action => action.type === 'setActivePipelineRole'));
    assert.ok(result.actions.some(action => action.type === 'updatePipelinePlanStatus'));
  });

  test('hydrateSharedState rejection returns no actions for stale snapshot', () => {
    const result = routeHostMessage(
      {
        type: 'hydrateSharedState',
        state: {
          version: 1,
          updatedAt: 100,
          chatHistory: [],
          sessionState: null,
          hasActiveSession: false,
          promptText: 'stale',
          inputAreaHeight: 140,
          isProcessing: false,
          currentTurn: null,
          collapsedTools: {},
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 5,
          sharedUpdatedAt: 500,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.strictEqual(result.actions.length, 0);
  });

  test('promptEnd finalizes team role turn when assistant output exists', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, { type: 'appendAssistantChunk', text: 'done' });
    state = appReducer(state, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'builder',
    });

    const result = routeHostMessage(
      { type: 'promptEnd' },
      {
        getState: () => state,
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions, [{ type: 'finalizeTeamRoleTurn' }]);
  });

  test('sessionUpdate maps to chat actions', () => {
    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.ok(result.actions.some(action => action.type === 'appendAssistantChunk'));
  });

  test('sessionUpdate preserves metadata for an arbitrary pipeline agent', () => {
    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        agentId: 'security-auditor-v2',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'message-42',
          content: { type: 'text', text: 'safe', messageId: 'message-42' },
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions[0], {
      type: 'appendAssistantChunk',
      text: 'safe',
      messageId: 'message-42',
      agentId: 'security-auditor-v2',
    });
  });

  test('non-planner pipeline thought chunk maps to local activity without thought text', () => {
    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        role: 'implementer',
        agentName: 'builder',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: {
            type: 'text',
            text: 'I am checking the modified files before deciding the next command.',
          },
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions, [
      {
        type: 'updatePipelineActivity',
        role: 'implementer',
        agentName: 'builder',
      },
      {
        type: 'setActivePipelineRole',
        role: 'implementer',
        agentName: 'builder',
      },
    ]);
    assert.strictEqual(JSON.stringify(result.actions).includes('checking the modified files'), false);
  });

  test('non-planner pipeline output clears activity and preserves assistant output', () => {
    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        role: 'reviewer',
        agentName: 'review-bot',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'message-7',
          content: { type: 'text', text: 'Review complete.', messageId: 'message-7' },
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions, [
      { type: 'clearPipelineActivity' },
      {
        type: 'appendAssistantChunk',
        text: 'Review complete.',
        messageId: 'message-7',
        agentId: undefined,
      },
      {
        type: 'setActivePipelineRole',
        role: 'reviewer',
        agentName: 'review-bot',
      },
    ]);
  });

  test('planner thought chunk keeps existing thought handling', () => {
    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        role: 'planner',
        agentName: 'planner-bot',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Planner private draft.' },
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions[0], {
      type: 'appendThoughtChunk',
      text: 'Planner private draft.',
      messageId: undefined,
      agentId: undefined,
    });
  });

  test('sandcastle_status updates current turn without appending chat history', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });

    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        update: {
          sessionUpdate: 'sandcastle_status',
          status: 'running',
          provider: 'pi',
          model: 'test-model',
          worktreePath: '/tmp/worktree',
          elapsedMs: 12_000,
        },
      },
      {
        getState: () => state,
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions, [{
      type: 'setCurrentTurnStatus',
      status: {
        kind: 'sandcastle',
        status: 'running',
        provider: 'pi',
        model: 'test-model',
        worktreePath: '/tmp/worktree',
        updatedAt: undefined,
        elapsedMs: 12_000,
      },
    }]);

    state = result.actions.reduce(appReducer, state);
    assert.strictEqual(state.currentTurn?.status?.kind, 'sandcastle');
    assert.deepStrictEqual(state.persisted.chatHistory, []);

    state = appReducer(state, { type: 'promptEnd' });
    assert.strictEqual(state.currentTurn, null);
    assert.deepStrictEqual(state.persisted.chatHistory, []);
  });

  test('terminal sandcastle_status clears current turn status', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, {
      type: 'setCurrentTurnStatus',
      status: { kind: 'sandcastle', status: 'running', provider: 'codex' },
    });

    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        update: {
          sessionUpdate: 'sandcastle_status',
          status: 'completed',
          provider: 'codex',
        },
      },
      {
        getState: () => state,
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    state = result.actions.reduce(appReducer, state);
    assert.strictEqual(state.currentTurn?.status, null);
    assert.deepStrictEqual(state.persisted.chatHistory, []);
  });
});
