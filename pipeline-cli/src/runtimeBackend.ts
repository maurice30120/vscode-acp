import {
  EphemeralAcpRunner,
  getPipelinePrograms,
  loadAgentCatalog,
  type RuntimePermissionContext,
} from '@acp-client/runtime';
import { clearSandcastleLogs } from '@acp-client/sandcastle';
import type { CliPipelineBackendFactory } from './host.js';

export const createRuntimeCliBackend: CliPipelineBackendFactory = (workspaceCwd, context) => {
  const catalog = loadAgentCatalog(workspaceCwd);
  if (catalog.errors.length > 0) {
    throw new Error(`Invalid workspace ACP configuration:\n- ${catalog.errors.join('\n- ')}`);
  }

  const runner = new EphemeralAcpRunner(workspaceCwd, {
    getPermissionContext: (): RuntimePermissionContext => ({
      hasUI: true,
      ui: {
        select: (title, options) => context.terminal.select(title, options),
        confirm: (title, message) => context.terminal.confirm(title, message),
      },
    }),
    getAgentConfigs: () => catalog.agents,
    timeouts: catalog.native.pipeline.timeouts,
    getSandcastlePromotion: () => catalog.sandcastle.promotion,
    requestSandcastlePromotion: async request => {
      const selected = await context.terminal.select(
        [
          `Sandcastle promotion for ${request.agentName}`,
          `Files changed: ${request.preview.filesChanged}`,
          `Branch: ${request.preview.branch || '(unknown)'}`,
          `Base: ${request.preview.baseRef || '(unknown)'}`,
        ].join('\n'),
        ['Apply Sandcastle changes', 'Reject Sandcastle changes'],
      );
      if (selected === 'Apply Sandcastle changes') return 'approve';
      if (selected === 'Reject Sandcastle changes') return 'reject';
      return 'cancelled';
    },
    logger: context.logger,
  });

  return {
    programs: getPipelinePrograms(workspaceCwd, context.logger),
    runAgent: runner.run,
    clearRunLogs: () => clearSandcastleLogs(workspaceCwd),
  };
};
