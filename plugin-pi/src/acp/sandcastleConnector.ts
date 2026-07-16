import type { PipelinePermissions } from '@acp-client/pipeline';
import { fileURLToPath } from 'node:url';

import { AgentProcessManager, observeAgentProcessExit, type ProcessAgentConfig } from './agentProcess.js';
import { ConnectionManager, type ConnectionInfo } from './connectionManager.js';
import { type ConnectedAcpAgent } from './defaultConnector.js';
import type { PartialAcpOperationTimeouts } from './operationGuards.js';
import { loadSandcastleEnv } from './sandcastleEnv.js';
import { SessionUpdateHandler } from './sessionUpdateHandler.js';
import type { Logger, PiPermissionContext, SandcastleAgentConfig } from '../types.js';

export interface SandcastleConnectorInput {
  agentName: string;
  config: SandcastleAgentConfig;
  workspaceCwd: string;
  sessionUpdateHandler: SessionUpdateHandler;
  getPermissionContext: () => PiPermissionContext | undefined;
  permissions?: PipelinePermissions;
  timeouts?: PartialAcpOperationTimeouts;
  logger?: Logger;
}

export type SandcastleConnector = (input: SandcastleConnectorInput) => Promise<ConnectedAcpAgent>;

export function buildSandcastleBridgeProcessConfig(
  config: SandcastleAgentConfig,
  workspaceCwd = process.cwd(),
): ProcessAgentConfig {
  const bridgePath = fileURLToPath(new URL('../sandcastle/bridge.js', import.meta.url));
  const args = [
    bridgePath,
    '--provider',
    config.provider,
    '--model',
    config.model,
  ];
  if (config.effort) {
    args.push('--effort', config.effort);
  }
  const fileEnv = loadSandcastleEnv(workspaceCwd);
  const env = {
    ...fileEnv,
    ...(config.env ?? {}),
    ACP_SANDCASTLE_IMAGE: config.env?.ACP_SANDCASTLE_IMAGE
      ?? fileEnv.ACP_SANDCASTLE_IMAGE
      ?? process.env.ACP_SANDCASTLE_IMAGE
      ?? 'acp-client-sandcastle:local',
  };

  return {
    command: process.execPath,
    args,
    env,
  };
}

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
