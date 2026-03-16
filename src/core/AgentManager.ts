import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { log, logError } from '../utils/Logger';
import { sendEvent, sendError } from '../utils/TelemetryManager';
import { buildSpawnCommandSpec } from '../utils/ShellSpawn';
import type { AgentConfigEntry } from '../config/AgentConfig';

export interface AgentInstance {
  id: string;
  name: string;
  process: ChildProcess;
  config: AgentConfigEntry;
}

/**
 * Manages spawning and killing ACP agent child processes.
 */
export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private nextId = 1;

  /**
   * Spawn an agent as a child process with stdin/stdout piped.
   */
  spawnAgent(name: string, config: AgentConfigEntry): AgentInstance {
    const id = `agent_${this.nextId++}`;
    log(`Spawning agent "${name}" (${id}): ${config.command} ${(config.args || []).join(' ')}`);

    const child = (() => {
      const spawnSpec = buildSpawnCommandSpec(config.command, config.args || [], {
        onUnsupportedShell: (userShell) => {
          log(`User shell "${userShell}" is not POSIX-compatible, falling back to bash/sh`);
        },
      });

      if (spawnSpec.shellName) {
        log(`Using shell: ${spawnSpec.file} ${spawnSpec.args.join(' ')}`);
        sendEvent('agent/spawn/shell', {
          shell: spawnSpec.shellName,
          useLoginFlag: String(spawnSpec.useLoginFlag),
        });
      }

      return spawn(spawnSpec.file, spawnSpec.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(config.env || {}) },
        ...(spawnSpec.shell ? { shell: true } : {}),
      });
    })();

    const instance: AgentInstance = { id, name, process: child, config };
    this.agents.set(id, instance);

    // Forward stderr for debugging
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
   * Kill an agent process.
   */
  killAgent(agentId: string): boolean {
    const instance = this.agents.get(agentId);
    if (!instance) {
      return false;
    }

    log(`Killing agent "${instance.name}" (${agentId})`);

    try {
      instance.process.kill('SIGTERM');
      // Force kill after 5s if still running
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
   * Get a running agent by ID.
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all running agents.
   */
  getRunningAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Kill all running agents. Called on extension deactivate.
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
