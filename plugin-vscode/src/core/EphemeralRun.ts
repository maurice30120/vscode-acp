import type { ContentBlock, SessionNotification } from '@agentclientprotocol/sdk';
import {
  renderAcpPrompt,
  renderExplicitPipelineSkills,
  type PipelineNodePrompt,
  type PipelinePermissions,
} from '@acp-client/pipeline';

import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { buildPromptWithSkills } from '../skills/SkillsPromptBuilder';
import { isSkillsEnabledAgent } from '../skills/SkillsConfig';
import { prepareCursorSkillsSymlink } from '../skills/SkillsWorkspacePrep';
import { SkillsCatalog } from '../skills/SkillsCatalog';
import { log, logError } from '../utils/Logger';
import { connectEphemeralAcpAgent, createEphemeralAcpSession } from './AgentConnectionFactory';
import { AgentManager } from './AgentManager';
import type { ConnectionInfo } from './ConnectionManager';
import { RunAbortedError } from './RunAbortedError';
import { SessionAuthHandler } from './SessionAuthHandler';

export interface EphemeralRunSandboxContext {
  connection: {
    extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  sessionId: string;
  /** Close the prompt-capable agent session while keeping Sandcastle promotion methods available. */
  closeAgentSession: () => Promise<void>;
  /** Tear down the bridge process after Sandcastle promotion finishes. */
  dispose: () => void;
}

export interface EphemeralRunOptions {
  onSessionUpdate?: (update: SessionNotification) => void;
  signal?: AbortSignal;
}

export interface EphemeralRunResult {
  text: string;
  sandbox?: EphemeralRunSandboxContext;
}

export interface EphemeralRunCollectionState {
  collectedText: string;
}

export interface EphemeralRunInput extends EphemeralRunOptions {
  workspaceCwd: string;
  agentName: string;
  promptText: string;
  prompt?: PipelineNodePrompt;
  permissions?: PipelinePermissions;
  skills?: readonly string[];
}

export function handleEphemeralSessionUpdate(
  update: SessionNotification,
  sessionId: string | null,
  state: EphemeralRunCollectionState,
  onSessionUpdate?: (update: SessionNotification) => void,
): void {
  if (sessionId && update.sessionId !== sessionId) {
    return;
  }

  const updateData = update.update as any;
  if (updateData?.sessionUpdate === 'agent_message_chunk') {
    const content = updateData.content;
    if (content?.type === 'text' && typeof content.text === 'string') {
      state.collectedText += content.text;
    }
  }

  onSessionUpdate?.(update);
}

export function buildEphemeralRunPrompt(input: Pick<EphemeralRunInput, 'agentName' | 'workspaceCwd' | 'promptText' | 'skills'>): string {
  return buildPromptWithSkills({
    agentName: input.agentName,
    workspaceCwd: input.workspaceCwd,
    text: input.promptText,
    skillsBootstrapped: false,
    skills: input.skills,
  }).text;
}

export function buildEphemeralRunPromptBlocks(
  input: Pick<EphemeralRunInput, 'agentName' | 'workspaceCwd' | 'promptText' | 'prompt' | 'skills'>,
): ContentBlock[] {
  if (!input.prompt) {
    return [{ type: 'text', text: buildEphemeralRunPrompt(input) }];
  }

  return renderAcpPrompt(input.prompt, {
    renderSkills: skillNames => {
      if (!isSkillsEnabledAgent(input.agentName) || skillNames.length === 0) {
        return '';
      }
      const resolved = new SkillsCatalog(input.workspaceCwd).resolveExplicitSkills(skillNames);
      if (resolved.errors.length > 0) {
        throw new Error(resolved.errors.join('\n'));
      }
      return renderExplicitPipelineSkills(resolved.skills);
    },
  });
}

/**
 * Short-lived ACP run for PipelineStep and InlineEdit — spawn, prompt, teardown.
 * Does not register a ConnectedAgent or SessionRecord.
 */
export async function runEphemeralRun(input: EphemeralRunInput): Promise<EphemeralRunResult> {
  const { workspaceCwd: cwd, agentName, permissions, onSessionUpdate, signal } = input;
  if (signal?.aborted) {
    throw new RunAbortedError();
  }

  const config = getAgentConfig(agentName);
  if (!config) {
    throw new Error(`EphemeralRun agent "${agentName}" is not configured in .acp/acp-agents.json.`);
  }

  const sessionUpdateHandler = new SessionUpdateHandler();
  const authHandler = new SessionAuthHandler(new AgentManager());
  let sessionId: string | null = null;
  const collectionState: EphemeralRunCollectionState = { collectedText: '' };
  let connInfo: ConnectionInfo | null = null;
  let disposeRun = (): void => {};

  const throwIfAborted = (): void => {
    if (signal?.aborted) {
      throw new RunAbortedError();
    }
  };

  const onAbort = (): void => {
    void (async () => {
      if (sessionId && connInfo) {
        try {
          await connInfo.connection.cancel({ sessionId });
        } catch (e) {
          logError('EphemeralRun: cancel failed', e);
        }
      }
      disposeRun();
    })();
  };

  signal?.addEventListener('abort', onAbort, { once: true });

  const listener = (update: SessionNotification) => {
    handleEphemeralSessionUpdate(update, sessionId, collectionState, onSessionUpdate);
  };

  sessionUpdateHandler.addListener(listener);

  let deferCleanup = false;

  try {
    throwIfAborted();
    log(`EphemeralRun: starting "${agentName}"`);

    const connection = await connectEphemeralAcpAgent({
      agentName,
      config,
      workspaceCwd: cwd,
      permissions,
      sessionUpdateHandler,
    });
    connInfo = connection.connInfo;
    disposeRun = connection.dispose;
    throwIfAborted();

    const sessionResponse = await createEphemeralAcpSession(
      agentName,
      connection.agentId,
      connInfo,
      cwd,
      authHandler,
      throwIfAborted,
    );
    sessionId = sessionResponse.sessionId;
    throwIfAborted();

    if (isSkillsEnabledAgent(agentName)) {
      if (agentName === 'Cursor CLI') {
        prepareCursorSkillsSymlink(cwd);
      }
      const skills = new SkillsCatalog(cwd).listSkills();
      log(`EphemeralRun: discovered ${skills.length} skill(s) for "${agentName}"`);
    }

    await connInfo.connection.prompt({
      sessionId,
      prompt: buildEphemeralRunPromptBlocks(input),
    });

    if (signal?.aborted) {
      throw new RunAbortedError();
    }

    const result: EphemeralRunResult = {
      text: collectionState.collectedText.trim(),
    };

    if (isSandcastleAgentConfig(config)) {
      deferCleanup = true;
      result.sandbox = {
        connection: connInfo.connection,
        sessionId,
        closeAgentSession: async () => {
          await connInfo?.connection.extMethod('sandcastle/close-agent-session', { sessionId });
        },
        dispose: disposeRun,
      };
    }

    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    sessionUpdateHandler.removeListener(listener);
    if (!deferCleanup) {
      disposeRun();
    }
  }
}
