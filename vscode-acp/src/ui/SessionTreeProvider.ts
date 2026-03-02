import * as vscode from 'vscode';
import { SessionManager } from '../core/SessionManager';
import { getAgentNames } from '../config/AgentConfig';

/**
 * Element d'arbre plat representant un agent configure.
 * Affiche l'etat connecte/deconnecte avec l'icone adaptee.
 */
class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agentName: string,
    public readonly connected: boolean,
  ) {
    super(agentName, vscode.TreeItemCollapsibleState.None);

    if (connected) {
      this.contextValue = 'agent-connected';
      this.iconPath = new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('testing.iconPassed'),
      );
      this.description = 'connected';
      // Au clic, donne le focus au panneau de chat
      this.command = {
        command: 'acp.openChat',
        title: 'Open Chat',
      };
    } else {
      this.contextValue = 'agent-disconnected';
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.description = '';
    }

    this.tooltip = connected
      ? `${agentName} — connected\nClick to open chat`
      : `${agentName} — not connected\nUse the plug icon to connect`;
  }
}

/**
 * TreeDataProvider pour la vue laterale des agents ACP.
 * Affiche une liste plate des agents configures avec leur etat de connexion.
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.on('agent-connected', () => this.refresh());
    this.sessionManager.on('agent-disconnected', () => this.refresh());
    this.sessionManager.on('active-session-changed', () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): AgentTreeItem[] {
    if (element) { return []; } // Liste plate : aucun enfant

    const agentNames = getAgentNames();

    return agentNames.map(name => new AgentTreeItem(
      name,
      this.sessionManager.isAgentConnected(name),
    ));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
