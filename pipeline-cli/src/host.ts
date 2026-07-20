import { randomUUID } from 'node:crypto';

import type { SessionNotification } from '@agentclientprotocol/sdk';
import {
  PipelineRuntime,
  PipelineRuntimeAgentAdapter,
  type CompiledPipelineProgram,
  type CompiledPipelineNode,
  type PipelineAgentRunner,
  type PipelineResumeDecision,
  type PipelineRuntimeResult,
} from '@acp-client/pipeline';
import {
  EphemeralAcpRunner,
  getPipelinePrograms,
  loadPiAgentCatalog,
  type Logger,
} from '@acp-client/pi-extension/host';

import type { CliTerminal } from './terminal.js';

export interface CliPipelineListEntry {
  id: string;
  title: string;
  nodeCount: number;
}

export interface CliPipelineHostOptions {
  terminal: CliTerminal;
  verbose?: boolean;
  runAgent?: PipelineAgentRunner;
  runIdFactory?: () => string;
}

export class CliPipelineHost {
  private readonly programs: CompiledPipelineProgram[];
  private readonly runtimes = new Map<string, PipelineRuntime>();
  private readonly runner: PipelineAgentRunner;
  private readonly logger: Logger;
  private readonly activityByNode = new Map<string, 'agent_message_chunk' | 'agent_thought_chunk'>();

  constructor(
    private readonly workspaceCwd: string,
    private readonly options: CliPipelineHostOptions,
  ) {
    this.logger = {
      log: message => {
        if (this.options.verbose) {
          this.options.terminal.writeError(`[acp-cli] ${message}`);
        }
      },
      error: (message, error) => {
        const suffix = error === undefined ? '' : `: ${formatError(error)}`;
        this.options.terminal.writeError(`[acp-cli] ${message}${suffix}`);
      },
    };

    const catalog = loadPiAgentCatalog(this.workspaceCwd);
    if (catalog.errors.length > 0) {
      throw new Error(`Invalid workspace ACP configuration:\n- ${catalog.errors.join('\n- ')}`);
    }

    this.programs = getPipelinePrograms(this.workspaceCwd, this.logger);
    const ephemeral = new EphemeralAcpRunner(this.workspaceCwd, {
      getPermissionContext: () => this.options.terminal.asPermissionContext(),
      getAgentConfigs: () => catalog.agents,
      timeouts: catalog.native.pipeline.timeouts,
      getSandcastlePromotion: () => catalog.sandcastle.promotion,
      requestSandcastlePromotion: async request => {
        const selected = await this.options.terminal.select(
          [
            `Sandcastle promotion for ${request.agentName}`,
            `Files changed: ${request.preview.filesChanged}`,
            `Branch: ${request.preview.branch || '(unknown)'}`,
            `Base: ${request.preview.baseRef || '(unknown)'}`,
          ].join('\n'),
          ['Apply Sandcastle changes', 'Reject Sandcastle changes'],
        );
        if (selected === 'Apply Sandcastle changes') {
          return 'approve';
        }
        if (selected === 'Reject Sandcastle changes') {
          return 'reject';
        }
        return 'cancelled';
      },
      logger: this.logger,
    });
    const runner = this.options.runAgent ?? ephemeral.run;
    this.runner = async input => {
      const skills = this.options.verbose
        ? ` (skills=${input.skills?.join(',') || 'none'})`
        : '';
      this.options.terminal.writeError(
        `[acp-cli] Starting node agent "${input.agentName}"${skills}`,
      );
      try {
        const result = await runner(input);
        if (this.options.verbose) {
          this.options.terminal.writeError(`[acp-cli] Agent "${input.agentName}" completed.`);
        }
        return result;
      } catch (error: unknown) {
        this.logger.error(`Agent "${input.agentName}" failed`, error);
        throw error;
      }
    };
  }

  listPipelines(): CliPipelineListEntry[] {
    return this.programs.map(program => ({
      id: program.id,
      title: program.title,
      nodeCount: program.nodes.length,
    }));
  }

  async start(pipelineName: string, prompt: string): Promise<PipelineRuntimeResult> {
    const program = this.programs.find(candidate =>
      candidate.id === pipelineName || candidate.title === pipelineName,
    );
    if (!program) {
      throw new Error(`ACP pipeline "${pipelineName}" was not found in .acp/pipelines.`);
    }

    const runId = this.options.runIdFactory?.() ?? randomUUID();
    const adapter = new PipelineRuntimeAgentAdapter({
      workspaceCwd: () => this.workspaceCwd,
      runAgent: this.runner,
      onSessionUpdate: (activeRunId, node, update) => {
        this.reportSessionUpdate(activeRunId, node, update);
      },
      onStatus: (_activeRunId, node, update) => {
        if (this.options.verbose) {
          this.options.terminal.writeError(
            `[${node.id}:${node.agent ?? 'pause'}] ${update.status}: ${update.message}`,
          );
        }
      },
    });
    const runtime = new PipelineRuntime(adapter, {
      runIdFactory: () => runId,
      programs: [program],
      onEvent: event => {
        if (this.options.verbose) {
          const node = event.nodeId ? ` node=${event.nodeId}` : '';
          const message = event.message ? ` ${event.message}` : '';
          this.options.terminal.writeError(`[runtime] ${event.type}${node}${message}`);
        }
        if ((event.type === 'node_completed' || event.type === 'node_failed') && event.nodeId) {
          this.activityByNode.delete(activityKey(event.runId, event.nodeId));
        }
      },
    });
    this.runtimes.set(runId, runtime);
    const result = await runtime.start(program, { inputs: { userPrompt: prompt } });
    this.cleanupTerminalResult(result);
    return result;
  }

  async resume(runId: string, decision: PipelineResumeDecision): Promise<PipelineRuntimeResult> {
    const runtime = this.runtimes.get(runId);
    if (!runtime) {
      throw new Error(`Unknown active ACP pipeline run "${runId}".`);
    }
    const result = await runtime.resume(runId, decision);
    this.cleanupTerminalResult(result);
    return result;
  }

  async cancel(runId: string): Promise<PipelineRuntimeResult> {
    const runtime = this.runtimes.get(runId);
    if (!runtime) {
      throw new Error(`Unknown active ACP pipeline run "${runId}".`);
    }
    const result = await runtime.cancel(runId);
    this.runtimes.delete(runId);
    return result;
  }

  async dispose(): Promise<void> {
    const entries = [...this.runtimes.entries()];
    this.runtimes.clear();
    await Promise.all(entries.map(async ([runId, runtime]) => {
      try {
        await runtime.cancel(runId);
      } catch (error: unknown) {
        this.logger.error(`Failed to cancel pipeline run ${runId}`, error);
      }
    }));
  }

  private cleanupTerminalResult(result: PipelineRuntimeResult): void {
    if (result.status !== 'paused') {
      this.runtimes.delete(result.runId);
      for (const key of this.activityByNode.keys()) {
        if (key.startsWith(`${result.runId}:`)) {
          this.activityByNode.delete(key);
        }
      }
    }
  }

  private reportSessionUpdate(runId: string, node: CompiledPipelineNode, notification: SessionNotification): void {
    const update = notification.update;
    const kind = update?.sessionUpdate;
    if (kind !== 'agent_thought_chunk' && kind !== 'agent_message_chunk') {
      return;
    }

    const key = activityKey(runId, node.id);
    if (this.activityByNode.get(key) === kind) {
      return;
    }
    this.activityByNode.set(key, kind);

    const label = formatAgentLabel(node);
    const action = kind === 'agent_thought_chunk' ? 'réfléchit' : 'répond';
    this.options.terminal.writeError(`[acp-cli] ${label} ${action}`);
  }
}

function activityKey(runId: string, nodeId: string): string {
  return `${runId}:${nodeId}`;
}

function formatAgentLabel(node: CompiledPipelineNode): string {
  return node.agent && node.agent !== node.id
    ? `${node.id} · ${node.agent}`
    : node.id;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const details: string[] = [error.message || error.name];
  const rpcError = error as Error & { code?: unknown; data?: unknown; cause?: unknown };
  if (rpcError.code !== undefined) {
    details.push(`code=${formatErrorValue(rpcError.code)}`);
  }
  if (rpcError.data !== undefined) {
    details.push(`data=${formatErrorValue(rpcError.data)}`);
  }
  if (rpcError.cause !== undefined) {
    details.push(`cause=${formatError(rpcError.cause)}`);
  }
  return details.join('; ');
}

function formatErrorValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
