import * as vscode from 'vscode';
import { log, logError } from '../utils/Logger';
import { buildSpawnCommandSpec } from '../utils/ShellSpawn';

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

const TERMINAL_SPAWN_ERROR_EXIT_CODE = 1;

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
 * Manages terminals that ACP agents request (terminal/create, terminal/output, etc.).
 * Uses real child processes for capturing output, with VS Code terminals for display.
 */
export class TerminalHandler {
  constructor(private readonly spawnProcess: typeof spawn = spawn) {}

  private terminals: Map<string, ManagedTerminal> = new Map();
  private nextId = 1;

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = `term_${this.nextId++}`;
    const outputByteLimit = params.outputByteLimit ?? 1024 * 1024; // 1MB default

    log(`createTerminal: ${params.command} ${(params.args || []).join(' ')} (id=${terminalId})`);

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (params.env) {
      for (const v of params.env) {
        env[v.name] = v.value;
      }
    }

    let output = '';
    let truncated = false;
    let child: ChildProcess;

    try {
      const spawnSpec = buildSpawnCommandSpec(params.command, params.args || []);
      child = this.spawnProcess(spawnSpec.file, spawnSpec.args, {
        cwd: params.cwd || undefined,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(spawnSpec.shell ? { shell: true } : {}),
      });
    } catch (error) {
      logError(`createTerminal failed for "${params.command}" (id=${terminalId})`, error);
      throw error;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open() {
        writeEmitter.fire(`$ ${params.command} ${(params.args || []).join(' ')}\r\n`);
      },
      close() { /* no-op */ },
    };
    const vsTerminal = vscode.window.createTerminal({
      name: `ACP: ${params.command}`,
      pty,
    });

    const writeToTerminal = (text: string) => {
      if (text.length > 0) {
        writeEmitter.fire(text.replace(/\n/g, '\r\n'));
      }
    };

    const syncManagedOutput = () => {
      managed.output = output;
      managed.truncated = truncated;
    };

    const appendOutput = (text: string) => {
      output += text;
      // Truncate from beginning if over limit
      const byteLength = Buffer.byteLength(output, 'utf-8');
      if (byteLength > outputByteLimit) {
        const excess = byteLength - outputByteLimit;
        // Find a safe character boundary to truncate at
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
      syncManagedOutput();
    };

    let resolveExitPromise!: () => void;
    let exitSettled = false;
    const finalizeExit = (code: number | null, signal: string | null) => {
      managed.exitCode = code;
      managed.exitSignal = signal;
      managed.exited = true;
      syncManagedOutput();
      if (!exitSettled) {
        exitSettled = true;
        resolveExitPromise();
      }
    };
    const exitPromise = new Promise<void>((resolve) => {
      resolveExitPromise = resolve;
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
    this.terminals.set(terminalId, managed);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      appendOutput(text);
      writeToTerminal(text);
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      appendOutput(text);
      writeToTerminal(text);
    });

    child.on('close', (code, signal) => {
      finalizeExit(code ?? managed?.exitCode ?? null, signal ?? managed?.exitSignal ?? null);
    });
    child.on('error', (error) => {
      logError(`Terminal ${terminalId} process error`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const outputText = `Failed to start command "${params.command}": ${errorMessage}\n`;
      appendOutput(outputText);
      writeToTerminal(outputText);
      finalizeExit(managed?.exitCode ?? TERMINAL_SPAWN_ERROR_EXIT_CODE, managed?.exitSignal ?? null);
    });

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

    // Kill if still running
    if (!managed.exited) {
      try {
        managed.process.kill('SIGTERM');
      } catch {
        // ignore
      }
    }

    // Don't dispose VS Code terminal — keep output visible per ACP spec
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
        // ignore
      }
    }
    this.terminals.clear();
  }
}
