import * as vscode from 'vscode';

/**
 * Decrit la configuration d'un agent ACP unique (commande, arguments et environnement).
 */
export interface AgentConfigEntry {
  /** Package NPX a executer (ex.: "@anthropic-ai/claude-code@latest"). */
  command: string;
  /** Arguments de ligne de commande. */
  args?: string[];
  /** Variables d'environnement a injecter lors du lancement. */
  env?: Record<string, string>;
  /** Nom d'affichage de l'agent dans l'UI. */
  displayName?: string;
}

/**
 * Lit les configurations d'agents depuis les parametres VS Code.
 * Retourne une table nom d'agent -> configuration.
 */
export function getAgentConfigs(): Record<string, AgentConfigEntry> {
  const config = vscode.workspace.getConfiguration('acp');
  const agents = config.get<Record<string, AgentConfigEntry>>('agents', {});
  return agents;
}

/**
 * Recupere la liste des noms d'agents disponibles.
 */
export function getAgentNames(): string[] {
  return Object.keys(getAgentConfigs());
}

/**
 * Recupere la configuration d'un agent a partir de son nom.
 */
export function getAgentConfig(name: string): AgentConfigEntry | undefined {
  return getAgentConfigs()[name];
}
