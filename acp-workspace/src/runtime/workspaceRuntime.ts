import type { CompiledPipelineProgram, PipelineAgentRunner } from '@acp-client/pipeline';
import {
  EphemeralAcpRunner,
  type AcpConnector,
  type SandcastleConnector,
} from '@acp-client/runtime';
import { clearSandcastleLogs } from '@acp-client/sandcastle';

import { getPipelinePrograms } from '../catalog/pipelineCatalog.js';
import { loadAgentCatalog } from '../config/config.js';
import type { AgentCatalog, WorkspaceRuntimeHost, WorkspaceRuntimeOptions } from '../types.js';

export interface WorkspaceRuntime {
  programs: CompiledPipelineProgram[];
  runAgent: PipelineAgentRunner;
  reload(): void;
  clearRunLogs(): void;
  dispose(): Promise<void>;
  getAgentCatalog(): AgentCatalog;
  getPipelinePrograms(): CompiledPipelineProgram[];
}

export interface CreateWorkspaceRuntimeOptions extends WorkspaceRuntimeOptions {
  connector?: AcpConnector;
  sandcastleConnector?: SandcastleConnector;
}

/** Compose the tested low-level ACP runner with workspace-owned discovery and policy. */
export function createWorkspaceRuntime(options: CreateWorkspaceRuntimeOptions): WorkspaceRuntime {
  let catalog = loadValidCatalog(options.workspaceCwd);
  let programs = getPipelinePrograms(options.workspaceCwd, options.host.logger);
  let disposed = false;

  const runner = new EphemeralAcpRunner(options.workspaceCwd, {
    getAgentConfigs: () => catalog.agents,
    getPermissionContext: () => options.host.permissionContext(),
    getSandcastlePromotion: () => catalog.sandcastle.promotion,
    requestSandcastlePromotion: request => options.host.requestPromotion(request),
    timeouts: catalog.native.pipeline.timeouts,
    connector: options.connector,
    sandcastleConnector: options.sandcastleConnector,
    logger: options.host.logger,
  });

  return {
    get programs() { return programs; },
    runAgent: runner.run,
    reload() {
      catalog = loadValidCatalog(options.workspaceCwd);
      programs = getPipelinePrograms(options.workspaceCwd, options.host.logger);
    },
    clearRunLogs() { clearSandcastleLogs(options.workspaceCwd); },
    async dispose() { disposed = true; },
    getAgentCatalog() { return catalog; },
    getPipelinePrograms() { return programs; },
  };
}

function loadValidCatalog(workspaceCwd: string): AgentCatalog {
  const catalog = loadAgentCatalog(workspaceCwd);
  if (catalog.errors.length > 0) {
    throw new Error(`Invalid workspace ACP configuration:\n- ${catalog.errors.join('\n- ')}`);
  }
  return catalog;
}
