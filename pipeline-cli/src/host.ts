import { randomUUID } from 'node:crypto';

import {
  PipelineService,
  type PipelineAgentRunner,
  type PipelineDefinition,
  type PipelinePlanReadyEvent,
  type PipelineSessionUpdateEvent,
  type PipelineStatusEvent,
} from '@acp-client/pipeline';
import {
  EphemeralAcpRunner,
  RunAbortedError,
  loadPipelineDefinitionsFromRoot,
  type Logger,
  type PiPermissionContext,
} from '@acp-client/pi-extension/host';

import { composeExplicitSkills } from './explicitSkills.js';
import type { CliTerminal } from './terminal.js';
import { loadWorkspaceAgentCatalog } from './workspaceCatalog.js';

const DEFAULT_INSTRUCTIONS_MAX_BYTES = 256 * 1024;

export interface CliPipelineSnapshot {
  sessionId: string;
  plan?: string;
  output?: string;
  awaitingApproval: boolean;
}

export interface CliPipelineHostLike {
  listPipelines(): PipelineDefinition[];
  start(pipelineName: string, prompt: string): Promise<CliPipelineSnapshot>;
  answer(answer: string): Promise<CliPipelineSnapshot>;
  approve(): Promise<string>;
  reject(): void;
  dispose(): Promise<void>;
}

export interface CliPipelineHostOptions {
  terminal: CliTerminal;
  verbose?: boolean;
}

/**
 * Terminal host for the shared pipeline engine.
 *
 * The host reads only the current workspace configuration. Agent names are
 * never supplied by the CLI command: each primitive selects its own agent and
 * this host launches the corresponding ACP or Sandcastle process.
 */
export class CliPipelineHost implements CliPipelineHostLike {
  private readonly service: PipelineService;
  private readonly runner: EphemeralAcpRunner;
  private readonly definitions: PipelineDefinition[];
  private pendingPlan: PipelinePlanReadyEvent | null = null;
  private activeSessionId: string | null = null;

  constructor(
    private readonly workspaceCwd: string,
    private readonly options: CliPipelineHostOptions,
  ) {
    const logger: Logger = {
      log: message => {
        if (options.verbose) {
          options.terminal.writeError(`[acp-cli] ${message}`);
        }
      },
      error: (message, error) => {
        const detail = error instanceof Error
          ? `: ${error.message}`
          : error === undefined
            ? ''
            : `: ${String(error)}`;
        options.terminal.writeError(`[acp-cli] ${message}${detail}`);
      },
    };

    const catalog = loadWorkspaceAgentCatalog(workspaceCwd);
    for (const error of catalog.errors) {
      logger.error(error);
    }

    this.definitions = loadPipelineDefinitionsFromRoot({
      workspaceCwd,
      configRoot: workspaceCwd,
      agentConfigs: catalog.agents,
      instructionsMaxBytes: DEFAULT_INSTRUCTIONS_MAX_BYTES,
      logger,
    });

    this.runner = new EphemeralAcpRunner(workspaceCwd, {
      getAgentConfigs: () => catalog.agents,
      getSandcastlePromotion: () => 'ask',
      getPermissionContext: () => this.createPermissionContext(),
      requestSandcastlePromotion: async request => {
        const approved = await options.terminal.confirm(
          [
            `Apply Sandcastle changes from ${request.agentName}?`,
            `${request.preview.filesChanged} file(s), branch ${request.preview.branch || '(unknown)'}, base ${request.preview.baseRef || '(unknown)'}.`,
          ].join('\n'),
        );
        return approved ? 'approve' : 'reject';
      },
      logger,
    });

    const runAgent: PipelineAgentRunner = async input => this.runner.run({
      ...input,
      promptText: composeExplicitSkills(
        this.workspaceCwd,
        input.skills,
        input.promptText,
      ),
      // The CLI has already resolved all explicitly selected skills, including
      // disable-model-invocation skills such as grill-me.
      skills: [],
    });

    this.service = new PipelineService(
      () => this.workspaceCwd,
      {
        getPipelineDefinitions: () => this.definitions,
        getPipelineDefinitionForAgent: pipelineName => this.findPipeline(pipelineName),
        getAgentConfigs: () => catalog.agents,
        isAgentSandcastle: (agentName, agentConfigs) =>
          (agentConfigs[agentName] as { transport?: string } | undefined)?.transport === 'sandcastle',
        runAgent,
        isRunAbortedError: error => error instanceof RunAbortedError,
      },
    );

    this.service.on('plan-ready', (event: PipelinePlanReadyEvent) => {
      this.pendingPlan = event;
      this.activeSessionId = event.sessionId;
    });
    this.service.on('status', (event: PipelineStatusEvent) => {
      const location = event.stepId ? ` ${event.stepId}` : '';
      options.terminal.writeError(`[${event.status}]${location} ${event.message}`);
    });
    this.service.on('session-update', (event: PipelineSessionUpdateEvent) => {
      if (!options.verbose) {
        return;
      }
      const update = event.update.update;
      if (
        (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk')
        && update.content.type === 'text'
      ) {
        options.terminal.writeError(update.content.text, false);
      }
    });
  }

  listPipelines(): PipelineDefinition[] {
    return [...this.definitions];
  }

  async start(pipelineName: string, prompt: string): Promise<CliPipelineSnapshot> {
    if (this.activeSessionId) {
      throw new Error('A pipeline session is already active.');
    }
    const pipeline = this.findPipeline(pipelineName);
    if (!pipeline) {
      throw new Error(`Unknown ACP pipeline "${pipelineName}" in .acp/pipelines.`);
    }

    const sessionId = randomUUID();
    this.activeSessionId = sessionId;
    this.pendingPlan = null;
    const output = await this.service.createPlan(sessionId, prompt, pipeline.id);
    return this.snapshot(sessionId, output);
  }

  async answer(answer: string): Promise<CliPipelineSnapshot> {
    const sessionId = this.requireActiveSession();
    if (!this.pendingPlan) {
      throw new Error('No planner question is waiting for an answer.');
    }
    this.pendingPlan = null;
    const output = await this.service.createPlan(sessionId, answer);
    return this.snapshot(sessionId, output);
  }

  async approve(): Promise<string> {
    const sessionId = this.requireActiveSession();
    const plan = this.pendingPlan?.plan;
    if (!plan) {
      throw new Error('No pending pipeline plan to approve.');
    }
    this.pendingPlan = null;
    try {
      return await this.service.approvePlan(sessionId, plan);
    } finally {
      this.activeSessionId = null;
    }
  }

  reject(): void {
    const sessionId = this.requireActiveSession();
    this.service.rejectPlan(sessionId);
    this.pendingPlan = null;
    this.activeSessionId = null;
  }

  dispose(): Promise<void> {
    return this.service.dispose();
  }

  private findPipeline(name: string): PipelineDefinition | null {
    return this.definitions.find(definition =>
      definition.id === name || definition.title === name) ?? null;
  }

  private snapshot(sessionId: string, output: string): CliPipelineSnapshot {
    const plan = this.pendingPlan?.sessionId === sessionId ? this.pendingPlan.plan : undefined;
    if (!plan) {
      this.activeSessionId = null;
    }
    return {
      sessionId,
      plan,
      output: plan ? undefined : output,
      awaitingApproval: Boolean(plan),
    };
  }

  private requireActiveSession(): string {
    if (!this.activeSessionId) {
      throw new Error('No active pipeline session.');
    }
    return this.activeSessionId;
  }

  private createPermissionContext(): PiPermissionContext {
    return {
      hasUI: true,
      ui: {
        select: (title: string, options: string[]) => this.options.terminal.select(title, options),
        confirm: (title: string, message: string) =>
          this.options.terminal.confirm(`${title}\n${message}`),
      },
    } as unknown as PiPermissionContext;
  }
}
