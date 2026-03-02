import * as vscode from 'vscode';
import { EventEmitter } from 'node:events';

import type { NewSessionResponse, PromptResponse, InitializeResponse, ContentBlock, SessionModeState, SessionModelState, AvailableCommand } from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';

import { AgentManager } from './AgentManager';
import { ConnectionManager, ConnectionInfo } from './ConnectionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { getAgentConfigs } from '../config/AgentConfig';
import { log, logError } from '../utils/Logger';
import { sendEvent, sendError } from '../utils/TelemetryManager';

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  agentName: string;
  agentDisplayName: string;
  cwd: string;
  createdAt: string;
  initResponse: InitializeResponse;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  availableCommands: AvailableCommand[];
}

/**
 * Gere le cycle de vie des connexions ACP vers les agents.
 *
 * Le concept de "session" est masque a l'utilisateur final : il ne voit que les agents.
 * En interne, ACP reste base sur des sessions pour respecter le protocole, mais
 * le modele expose est simple : choisir un agent -> discuter.
 */
export class SessionManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private activeSessionId: string | null = null;

  /** Associe agentName -> activeSessionId pour garantir une session active par agent. */
  private agentSessions: Map<string, string> = new Map();

  constructor(
    private readonly agentManager: AgentManager,
    private readonly connectionManager: ConnectionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {
    super();
  }

  /**
   * Connecte un agent et demarre la conversation.
   * Un seul agent peut etre connecte a la fois : les autres sont deconnectes automatiquement.
   * Cette regle simplifie l'experience cote utilisateur.
   * La methode cree ensuite la session ACP necessaire en interne.
   */
  async connectToAgent(agentName: string): Promise<SessionInfo> {
    // Si une session vivante existe deja pour cet agent, on la reutilise
    const existingSessionId = this.agentSessions.get(agentName);
    if (existingSessionId && this.sessions.has(existingSessionId)) {
      this.activeSessionId = existingSessionId;
      this.emit('active-session-changed', existingSessionId);
      return this.sessions.get(existingSessionId)!;
    }

    // Deconnecte d'abord l'agent actif courant (modele mono-agent)
    const currentAgent = this.getActiveAgentName();
    if (currentAgent) {
      await this.disconnectAgent(currentAgent);
    }

    const configs = getAgentConfigs();
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(configs).join(', ')}`);
    }

    log(`SessionManager: connecting to agent "${agentName}"`);
    sendEvent('agent/connect.start', { agentName });
    const connectStartTime = Date.now();

    try {
      // Lance le processus de l'agent
      const agentInstance = this.agentManager.spawnAgent(agentName, config);
      const agentId = agentInstance.id;

      // Ecoute les erreurs et fermetures du processus agent
      this.agentManager.on('agent-error', (evt: { agentId: string; error: Error }) => {
        if (evt.agentId === agentId) {
          logError(`Agent ${agentName} error`, evt.error);
          this.emit('agent-error', agentId, evt.error);
        }
      });

      this.agentManager.on('agent-closed', (evt: { agentId: string; code: number | null }) => {
        if (evt.agentId === agentId) {
          log(`Agent ${agentName} closed with code ${evt.code}`);
          // Nettoie la session associee a cet agent
          const sessionId = this.agentSessions.get(agentName);
          if (sessionId) {
            this.sessions.delete(sessionId);
            this.agentSessions.delete(agentName);
            if (this.activeSessionId === sessionId) {
              this.activeSessionId = null;
            }
            this.emit('agent-disconnected', agentName);
            this.emit('active-session-changed', null);
          }
          this.emit('agent-closed', agentId, evt.code);
        }
      });

      // Etablit la connexion ACP puis initialise
      const agentProcess = this.agentManager.getAgent(agentId);
      if (!agentProcess) {
        throw new Error('Agent process not found after spawn');
      }

      let connInfo: ConnectionInfo;
      try {
        connInfo = await this.connectionManager.connect(agentId, agentProcess.process);
      } catch (e) {
        this.agentManager.killAgent(agentId);
        throw e;
      }

      // Cree la session ACP (avec gestion de l'authentification)
      const sessionInfo = await this.createAcpSession(agentName, agentId, connInfo);

      this.sessions.set(sessionInfo.sessionId, sessionInfo);
      this.agentSessions.set(agentName, sessionInfo.sessionId);
      this.activeSessionId = sessionInfo.sessionId;

      this.emit('agent-connected', agentName);
      this.emit('active-session-changed', sessionInfo.sessionId);

      log(`Connected to agent ${agentName}, session ${sessionInfo.sessionId}`);
      sendEvent('agent/connect.end', { agentName, result: 'success' }, { duration: Date.now() - connectStartTime });
      return sessionInfo;
    } catch (e: any) {
      sendError('agent/connect.end', { agentName, result: 'error', errorMessage: e.message || String(e) }, { duration: Date.now() - connectStartTime });
      throw e;
    }
  }

  /**
   * Demarre une nouvelle conversation avec l'agent actuellement connecte.
   * Deconnecte la session active, reconnecte l'agent, puis demande de vider le chat.
   */
  async newConversation(): Promise<SessionInfo | null> {
    const activeSession = this.getActiveSession();
    if (!activeSession) {
      return null;
    }

    const agentName = activeSession.agentName;
    await this.disconnectAgent(agentName);
    this.emit('clear-chat');
    return this.connectToAgent(agentName);
  }

  /**
   * Deconnecte un agent : arrete le processus et nettoie les references internes.
   */
  async disconnectAgent(agentName: string): Promise<void> {
    const sessionId = this.agentSessions.get(agentName);
    if (!sessionId) { return; }

    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    log(`Disconnecting agent ${agentName}`);
    sendEvent('agent/disconnect', { agentName });

    this.agentManager.killAgent(session.agentId);
    this.connectionManager.removeConnection(session.agentId);
    this.sessions.delete(sessionId);
    this.agentSessions.delete(agentName);

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }

    this.emit('agent-disconnected', agentName);
    this.emit('active-session-changed', null);
  }

  /**
   * Interne : cree la session ACP et traite le cas d'authentification requise.
   */
  private async createAcpSession(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
  ): Promise<SessionInfo> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    let sessionResponse: NewSessionResponse;
    try {
      sessionResponse = await connInfo.connection.newSession({
        cwd,
        mcpServers: [],
      });
    } catch (e: any) {
      // Detecte l'erreur auth_required (code -32000)
      const isAuthRequired = (e instanceof RequestError && e.code === -32000)
        || (e?.code === -32000)
        || (typeof e?.message === 'string' && /auth.?required/i.test(e.message));

      if (!isAuthRequired) {
        logError('Failed to create session', e);
        this.agentManager.killAgent(agentId);
        throw e;
      }

      // Authentification requise : recupere les methodes disponibles
      const authMethods = connInfo.initResponse.authMethods;
      if (!authMethods || authMethods.length === 0) {
        this.agentManager.killAgent(agentId);
        throw new Error(
          `Agent "${agentName}" requires authentication but did not advertise any auth methods.`,
        );
      }

      log(`Agent requires authentication. Methods: ${authMethods.map(m => m.name).join(', ')}`);

      // Laisse l'utilisateur choisir une methode d'authentification
      let selectedMethod = authMethods[0];
      if (authMethods.length > 1) {
        const picked = await vscode.window.showQuickPick(
          authMethods.map(m => ({
            label: m.name,
            description: m.description || '',
            detail: `ID: ${m.id}`,
            method: m,
          })),
          {
            placeHolder: 'Select an authentication method',
            title: `${agentName} requires authentication`,
          },
        );
        if (!picked) {
          this.agentManager.killAgent(agentId);
          throw new Error('Authentication cancelled by user.');
        }
        selectedMethod = picked.method;
      } else {
        // Une seule methode : demande une confirmation explicite
        const confirm = await vscode.window.showInformationMessage(
          `${agentName} requires authentication via "${selectedMethod.name}".`,
          { modal: true, detail: selectedMethod.description || undefined },
          'Authenticate',
        );
        if (confirm !== 'Authenticate') {
          this.agentManager.killAgent(agentId);
          throw new Error('Authentication cancelled by user.');
        }
      }

      // Lance effectivement l'authentification
      try {
        log(`Authenticating with method: ${selectedMethod.name} (${selectedMethod.id})`);
        await connInfo.connection.authenticate({ methodId: selectedMethod.id });
        log('Authentication successful');
      } catch (authErr: any) {
        logError('Authentication failed', authErr);
        this.agentManager.killAgent(agentId);
        throw new Error(`Authentication failed: ${authErr.message}`);
      }

      // Reessaie session/new apres authentification reussie
      try {
        sessionResponse = await connInfo.connection.newSession({
          cwd,
          mcpServers: [],
        });
      } catch (retryErr) {
        logError('Failed to create session after authentication', retryErr);
        this.agentManager.killAgent(agentId);
        throw retryErr;
      }
    }

    return {
      sessionId: sessionResponse.sessionId,
      agentId,
      agentName,
      agentDisplayName: connInfo.initResponse.agentInfo?.title ||
        connInfo.initResponse.agentInfo?.name ||
        agentName,
      cwd,
      createdAt: new Date().toISOString(),
      initResponse: connInfo.initResponse,
      modes: sessionResponse.modes ?? null,
      models: (sessionResponse as any).models ?? null,
      availableCommands: [],
    };
  }

  /**
   * Envoie un prompt a la session active.
   */
  async sendPrompt(sessionId: string, text: string): Promise<PromptResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) {
      throw new Error(`No connection for agent: ${session.agentId}`);
    }

    log(`sendPrompt: session=${sessionId}, text="${text.substring(0, 50)}..."`);

    const prompt: ContentBlock[] = [
      { type: 'text', text },
    ];

    const response = await connInfo.connection.prompt({
      sessionId,
      prompt,
    });

    log(`Prompt response: stopReason=${response.stopReason}`);
    return response;
  }

  /**
   * Annule le tour de prompt en cours.
   */
  async cancelTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    log(`Cancelling turn for session ${sessionId}`);
    await connInfo.connection.cancel({ sessionId });
  }

  /**
   * Definit le mode de session (ex.: plan, code).
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await connInfo.connection.setSessionMode({ sessionId, modeId });

    // Met a jour l'etat local en memoire
    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    this.emit('mode-changed', sessionId, modeId);
  }

  /**
   * Definit le modele de session (fonction experimentale).
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await (connInfo.connection as any).unstable_setSessionModel({ sessionId, modelId });

    // Met a jour l'etat local en memoire
    if (session.models) {
      session.models.currentModelId = modelId;
    }
    this.emit('model-changed', sessionId, modelId);
  }

  // --- Accesseurs ---

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getActiveSession(): SessionInfo | undefined {
    if (!this.activeSessionId) { return undefined; }
    return this.sessions.get(this.activeSessionId);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /** Retourne le nom de l'agent de la session active. */
  getActiveAgentName(): string | null {
    const session = this.getActiveSession();
    return session?.agentName ?? null;
  }

  /** Verifie si un agent donne est actuellement connecte. */
  isAgentConnected(agentName: string): boolean {
    return this.agentSessions.has(agentName);
  }

  /** Retourne la liste des noms d'agents connectes. */
  getConnectedAgentNames(): string[] {
    return Array.from(this.agentSessions.keys());
  }

  getConnectionForSession(sessionId: string): ConnectionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) { return undefined; }
    return this.connectionManager.getConnection(session.agentId);
  }

  // --- Nettoyage ---

  dispose(): void {
    this.agentManager.killAll();
    this.connectionManager.dispose();
    this.sessions.clear();
    this.agentSessions.clear();
  }
}
