import * as vscode from 'vscode';
import { PipelineRuntimeAgentAdapter, PipelineService } from '@acp-client/pipeline';
import { clearSandcastleLogs } from '@acp-client/sandcastle';

import {
  getAgentConfigs,
  isSandcastleAgentConfig,
  type AgentConfigEntry,
} from '../../config/AgentConfig';
import {
  getPipelineProgramForAgent,
  getPipelinePrograms,
} from '../../config/PipelineCatalog';
import { isPipelineEnabled } from '../../config/PipelineConfig';
import { DefaultEphemeralAgentRunner } from '../../core/EphemeralAgentRunner';
import type { SessionManager } from '../../core/SessionManager';
import { isRunAbortedError } from '../../core/RunAbortedError';
import type { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';
import type { ChatWebviewController } from '../../ui/ChatWebviewController';
import type { SessionTreeProvider } from '../../ui/SessionTreeProvider';
import type { FeaturePlugin } from '../FeaturePlugin';
import { OrchestrationRuntime } from './OrchestrationRuntime';

export const PIPELINE_ENABLED_CONTEXT_KEY = 'acp.pipelineEnabled';

export interface OrchestrationPluginContext {
  sessionManager: SessionManager;
  sessionTreeProvider: SessionTreeProvider;
  chatController: ChatWebviewController;
  workspaceCwd: () => string;
  sandcastlePromotion: SandcastlePromotion;
}

export class OrchestrationPlugin implements FeaturePlugin<OrchestrationPluginContext> {
  readonly id = 'orchestration';

  activate(context: OrchestrationPluginContext): vscode.Disposable {
    const { sessionManager, sessionTreeProvider, chatController, sandcastlePromotion } = context;
    const ephemeralRunner = new DefaultEphemeralAgentRunner(sandcastlePromotion);
    const readAgentConfigs = () => getAgentConfigs(context.workspaceCwd());
    const serviceRef: { current?: PipelineService } = {};
    const createSession = new PipelineRuntimeAgentAdapter({
      workspaceCwd: context.workspaceCwd,
      runAgent: input => ephemeralRunner.run(input),
      onSessionUpdate: (runId, node, update) => {
        serviceRef.current?.emit('session-update', {
          sessionId: runId,
          phase: node.id,
          update,
          stepId: node.id,
          role: node.id,
          agentName: node.agent,
        });
      },
      onStatus: (runId, node, update) => {
        serviceRef.current?.emit('status', {
          sessionId: runId,
          status: update.status,
          message: update.message,
          stepId: node.id,
          role: node.id,
          agentName: node.agent,
        });
      },
    }).asSessionFactory();
    const pipelineService = new PipelineService(context.workspaceCwd, {
      getPipelinePrograms: () => getPipelinePrograms(context.workspaceCwd(), readAgentConfigs()),
      getPipelineProgramForAgent: agentName =>
        getPipelineProgramForAgent(agentName, context.workspaceCwd(), readAgentConfigs()),
      getAgentConfigs: readAgentConfigs,
      isAgentSandcastle: (agentName, agentConfigs) => {
        const config = agentConfigs[agentName] as AgentConfigEntry | undefined;
        return config ? isSandcastleAgentConfig(config) : false;
      },
      createSession,
      isRunAbortedError,
      onPipelineStart: ({ workspaceCwd }) => clearSandcastleLogs(workspaceCwd),
    });
    serviceRef.current = pipelineService;
    const runtime = new OrchestrationRuntime(pipelineService, sessionManager, chatController);
    const disposables: vscode.Disposable[] = [];
    disposables.push(runtime.activate());
    const refresh = () => sessionTreeProvider.invalidate();

    for (const pattern of ['**/.acp/acp-agents.json', '**/.acp/.sandcastle/config.json', '**/.acp/pipelines/*.yaml', '**/.acp/pipelines/*.yml']) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      disposables.push(
        watcher,
        watcher.onDidCreate(refresh),
        watcher.onDidChange(refresh),
        watcher.onDidDelete(refresh),
      );
    }

    disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration('acp.pipeline.enabled')
        || event.affectsConfiguration('acp.defaultWorkingDirectory')
        || event.affectsConfiguration('acp.instructions.maxBytes')
      ) {
        void vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, isPipelineEnabled());
        refresh();
      }
    }));

    void vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, isPipelineEnabled());

    const setEnabled = async (enabled: boolean): Promise<void> => {
      await vscode.workspace.getConfiguration('acp').update('pipeline.enabled', enabled, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, enabled);
      refresh();
      void vscode.window.showInformationMessage(`ACP pipeline agents ${enabled ? 'enabled' : 'disabled'}.`);
    };

    disposables.push(
      vscode.commands.registerCommand('acp.enablePipelineAgents', () => setEnabled(true)),
      vscode.commands.registerCommand('acp.disablePipelineAgents', () => setEnabled(false)),
    );

    return vscode.Disposable.from(...disposables);
  }
}
