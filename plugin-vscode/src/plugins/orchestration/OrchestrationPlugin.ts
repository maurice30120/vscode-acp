import * as vscode from 'vscode';
import { PipelineRuntimeAgentAdapter, PipelineService } from '@acp-client/pipeline';
import {
  EphemeralAcpRunner,
  type RuntimePermissionContext,
  type SandcastlePromotionRequest,
} from '@acp-client/runtime';
import { loadAgentCatalog, type AgentConfigEntry } from '@acp-client/workspace';
import { clearSandcastleLogs } from '@acp-client/sandcastle';

import { getAgentConfigs } from '../../config/AgentConfig';
import {
  getPipelineProgramForAgent,
  getPipelinePrograms,
} from '../../config/PipelineCatalog';
import { isPipelineEnabled } from '../../config/PipelineConfig';
import type { SessionManager } from '../../core/SessionManager';
import { isRunAbortedError } from '../../core/RunAbortedError';
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
}

export class OrchestrationPlugin implements FeaturePlugin<OrchestrationPluginContext> {
  readonly id = 'orchestration';

  activate(context: OrchestrationPluginContext): vscode.Disposable {
    const { sessionManager, sessionTreeProvider, chatController } = context;
    const readAgentConfigs = () => getAgentConfigs(context.workspaceCwd());
    const runtimeCatalog = loadAgentCatalog(context.workspaceCwd());
    const ephemeralRunner = new EphemeralAcpRunner(context.workspaceCwd(), {
      getAgentConfigs: () => readAgentConfigs(),
      getPermissionContext: createVsCodePermissionContext,
      timeouts: runtimeCatalog.native.pipeline.timeouts,
      getSandcastlePromotion: () => readSandcastlePromotionMode(),
      requestSandcastlePromotion: requestVsCodeSandcastlePromotion,
    });
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
        return config?.transport === 'sandcastle';
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

function createVsCodePermissionContext(): RuntimePermissionContext {
  return {
    hasUI: true,
    ui: {
      select: async (title, options) => vscode.window.showQuickPick(options, { title, ignoreFocusOut: true }),
      confirm: async (title, message) => {
        const selected = await vscode.window.showWarningMessage(
          message ? `${title}\n\n${message}` : title,
          { modal: true },
          'Confirm',
        );
        return selected === 'Confirm';
      },
    },
  };
}

function readSandcastlePromotionMode(): 'ask' | 'autoApply' | 'autoReject' {
  const mode = vscode.workspace.getConfiguration('acp').get<string>('sandcastle.promotion', 'ask');
  return mode === 'autoApply' || mode === 'autoReject' ? mode : 'ask';
}

async function requestVsCodeSandcastlePromotion(
  request: SandcastlePromotionRequest,
): Promise<'approve' | 'reject' | 'cancelled'> {
  const choices = [
    { label: '$(diff) View Diff', choice: 'diff' as const },
    { label: '$(check) Apply', choice: 'approve' as const },
    { label: '$(close) Reject', choice: 'reject' as const },
  ];
  let allowDiff = true;
  while (true) {
    const selected = await vscode.window.showQuickPick(
      allowDiff ? choices : choices.slice(1),
      {
        title: `Sandcastle changes from ${request.agentName}`,
        placeHolder: `${request.preview.filesChanged} file(s) changed`,
        ignoreFocusOut: true,
      },
    );
    if (!selected) {
      return 'cancelled';
    }
    if (selected.choice === 'approve' || selected.choice === 'reject') {
      return selected.choice;
    }
    const document = await vscode.workspace.openTextDocument({
      language: 'diff',
      content: request.preview.diff || '(no changes)',
    });
    await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    allowDiff = false;
  }
}
