import { AgentProcessManager } from './agentProcess.js';
import { ConnectionManager, type ConnectionInfo } from './connectionManager.js';
import { SessionUpdateHandler } from './sessionUpdateHandler.js';
import type { Logger, NativeAcpAgentConfig, PiPermissionContext } from '../types.js';

export interface AcpConnectorInput {
  agentName: string;
  config: NativeAcpAgentConfig;
  workspaceCwd: string;
  sessionUpdateHandler: SessionUpdateHandler;
  getPermissionContext: () => PiPermissionContext | undefined;
  logger?: Logger;
}

export interface ConnectedAcpAgent {
  agentId: string;
  connInfo: ConnectionInfo;
  dispose: () => void;
}

export type AcpConnector = (input: AcpConnectorInput) => Promise<ConnectedAcpAgent>;

export const defaultAcpConnector: AcpConnector = async (input) => {
  const agentManager = new AgentProcessManager(input.logger);
  const connectionManager = new ConnectionManager(input.sessionUpdateHandler, {
    logger: input.logger,
    getPermissionContext: input.getPermissionContext,
  });

  const agentInstance = agentManager.spawnAgent(input.agentName, input.config, input.workspaceCwd);
  const agentId = agentInstance.id;

  let connInfo: ConnectionInfo;
  try {
    connInfo = await connectionManager.connect(agentId, agentInstance.process, input.workspaceCwd);
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

  return { agentId, connInfo, dispose };
};
