import * as vscode from 'vscode';
import { PipelineService, serializeCompiledTeamPipeline } from '@acp-client/pipeline';

import {
  getAgentConfigs,
  getAgentNames,
  isSandcastleAgentConfig,
  type AgentConfigEntry,
} from '../../config/AgentConfig';
import { getTeamEntryForAgent } from '../../config/AgentTeamCatalog';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
} from '../../config/PipelineCatalog';
import { isPipelineEnabled } from '../../config/PipelineConfig';
import type { SessionManager } from '../../core/SessionManager';
import { DefaultEphemeralAgentRunner } from '../../core/EphemeralAgentRunner';
import { isRunAbortedError } from '../../core/RunAbortedError';
import { defaultGitCommandRunner } from '../../git/GitCommandRunner';
import type { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';
import type { ChatWebviewController } from '../../ui/ChatWebviewController';
import type { SessionTreeProvider } from '../../ui/SessionTreeProvider';
import { classifyAgentError } from '../../core/AgentError';
import { getOutputChannel } from '../../utils/Logger';
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
    const pipelineService = new PipelineService(context.workspaceCwd, {
      getPipelineDefinitions: () => getPipelineDefinitions(context.workspaceCwd(), getAgentConfigs()),
      getPipelineDefinitionForAgent: agentName =>
        getPipelineDefinitionForAgent(agentName, context.workspaceCwd(), getAgentConfigs()),
      getAgentConfigs,
      runAgent: input => ephemeralRunner.run(input),
      isAgentSandcastle: (agentName, agentConfigs) => {
        const config = agentConfigs[agentName] as AgentConfigEntry | undefined;
        return config ? isSandcastleAgentConfig(config) : false;
      },
      getTeamPipelineForAgent: teamAgentName =>
        getTeamEntryForAgent(teamAgentName, context.workspaceCwd(), getAgentConfigs())?.pipeline ?? null,
      readWorkspaceDiff: async () => {
        const result = await defaultGitCommandRunner.exec(context.workspaceCwd(), ['diff', 'HEAD']);
        return result.stdout.trim();
      },
      isRunAbortedError,
    });
    const runtime = new OrchestrationRuntime(pipelineService, sessionManager, chatController);
    const disposables: vscode.Disposable[] = [];
    disposables.push(runtime.activate());
    const refresh = () => sessionTreeProvider.invalidate();

    for (const pattern of ['**/.acp/pipelines/*.yaml', '**/.acp/pipelines/*.yml', '**/.acp/teams/*.yaml', '**/.acp/teams/*.yml']) {
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
        event.affectsConfiguration('acp.agents')
        || event.affectsConfiguration('acp.pipeline.enabled')
        || event.affectsConfiguration('acp.defaultWorkingDirectory')
        || event.affectsConfiguration('acp.instructions.maxBytes')
      ) {
        void vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, isPipelineEnabled());
        refresh();
      }
    }));

    void vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, isPipelineEnabled());

    const resolveAgentName = async (value?: string | any): Promise<string | undefined> => {
      if (typeof value === 'string') { return value; }
      if (value?.agentName) { return value.agentName; }
      const names = getAgentNames();
      if (names.length === 0) {
        void vscode.window.showWarningMessage('No ACP agents configured. Add agents in Settings > ACP > Agents.');
        return undefined;
      }
      return vscode.window.showQuickPick(names, { placeHolder: 'Select an agent to connect', title: 'Connect to Agent' });
    };

    const setEnabled = async (enabled: boolean): Promise<void> => {
      await vscode.workspace.getConfiguration('acp').update('pipeline.enabled', enabled, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, enabled);
      refresh();
      void vscode.window.showInformationMessage(`ACP pipeline agents ${enabled ? 'enabled' : 'disabled'}.`);
    };

    disposables.push(
      vscode.commands.registerCommand('acp.enablePipelineAgents', () => setEnabled(true)),
      vscode.commands.registerCommand('acp.disablePipelineAgents', () => setEnabled(false)),
      vscode.commands.registerCommand('acp.showCompiledTeamPipeline', async (value?: string | any) => {
        const agentName = await resolveAgentName(value);
        if (!agentName) { return; }
        const pipeline = pipelineService.getCompiledPipelineForTeam(agentName.replace(/ \(invalid\)$/, ''));
        if (!pipeline) {
          void vscode.window.showWarningMessage(`"${agentName}" is not a valid agent team.`);
          return;
        }
        const document = await vscode.workspace.openTextDocument({
          content: serializeCompiledTeamPipeline(pipeline),
          language: 'json',
        });
        await vscode.window.showTextDocument(document, { preview: true });
      }),
      vscode.commands.registerCommand('acp.rerunTeamReviewer', async (value?: string | any) => {
        const activeSession = sessionManager.getActiveSession();
        const agentName = typeof value === 'string' ? value : activeSession?.agentName;
        if (!agentName) {
          void vscode.window.showWarningMessage('Connect to an agent team before re-running the reviewer.');
          return;
        }
        if (!pipelineService.getLastTeamRunSnapshot()) {
          void vscode.window.showWarningMessage('No completed team run is available for reviewer re-run.');
          return;
        }
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Re-running reviewer for ${agentName}...`, cancellable: true },
            async (_progress, token) => {
              token.onCancellationRequested(() => pipelineService.cancelReviewerRerun());
              const output = await pipelineService.rerunTeamReviewer(agentName.replace(/ \(invalid\)$/, ''));
              chatController.postMessage({ type: 'reviewerRerunReady', output });
            },
          );
        } catch (error) {
          const classified = classifyAgentError(error);
          const choice = await vscode.window.showErrorMessage(
            `Reviewer re-run failed: ${classified.message}`,
            'Show Log',
            'Open Settings',
          );
          if (choice === 'Show Log') { getOutputChannel().show(); }
          if (choice === 'Open Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'acp');
          }
        }
      }),
    );

    return vscode.Disposable.from(...disposables);
  }
}
