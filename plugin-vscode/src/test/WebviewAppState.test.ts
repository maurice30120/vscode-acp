import * as assert from 'assert';

import {
  appReducer,
  buildWebviewPersistedBundle,
  createInitialState,
  emptyPersistedState,
  emptyOrchestrationSlice,
  getViewportBoundedInputHeight,
  MAX_INPUT_HEIGHT,
  MIN_INPUT_HEIGHT,
  selectOrchestrationView,
  shouldAcceptIncomingSharedState,
  type ChatWebviewSharedState,
} from '../../webview/src/testing';

suite('WebviewAppState', () => {
  test('submitUserMessage appends message and clears prompt in one transition', () => {
    const initial = createInitialState(emptyPersistedState());
    const withPrompt = appReducer(initial, { type: 'setPromptText', text: 'hello world' });
    const withPlaceholder = appReducer(withPrompt, {
      type: 'setPlaceholderOverride',
      placeholder: 'custom',
    });
    const withSlashSuppressed = appReducer(withPlaceholder, {
      type: 'suppressSlashPopup',
      promptText: '/cmd',
    });

    const next = appReducer(withSlashSuppressed, { type: 'submitUserMessage', text: 'hello world' });

    assert.strictEqual(next.promptText, '');
    assert.strictEqual(next.placeholderOverride, null);
    assert.strictEqual(next.slashPopupSuppressedFor, null);
    assert.strictEqual(next.isProcessing, true);
    assert.strictEqual(next.persisted.chatHistory.length, 1);
    assert.deepStrictEqual(next.persisted.chatHistory[0], {
      kind: 'message',
      role: 'user',
      text: 'hello world',
    });
  });

  test('appendUserChunk ignores duplicate echo of the last user message', () => {
    const initial = createInitialState(emptyPersistedState());
    const submitted = appReducer(initial, { type: 'submitUserMessage', text: 'hello world' });
    const echoed = appReducer(submitted, { type: 'appendUserChunk', text: 'hello world' });

    assert.strictEqual(echoed.persisted.chatHistory.length, 1);
    assert.strictEqual(
      echoed.persisted.chatHistory[0]?.kind === 'message' ? echoed.persisted.chatHistory[0].text : '',
      'hello world',
    );
  });

  test('appendUserChunk concatenates chunks sharing one message ID', () => {
    const initial = createInitialState(emptyPersistedState());
    const first = appReducer(initial, {
      type: 'appendUserChunk', text: 'hel', messageId: 'user-message-1', agentId: 'user',
    });
    const second = appReducer(first, {
      type: 'appendUserChunk', text: 'lo', messageId: 'user-message-1', agentId: 'user',
    });

    assert.strictEqual(second.persisted.chatHistory.length, 1);
    assert.deepStrictEqual(second.persisted.chatHistory[0], {
      kind: 'message',
      role: 'user',
      text: 'hello',
      agentId: 'user',
      messageId: 'user-message-1',
    });
  });

  test('assistant chunk metadata overrides the prompt fallback agent', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, {
      type: 'promptStart', turnId: 'turn-1', agentId: 'pipeline',
    });
    state = appReducer(state, {
      type: 'appendAssistantChunk',
      text: 'reviewed',
      messageId: 'agent-message-1',
      agentId: 'custom-security-reviewer',
    });
    state = appReducer(state, { type: 'promptEnd' });

    assert.deepStrictEqual(state.persisted.chatHistory[0], {
      kind: 'message',
      role: 'assistant',
      text: 'reviewed',
      turnId: 'turn-1',
      messageId: 'agent-message-1',
      agentId: 'custom-security-reviewer',
    });
  });

  test('hydrateOrchestrationState preserves shared slice', () => {
    const initial = createInitialState(emptyPersistedState());
    const withPrompt = appReducer(initial, { type: 'setPromptText', text: 'draft' });
    const withOrchestration = appReducer(withPrompt, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'coder',
    });

    const hydrated = appReducer(withOrchestration, {
      type: 'hydrateOrchestrationState',
      state: {
        version: 2,
        updatedAt: 200,
        timeline: [{ id: 'planner', label: 'Planner', status: 'done' }],
        activeRole: 'reviewer',
        activeAgentName: 'review-bot',
        plan: null,
        roleOutputs: [],
      },
    });

    assert.strictEqual(hydrated.promptText, 'draft');
    assert.strictEqual(hydrated.orchestration.activeRole, 'reviewer');
    assert.strictEqual(hydrated.orchestration.activeAgentName, 'review-bot');
  });

  test('hydrateSharedState restores promptText without touching orchestration slice', () => {
    const initial = createInitialState(emptyPersistedState());
    const withOrchestration = appReducer(initial, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'coder',
    });
    const cleared = appReducer(withOrchestration, { type: 'submitUserMessage', text: 'sent' });

    const snapshot: ChatWebviewSharedState = {
      version: 2,
      updatedAt: 200,
      chatHistory: cleared.persisted.chatHistory,
      sessionState: null,
      hasActiveSession: false,
      promptText: 'restored draft',
      inputAreaHeight: cleared.inputAreaHeight,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
      composerUnlocked: false,
    };

    const hydrated = appReducer(cleared, { type: 'hydrateSharedState', state: snapshot });
    assert.strictEqual(hydrated.promptText, 'restored draft');
    assert.strictEqual(hydrated.orchestration.activeRole, 'implementer');
    assert.strictEqual(hydrated.orchestration.activeAgentName, 'coder');
  });

  test('createInitialState restores orchestration from serializer bundle', () => {
    const state = createInitialState({
      shared: {
        version: 1,
        updatedAt: 100,
        chatHistory: [],
        sessionState: null,
        hasActiveSession: false,
        promptText: '',
        inputAreaHeight: 140,
        isProcessing: false,
        currentTurn: null,
        collapsedTools: {},
      },
      orchestration: {
        timeline: [{ id: 'planner', label: 'Plan', status: 'done' }],
        activeRole: 'implementer',
        activeAgentName: 'builder',
      },
    });

    assert.strictEqual(state.orchestration.activeRole, 'implementer');
    assert.strictEqual(selectOrchestrationView(state).hasTimeline, true);
    assert.strictEqual(selectOrchestrationView(state).activity, null);
  });

  test('pipeline activity is local and is not persisted or restored', () => {
    let state = createInitialState({
      shared: {
        version: 1,
        updatedAt: 100,
        chatHistory: [],
        sessionState: null,
        hasActiveSession: false,
        promptText: '',
        inputAreaHeight: 140,
        isProcessing: false,
        currentTurn: null,
        collapsedTools: {},
      },
      orchestration: {
        version: 1,
        updatedAt: 100,
        timeline: [],
        activeRole: 'implementer',
        activeAgentName: 'builder',
        plan: null,
        roleOutputs: [],
        activity: {
          role: 'implementer',
          agentName: 'builder',
          text: 'must not restore',
        },
      },
    });

    assert.strictEqual(state.pipelineActivity, null);
    state = appReducer(state, {
      type: 'updatePipelineActivity',
      role: 'implementer',
      agentName: 'builder',
    });
    assert.deepStrictEqual(selectOrchestrationView(state).activity, {
      role: 'implementer',
      agentName: 'builder',
    });

    const bundle = buildWebviewPersistedBundle(state, 2, 200, 2, 200);
    assert.strictEqual('activity' in bundle.orchestration, false);
    assert.strictEqual(JSON.stringify(bundle).includes('must not restore'), false);

    const cleared = appReducer(state, { type: 'clearPipelineActivity' });
    assert.strictEqual(cleared.pipelineActivity, null);
  });

  test('createInitialState migrates legacy pipeline fields from shared snapshot', () => {
    const state = createInitialState({
      version: 1,
      updatedAt: 100,
      chatHistory: [],
      sessionState: null,
      hasActiveSession: false,
      promptText: '',
      inputAreaHeight: 140,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
      pipelineTimeline: [{ id: 'reviewer', label: 'Review', status: 'running' }],
      activePipelineRole: 'reviewer',
      activePipelineAgentName: 'review-bot',
    });

    assert.strictEqual(state.orchestration.activeRole, 'reviewer');
    assert.strictEqual(state.orchestration.timeline.length, 1);
  });

  test('createInitialState clamps restored input height', () => {
    const tooTall = createInitialState({
      version: 1,
      updatedAt: 100,
      chatHistory: [],
      sessionState: null,
      hasActiveSession: true,
      promptText: '',
      inputAreaHeight: 5000,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
    });

    const tooShort = createInitialState({
      version: 1,
      updatedAt: 100,
      chatHistory: [],
      sessionState: null,
      hasActiveSession: true,
      promptText: '',
      inputAreaHeight: 1,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
    });

    assert.strictEqual(tooTall.inputAreaHeight, MAX_INPUT_HEIGHT);
    assert.strictEqual(tooShort.inputAreaHeight, MIN_INPUT_HEIGHT);
  });

  test('viewport-bounded input height keeps messages visible in compact panels', () => {
    assert.strictEqual(getViewportBoundedInputHeight(MAX_INPUT_HEIGHT, 520), 340);
    assert.strictEqual(getViewportBoundedInputHeight(MAX_INPUT_HEIGHT, 1200), MAX_INPUT_HEIGHT);
    assert.strictEqual(getViewportBoundedInputHeight(MAX_INPUT_HEIGHT, 220), MIN_INPUT_HEIGHT);
  });

  test('finalizeTeamRoleTurn appends pipeline output without standard prompt commit', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, { type: 'appendAssistantChunk', text: 'implemented feature' });
    state = appReducer(state, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'builder',
    });

    const next = appReducer(state, { type: 'finalizeTeamRoleTurn' });

    assert.strictEqual(next.currentTurn, null);
    assert.strictEqual(next.isProcessing, false);
    assert.strictEqual(next.persisted.chatHistory.length, 0);
    assert.strictEqual(next.orchestration.roleOutputs.length, 1);
    assert.strictEqual(next.orchestration.roleOutputs[0]?.role, 'implementer');
  });

  test('setActivePipelineRole finalizes previous role output during a running turn', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'builder',
    });
    state = appReducer(state, { type: 'appendAssistantChunk', text: 'implemented feature' });

    const switched = appReducer(state, {
      type: 'setActivePipelineRole',
      role: 'reviewer',
      agentName: 'review-bot',
    });

    assert.strictEqual(switched.isProcessing, true);
    assert.notStrictEqual(switched.currentTurn, null);
    assert.strictEqual(switched.currentTurn?.assistantText, '');
    assert.strictEqual(switched.persisted.chatHistory.length, 0);
    assert.strictEqual(switched.orchestration.activeRole, 'reviewer');
    assert.strictEqual(switched.orchestration.activeAgentName, 'review-bot');
    assert.strictEqual(switched.orchestration.roleOutputs.length, 1);
    assert.strictEqual(switched.orchestration.roleOutputs[0]?.role, 'implementer');
    assert.strictEqual(switched.orchestration.roleOutputs[0]?.agentName, 'builder');
    assert.strictEqual(switched.orchestration.roleOutputs[0]?.text, 'implemented feature');
    assert.strictEqual(switched.orchestration.roleOutputs[0]?.title, 'Implementer (builder)');

    const withReviewOutput = appReducer(switched, { type: 'appendAssistantChunk', text: 'review passed' });
    const finished = appReducer(withReviewOutput, { type: 'finalizeTeamRoleTurn' });

    assert.strictEqual(finished.isProcessing, false);
    assert.strictEqual(finished.currentTurn, null);
    assert.strictEqual(finished.persisted.chatHistory.length, 0);
    assert.strictEqual(finished.orchestration.roleOutputs.length, 2);
    assert.strictEqual(finished.orchestration.roleOutputs[1]?.role, 'reviewer');
    assert.strictEqual(finished.orchestration.roleOutputs[1]?.agentName, 'review-bot');
    assert.strictEqual(finished.orchestration.roleOutputs[1]?.text, 'review passed');
    assert.strictEqual(finished.orchestration.roleOutputs[1]?.title, 'Reviewer (review-bot)');
  });

  test('appendPipelinePlan finalizes planner turn without assistant history entry', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, {
      type: 'appendPlanningDraftChunk',
      text: '<proposed_plan>Implement it</proposed_plan>',
    });

    const next = appReducer(state, {
      type: 'appendPipelinePlan',
      plan: '<proposed_plan>Implement it</proposed_plan>',
      role: 'planner',
      agentName: 'Planner',
    });

    assert.strictEqual(next.isProcessing, false);
    assert.strictEqual(next.currentTurn, null);
    assert.strictEqual(next.persisted.chatHistory.length, 0);
    assert.strictEqual(next.orchestration.plan?.status, 'pending');
    assert.strictEqual(next.orchestration.plan?.plan, '<proposed_plan>Implement it</proposed_plan>');
  });

  test('revisePipelinePlan finalizes planner turn without assistant history entry', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, {
      type: 'appendPipelinePlan',
      plan: '<proposed_plan>Initial</proposed_plan>',
      role: 'planner',
      agentName: 'Planner',
    });
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-2' });
    state = appReducer(state, {
      type: 'appendPlanningDraftChunk',
      text: '<proposed_plan>Revised</proposed_plan>',
    });

    const next = appReducer(state, {
      type: 'revisePipelinePlan',
      plan: '<proposed_plan>Revised</proposed_plan>',
    });

    assert.strictEqual(next.isProcessing, false);
    assert.strictEqual(next.currentTurn, null);
    assert.strictEqual(next.persisted.chatHistory.length, 0);
    assert.strictEqual(next.orchestration.plan?.status, 'pending');
    assert.strictEqual(next.orchestration.plan?.plan, '<proposed_plan>Revised</proposed_plan>');
    assert.strictEqual(next.orchestration.plan?.role, 'planner');
    assert.strictEqual(next.orchestration.plan?.agentName, 'Planner');
  });

  test('clearChat resets orchestration slice', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, {
      type: 'updatePipelineTimeline',
      timeline: [{ id: 'planner', label: 'Plan', status: 'running' }],
    });

    const cleared = appReducer(state, { type: 'clearChat' });
    assert.deepStrictEqual(cleared.orchestration, emptyOrchestrationSlice());
  });

  test('shared snapshot guard rejects older versions', () => {
    const localVersion = 5;
    const localUpdatedAt = 500;
    const current = { version: localVersion, updatedAt: localUpdatedAt };

    const olderVersion = { version: 4, updatedAt: 600 };
    const sameVersionOlderTime = { version: 5, updatedAt: 400 };
    const sameVersionSameTime = { version: 5, updatedAt: 500 };
    const newer = { version: 5, updatedAt: 501 };

    assert.strictEqual(shouldAcceptIncomingSharedState(current, olderVersion), false);
    assert.strictEqual(shouldAcceptIncomingSharedState(current, sameVersionOlderTime), false);
    assert.strictEqual(shouldAcceptIncomingSharedState(current, sameVersionSameTime), false);
    assert.strictEqual(shouldAcceptIncomingSharedState(current, newer), true);
  });
});
