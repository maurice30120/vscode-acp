import type { PipelinePermissions } from '@acp-client/pipeline';

import { AgentProcessManager, observeAgentProcessExit, type ProcessAgentConfig } from './agentProcess.js';
import { ConnectionManager, type ConnectionInfo } from './connectionManager.js';
import { type ConnectedAcpAgent } from './defaultConnector.js';
import type { PartialAcpOperationTimeouts } from './operationGuards.js';
import { buildSandcastleBridgeProcessConfig } from '@acp-client/sandcastle';
import { SessionUpdateHandler } from './sessionUpdateHandler.js';
import type { Logger, RuntimePermissionContext, SandcastleAgentConfig } from '../types.js';

export interface SandcastleConnectorInput {
  agentName: string;
  config: SandcastleAgentConfig;
  workspaceCwd: string;
  sessionUpdateHandler: SessionUpdateHandler;
  getPermissionContext: () => RuntimePermissionContext | undefined;
  permissions?: PipelinePermissions;
  timeouts?: PartialAcpOperationTimeouts;
  logger?: Logger;
}

export type SandcastleConnector = (input: SandcastleConnectorInput) => Promise<ConnectedAcpAgent>;

export const sandcastleConnector: SandcastleConnector = async (input) => {
  const agentManager = new AgentProcessManager(input.logger);
  const connectionManager = new ConnectionManager(input.sessionUpdateHandler, {
    logger: input.logger,
    getPermissionContext: input.getPermissionContext,
    autoApprovePermissions: true,
    timeouts: input.timeouts,
  });

  const processConfig = buildSandcastleBridgeProcessConfig(input.config, input.workspaceCwd);
  const agentInstance = agentManager.spawnAgent(input.agentName, processConfig, input.workspaceCwd);
  const agentId = agentInstance.id;
  const processExit = observeAgentProcessExit(agentInstance);

  let connInfo: ConnectionInfo;
  try {
    connInfo = await connectionManager.connect(agentId, agentInstance.process, input.workspaceCwd, processExit);
  } catch (e: unknown) {
    agentManager.killAgent(agentId);
    connectionManager.dispose();
    throw e;
  }

  const dispose = (): void => {
    agentManager.killAll();
    connectionManager.dispose();
    input.sessionUpdateHandler.dispose();
  };

  return { agentId, connInfo, processExit, dispose };
};
