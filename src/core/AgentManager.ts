import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { log, logError } from '../utils/Logger';
import { sendEvent, sendError } from '../utils/TelemetryManager';
import type { AgentConfigEntry } from '../config/AgentConfig';

/**
 * Echappe un argument pour l'inclure de facon sure dans une commande shell.
 * Encadre l'argument avec des quotes simples et protege les quotes internes.
 */
function shellEscape(arg: string): string {
  // Remplace ' par '\'' (fermeture, quote echappee, re-ouverture)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Determine le shell le plus adapte et verifie s'il supporte le flag -l (login).
 * Sur macOS/Linux, un shell de login charge le profil utilisateur (~/.zshrc,
 * ~/.bash_profile, etc.) afin que PATH inclue nvm, Homebrew et d'autres
 * repertoires d'outils installes par l'utilisateur.
 *
 * Compatibilite des shells :
 *   zsh, bash, ksh  ->  -l supporte
 *   fish, sh, dash  ->  utilisation sans -l (fish charge deja sa config;
 *                      sh/dash ne supportent pas -l de maniere fiable)
 *   csh, tcsh, etc. ->  non POSIX; bascule vers bash ou /bin/sh
 */
function resolveUnixShell(): { shell: string; useLoginFlag: boolean } {
  const userShell = process.env.SHELL;

  if (userShell) {
    const base = userShell.split('/').pop() || '';

    // Shells POSIX supportant le flag -l (login)
    if (['zsh', 'bash', 'ksh'].includes(base)) {
      return { shell: userShell, useLoginFlag: true };
    }

    // fish charge sa config sans -l; sh/dash sont POSIX mais
    // ne supportent pas -l de maniere fiable
    if (['fish', 'sh', 'dash'].includes(base)) {
      return { shell: userShell, useLoginFlag: false };
    }

    // Shells non POSIX (csh, tcsh, etc.) : fallback vers un shell POSIX connu
    log(`User shell "${userShell}" is not POSIX-compatible, falling back to bash/sh`);
  }

  // Si $SHELL est absent ou non POSIX, on teste des shells courants
  if (existsSync('/bin/bash')) {
    return { shell: '/bin/bash', useLoginFlag: true };
  }
  if (existsSync('/usr/bin/bash')) {
    return { shell: '/usr/bin/bash', useLoginFlag: true };
  }
  // Dernier fallback si rien n'est disponible
  return { shell: '/bin/sh', useLoginFlag: false };
}

export interface AgentInstance {
  id: string;
  name: string;
  process: ChildProcess;
  config: AgentConfigEntry;
}

/**
 * Gere le demarrage et l'arret des processus enfants des agents ACP.
 */
export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private nextId = 1;

  /**
   * Lance un agent comme processus enfant avec stdin/stdout pipes.
   */
  spawnAgent(name: string, config: AgentConfigEntry): AgentInstance {
    const id = `agent_${this.nextId++}`;
    log(`Spawning agent "${name}" (${id}): ${config.command} ${(config.args || []).join(' ')}`);

    const child = (() => {
      if (process.platform === 'win32') {
        // Sous Windows, des commandes comme npx sont des scripts batch (.cmd) qui necessitent
        // une resolution via cmd.exe.
        return spawn(config.command, config.args || [], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...(config.env || {}) },
          shell: true,
        });
      }

      // Sous macOS/Linux, utiliser le shell de login utilisateur pour que PATH inclue
      // nvm, Homebrew et d'autres repertoires d'outils installes localement.
      const { shell, useLoginFlag } = resolveUnixShell();
      const commandStr = [config.command, ...(config.args || [])].map(shellEscape).join(' ');
      const shellArgs = useLoginFlag ? ['-l', '-c', commandStr] : ['-c', commandStr];

      log(`Using shell: ${shell} ${shellArgs.join(' ')}`);
      const shellName = shell.split('/').pop() || shell;
      sendEvent('agent/spawn/shell', { shell: shellName, useLoginFlag: String(useLoginFlag) });
      return spawn(shell, shellArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(config.env || {}) },
      });
    })();

    const instance: AgentInstance = { id, name, process: child, config };
    this.agents.set(id, instance);

    // Redirige stderr pour faciliter le debug
    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        log(`[${name} stderr] ${line}`);
        this.emit('agent-stderr', { agentId: id, line });
      }
    });

    child.on('error', (err) => {
      logError(`Agent "${name}" process error`, err);
      sendError('agent/error', { agentName: name, errorType: err.message });
      this.emit('agent-error', { agentId: id, error: err });
    });

    child.on('close', (code, signal) => {
      log(`Agent "${name}" exited (code=${code}, signal=${signal})`);
      this.agents.delete(id);
      this.emit('agent-closed', { agentId: id, code, signal });
    });

    return instance;
  }

  /**
   * Termine un processus d'agent.
   */
  killAgent(agentId: string): boolean {
    const instance = this.agents.get(agentId);
    if (!instance) {
      return false;
    }

    log(`Killing agent "${instance.name}" (${agentId})`);

    try {
      instance.process.kill('SIGTERM');
      // Force l'arret apres 5 s si le processus est encore actif
      setTimeout(() => {
        if (instance.process.exitCode === null) {
          instance.process.kill('SIGKILL');
        }
      }, 5000);
    } catch (e) {
      logError(`Failed to kill agent ${agentId}`, e);
    }

    this.agents.delete(agentId);
    return true;
  }

  /**
   * Retourne un agent en cours d'execution via son ID.
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Retourne tous les agents actuellement en execution.
   */
  getRunningAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Termine tous les agents en cours. Appele a la desactivation de l'extension.
   */
  killAll(): void {
    for (const [id] of this.agents) {
      this.killAgent(id);
    }
  }

  dispose(): void {
    this.killAll();
    this.removeAllListeners();
  }
}
