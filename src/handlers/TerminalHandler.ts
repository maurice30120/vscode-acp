import * as vscode from 'vscode';
import { log, logError } from '../utils/Logger';

import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalCommandRequest,
  KillTerminalCommandResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
} from '@agentclientprotocol/sdk';

import { spawn, ChildProcess } from 'node:child_process';

interface ManagedTerminal {
  id: string;
  process: ChildProcess;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  exitPromise: Promise<void>;
  vsTerminal?: vscode.Terminal;
}

/**
 * Gere les terminaux demandes par les agents ACP (terminal/create, terminal/output, etc.).
 * Utilise de vrais processus enfants pour capturer la sortie et un terminal VS Code pour l'affichage.
 */
export class TerminalHandler {
  private terminals: Map<string, ManagedTerminal> = new Map();
  private nextId = 1;

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = `term_${this.nextId++}`;
    const outputByteLimit = params.outputByteLimit ?? 1024 * 1024; // Limite par defaut : 1 Mo

    log(`createTerminal: ${params.command} ${(params.args || []).join(' ')} (id=${terminalId})`);

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (params.env) {
      for (const v of params.env) {
        env[v.name] = v.value;
      }
    }

    const child = spawn(params.command, params.args || [], {
      cwd: params.cwd || undefined,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let truncated = false;

    const appendOutput = (data: Buffer) => {
      const text = data.toString();
      output += text;
      // Tronque depuis le debut si la limite de taille est depassee
      const byteLength = Buffer.byteLength(output, 'utf-8');
      if (byteLength > outputByteLimit) {
        const excess = byteLength - outputByteLimit;
        // Cherche une frontiere de caractere sure avant tronquage
        let cutPoint = 0;
        let bytes = 0;
        for (let i = 0; i < output.length; i++) {
          bytes += Buffer.byteLength(output[i], 'utf-8');
          if (bytes >= excess) {
            cutPoint = i + 1;
            break;
          }
        }
        output = output.substring(cutPoint);
        truncated = true;
      }
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    const exitPromise = new Promise<void>((resolve) => {
      child.on('close', (code, signal) => {
        const managed = this.terminals.get(terminalId);
        if (managed) {
          managed.exitCode = code;
          managed.exitSignal = signal;
          managed.exited = true;
        }
        resolve();
      });
      child.on('error', () => {
        resolve();
      });
    });

    // Cree aussi un terminal VS Code pour afficher la sortie en direct
    const writeEmitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open() {
        writeEmitter.fire(`$ ${params.command} ${(params.args || []).join(' ')}\r\n`);
      },
      close() { /* aucune action (intentionnel) */ },
    };
    const vsTerminal = vscode.window.createTerminal({
      name: `ACP: ${params.command}`,
      pty,
    });

    // Diffuse la sortie vers le terminal VS Code
    child.stdout?.on('data', (data: Buffer) => {
      writeEmitter.fire(data.toString().replace(/\n/g, '\r\n'));
    });
    child.stderr?.on('data', (data: Buffer) => {
      writeEmitter.fire(data.toString().replace(/\n/g, '\r\n'));
    });

    const managed: ManagedTerminal = {
      id: terminalId,
      process: child,
      output: '',
      truncated: false,
      outputByteLimit,
      exitCode: null,
      exitSignal: null,
      exited: false,
      exitPromise,
      vsTerminal,
    };

    // Maintient la reference de sortie synchronisee
    const timer = setInterval(() => {
      managed.output = output;
      managed.truncated = truncated;
    }, 100);

    child.on('close', () => {
      managed.output = output;
      managed.truncated = truncated;
      clearInterval(timer);
    });

    this.terminals.set(terminalId, managed);

    return { terminalId };
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    const response: TerminalOutputResponse = {
      output: managed.output,
      truncated: managed.truncated,
    };

    if (managed.exited) {
      response.exitStatus = {
        exitCode: managed.exitCode,
        signal: managed.exitSignal,
      };
    }

    return response;
  }

  async waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    await managed.exitPromise;

    return {
      exitCode: managed.exitCode,
      signal: managed.exitSignal,
    };
  }

  async killTerminal(params: KillTerminalCommandRequest): Promise<KillTerminalCommandResponse> {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    try {
      managed.process.kill('SIGTERM');
    } catch (e) {
      logError(`Failed to kill terminal ${params.terminalId}`, e);
    }

    return {};
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    const managed = this.terminals.get(params.terminalId);
    if (!managed) {
      throw new Error(`Terminal not found: ${params.terminalId}`);
    }

    log(`releaseTerminal: ${params.terminalId}`);

    // Termine le processus s'il tourne encore
    if (!managed.exited) {
      try {
        managed.process.kill('SIGTERM');
      } catch {
        // Ignorer volontairement l'erreur
      }
    }

    // Ne pas detruire le terminal VS Code : la sortie doit rester visible selon ACP
    this.terminals.delete(params.terminalId);

    return {};
  }

  dispose(): void {
    for (const [, managed] of this.terminals) {
      try {
        if (!managed.exited) {
          managed.process.kill('SIGKILL');
        }
        managed.vsTerminal?.dispose();
      } catch {
        // Ignorer volontairement l'erreur
      }
    }
    this.terminals.clear();
  }
}
