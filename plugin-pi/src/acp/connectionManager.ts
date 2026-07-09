import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type InitializeResponse,
} from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { FileSystemHandler } from './fileSystemHandler.js';
import { PermissionHandler } from './permissionHandler.js';
import { PiAcpClient } from './piAcpClient.js';
import { SessionUpdateHandler } from './sessionUpdateHandler.js';
import { TerminalHandler } from './terminalHandler.js';
import type { Logger, PiPermissionContext } from '../types.js';

export interface ConnectionInfo {
  connection: ClientSideConnection;
  client: PiAcpClient;
  initResponse: InitializeResponse;
}

export interface ConnectionManagerOptions {
  logger?: Logger;
  getPermissionContext: () => PiPermissionContext | undefined;
  autoApprovePermissions?: boolean;
}

export class ConnectionManager {
  private readonly connections = new Map<string, ConnectionInfo>();

  constructor(
    private readonly sessionUpdateHandler: SessionUpdateHandler,
    private readonly options: ConnectionManagerOptions,
  ) {}

  async connect(
    agentId: string,
    process: ChildProcess,
    workspaceCwd: string,
  ): Promise<ConnectionInfo> {
    if (!process.stdout || !process.stdin) {
      throw new Error('Agent process missing stdio streams');
    }

    this.options.logger?.log(`Connecting to ACP agent ${agentId}`);
    const readable = Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>;
    const writable = Writable.toWeb(process.stdin) as WritableStream<Uint8Array>;
    const stream = ndJsonStream(writable, readable);

    let client: PiAcpClient | null = null;
    const connection = new ClientSideConnection(
      (_agent: Agent) => {
        client = new PiAcpClient(
          new FileSystemHandler(workspaceCwd),
          new TerminalHandler(workspaceCwd),
          new PermissionHandler(this.options.getPermissionContext, {
            autoApproveAll: this.options.autoApprovePermissions,
          }),
          this.sessionUpdateHandler,
        );
        return client;
      },
      stream,
    );

    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'acp-pi-extension',
        version: '0.0.0',
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    });

    if (!client) {
      throw new Error('ACP client was not initialized.');
    }

    this.options.logger?.log(
      `ACP initialized. Agent: ${initResponse.agentInfo?.name ?? 'unknown'} v${initResponse.agentInfo?.version ?? '?'}`,
    );

    const info: ConnectionInfo = { connection, client, initResponse };
    this.connections.set(agentId, info);
    return info;
  }

  removeConnection(agentId: string): void {
    this.connections.delete(agentId);
  }

  dispose(): void {
    for (const info of this.connections.values()) {
      info.client.dispose();
    }
    this.connections.clear();
  }
}
