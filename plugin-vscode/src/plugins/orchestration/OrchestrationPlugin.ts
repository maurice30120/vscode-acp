import * as vscode from 'vscode';
import { PipelineService } from '@acp-client/pipeline';

import {
  getAgentConfigs,
  isSandcastleAgentConfig,
  type AgentConfigEntry,
} from '../../config/AgentConfig';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
  getPipelinePrograms,
} from '../../config/PipelineCatalog';
import { isPipelineEnabled } from '../../config/PipelineConfig';
import type { SessionManager } from '../../core/SessionManager';
import { DefaultEphemeralAgentRunner } from '../../core/EphemeralAgentRunner';
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
    const pipelineService = new PipelineService(context.workspaceCwd, {
      getPipelineDefinitions: () => getPipelineDefinitions(context.workspaceCwd(), readAgentConfigs()),
      getPipelineDefinitionForAgent: agentName =>
        getPipelineDefinitionForAgent(agentName, context.workspaceCwd(), readAgentConfigs()),
      getPipelinePrograms: () => getPipelinePrograms(context.workspaceCwd(), readAgentConfigs()),
      getAgentConfigs: readAgentConfigs,
      runAgent: input => ephemeralRunner.run(input),
      isAgentSandcastle: (agentName, agentConfigs) => {
        const config = agentConfigs[agentName] as AgentConfigEntry | undefined;
        return config ? isSandcastleAgentConfig(config) : false;
      },
      isRunAbortedError,
    });
    const runtime = new OrchestrationRuntime(pipelineService, sessionManager, chatController);
    const disposables: vscode.Disposable[] = [];
    disposables.push(runtime.activate());
    const refresh = () => sessionTreeProvider.invalidate();

    for (const pattern of ['**/.acp/acp-agents.json', '**/.acp/pipelines/*.yaml', '**/.acp/pipelines/*.yml']) {
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
