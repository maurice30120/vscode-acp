import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { Agent, InitializeResponse } from '@agentclientprotocol/sdk';
import type { Stream } from '@agentclientprotocol/sdk/dist/stream.js';
import { ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { AcpClientImpl } from './AcpClientImpl';
import { FileSystemHandler } from '../handlers/FileSystemHandler';
import { TerminalHandler } from '../handlers/TerminalHandler';
import { PermissionHandler } from '../handlers/PermissionHandler';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { log, logError, logTraffic } from '../utils/Logger';
import { version as extensionVersion } from '../../package.json';

export interface ConnectionInfo {
  connection: ClientSideConnection;
  client: AcpClientImpl;
  initResponse: InitializeResponse;
}

/**
 * Gere les connexions ACP vers les processus d'agents.
 * Cree des instances ClientSideConnection a partir des processus lances.
 */
export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();

  constructor(
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {}

  /**
   * Cree une connexion ACP a partir d'un processus enfant.
   * Prepare les flux, cree la connexion, puis effectue le handshake d'initialisation.
   */
  async connect(agentId: string, process: ChildProcess): Promise<ConnectionInfo> {
    if (!process.stdout || !process.stdin) {
      throw new Error('Agent process missing stdio streams');
    }

    log(`ConnectionManager: connecting to agent ${agentId}`);

    // Cree des Web Streams a partir des flux Node.js
    const readable = Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>;
    const writable = Writable.toWeb(process.stdin) as WritableStream<Uint8Array>;

    const stream = ndJsonStream(writable, readable);

    // Enveloppe le flux pour intercepter et journaliser tout le trafic ACP
    const tappedStream = this.tapStream(stream);

    // Instancie les handlers de capacites
    const fsHandler = new FileSystemHandler();
    const terminalHandler = new TerminalHandler();
    const permissionHandler = new PermissionHandler();

    // Cree l'implementation du client ACP
    const client = new AcpClientImpl(
      fsHandler,
      terminalHandler,
      permissionHandler,
      this.sessionUpdateHandler,
    );

    // Cree la connexion : la factory toClient recoit le proxy Agent
    const connection = new ClientSideConnection(
      (agent: Agent) => {
        client.setAgent(agent);
        return client;
      },
      tappedStream,
    );

    // Initialise la connexion cote client
    log(`ConnectionManager: initializing connection to agent ${agentId}`);
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'vscode-acp-client',
        version: extensionVersion,
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    });

    log(`ConnectionManager: initialized. Agent: ${initResponse.agentInfo?.name || 'unknown'} v${initResponse.agentInfo?.version || '?'}`);

    const info: ConnectionInfo = { connection, client, initResponse };
    this.connections.set(agentId, info);

    return info;
  }

  getConnection(agentId: string): ConnectionInfo | undefined {
    return this.connections.get(agentId);
  }

  removeConnection(agentId: string): void {
    this.connections.delete(agentId);
  }

  dispose(): void {
    this.connections.clear();
  }

  /**
   * Enveloppe un Stream pour logger les messages sortants et entrants.
   */
  private tapStream(stream: Stream): Stream {
    // Intercepte les messages sortants (client -> agent)
    const sendTap = new TransformStream({
      transform(chunk: unknown, controller: TransformStreamDefaultController) {
        logTraffic('send', chunk);
        controller.enqueue(chunk);
      },
    });

    // Intercepte les messages entrants (agent -> client)
    const recvTap = new TransformStream({
      transform(chunk: unknown, controller: TransformStreamDefaultController) {
        logTraffic('recv', chunk);
        controller.enqueue(chunk);
      },
    });

    // Pipeline : sendTap.readable -> writable original, readable original -> recvTap.writable
    // Ces pipelines tournent en arriere-plan, inutile de await
    void sendTap.readable.pipeTo(stream.writable).catch(e => logError('Traffic tap send pipe error', e));
    void stream.readable.pipeTo(recvTap.writable).catch(e => logError('Traffic tap recv pipe error', e));

    return {
      writable: sendTap.writable,
      readable: recvTap.readable,
    };
  }
}
