import { parseArtifactProducer } from "./PipelineV3Compiler";
import { validateAdapterSupportsPolicy } from "./PipelinePolicy";
import type { PipelineAdapterPolicyCapabilities } from "./PipelinePolicy";
import type {
  CompiledPipelineNode,
  CompiledPipelineProgram,
  PipelineArtifact,
  PipelineNodeExecutionResult,
  PipelineResumeDecision,
  PipelineRuntimeAdapter,
  PipelineRuntimeDiagnostic,
  PipelineRuntimeResult,
  PipelineRuntimeSnapshot,
} from "./PipelineV3Types";

export interface PipelineRuntimeOptions {
  runIdFactory?: () => string;
  now?: () => Date;
  store?: PipelineRunStore;
  programs?: CompiledPipelineProgram[];
  onEvent?: (event: PipelineRuntimeEvent) => void | Promise<void>;
  adapterName?: string;
  adapterCapabilities?: PipelineAdapterPolicyCapabilities;
  resolveNodeSkills?: (node: CompiledPipelineNode) => string[] | Promise<string[]>;
}

export interface PipelineRuntimeEvent {
  runId: string;
  type:
    | "run_started"
    | "node_started"
    | "node_completed"
    | "node_failed"
    | "paused"
    | "resumed"
    | "completed"
    | "failed"
    | "cancelled";
  nodeId?: string;
  message?: string;
  at: string;
}

export interface PipelineRunStore {
  create(snapshot: PipelineRuntimeSnapshot): Promise<void>;
  load(runId: string): Promise<PipelineRuntimeSnapshot | null>;
  save(snapshot: PipelineRuntimeSnapshot): Promise<void>;
  appendEvent(runId: string, event: PipelineRuntimeEvent): Promise<void>;
  listResumable(): Promise<PipelineRuntimeSnapshot[]>;
}

interface ActiveRun {
  program: CompiledPipelineProgram;
  snapshot: PipelineRuntimeSnapshot;
  controller: AbortController;
}

export class PipelineRuntime {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly programsById = new Map<string, CompiledPipelineProgram>();
  private readonly now: () => Date;
  private readonly runIdFactory: () => string;
  private readonly store?: PipelineRunStore;
  private readonly onEvent?: (event: PipelineRuntimeEvent) => void | Promise<void>;
  private readonly adapterName: string;
  private readonly adapterCapabilities?: PipelineAdapterPolicyCapabilities;
  private readonly resolveNodeSkills?: (node: CompiledPipelineNode) => string[] | Promise<string[]>;

  constructor(
    private readonly adapter: PipelineRuntimeAdapter,
    options: PipelineRuntimeOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.runIdFactory = options.runIdFactory ?? (() => `run-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    this.store = options.store;
    this.onEvent = options.onEvent;
    this.adapterName = options.adapterName ?? "pipeline";
    this.adapterCapabilities = options.adapterCapabilities;
    this.resolveNodeSkills = options.resolveNodeSkills;
    for (const program of options.programs ?? []) {
      this.programsById.set(program.id, program);
    }
  }

  async start(program: CompiledPipelineProgram): Promise<PipelineRuntimeResult> {
    this.programsById.set(program.id, program);
    const runId = this.runIdFactory();
    const at = this.isoNow();
    const snapshot: PipelineRuntimeSnapshot = {
      runId,
      pipelineId: program.id,
      status: "running",
      nodeStates: Object.fromEntries(program.nodes.map(node => [node.id, { status: "pending", attempts: 0 }])),
      artifacts: {},
      diagnostics: [],
      createdAt: at,
      updatedAt: at,
    };
    const active: ActiveRun = { program, snapshot, controller: new AbortController() };
    this.runs.set(runId, active);
    await this.store?.create(cloneSnapshot(snapshot));
    await this.emitRuntimeEvent({ runId, type: "run_started", at });
    return this.advance(active);
  }

  async resume(runId: string, decision: PipelineResumeDecision): Promise<PipelineRuntimeResult> {
    const active = await this.requireActiveRun(runId);
    const pause = active.snapshot.pendingPause;
    if (!pause || pause.id !== decision.pauseId) {
      const diagnostic = {
        code: "invalid_resume",
        message: `Pause "${decision.pauseId}" is not current for run "${runId}".`,
      };
      return { status: "failed", runId, error: diagnostic, snapshot: cloneSnapshot(active.snapshot) };
    }
    if (decision.kind === "reject") {
      active.snapshot.status = "cancelled";
      active.snapshot.pendingPause = undefined;
    active.snapshot.updatedAt = this.isoNow();
    await this.persist(active.snapshot);
    await this.emitRuntimeEvent({ runId, type: "cancelled", nodeId: pause.nodeId, message: "Pause rejected.", at: active.snapshot.updatedAt });
    this.runs.delete(runId);
    return { status: "cancelled", runId, snapshot: cloneSnapshot(active.snapshot) };
    }

    const node = active.program.nodesById.get(pause.nodeId);
    if (!node) {
      return this.fail(active, { code: "missing_pause_node", message: `Pause node "${pause.nodeId}" is missing.` });
    }
    if (node.output) {
      const value = decision.value ?? "";
      active.snapshot.artifacts[artifactKey(node.id, node.output.name)] = {
        ...node.output,
        value,
        producerNodeId: node.id,
      };
    }
    active.snapshot.nodeStates[pause.nodeId] = {
      ...active.snapshot.nodeStates[pause.nodeId],
      status: "completed",
      completedAt: this.isoNow(),
    };
    active.snapshot.pendingPause = undefined;
    active.snapshot.status = "running";
    active.snapshot.updatedAt = this.isoNow();
    await this.persist(active.snapshot);
    await this.emitRuntimeEvent({ runId, type: "resumed", nodeId: pause.nodeId, at: active.snapshot.updatedAt });
    return this.advance(active);
  }

  async cancel(runId: string): Promise<PipelineRuntimeResult> {
    const active = await this.requireActiveRun(runId);
    active.controller.abort();
    for (const [nodeId, state] of Object.entries(active.snapshot.nodeStates)) {
      if (state.status === "pending" || state.status === "running" || state.status === "paused") {
        active.snapshot.nodeStates[nodeId] = { ...state, status: "cancelled" };
      }
    }
    active.snapshot.status = "cancelled";
    active.snapshot.pendingPause = undefined;
    active.snapshot.updatedAt = this.isoNow();
    await this.persist(active.snapshot);
    await this.emitRuntimeEvent({ runId, type: "cancelled", at: active.snapshot.updatedAt });
    this.runs.delete(runId);
    return { status: "cancelled", runId, snapshot: cloneSnapshot(active.snapshot) };
  }

  async inspect(runId: string): Promise<PipelineRuntimeSnapshot | null> {
    const active = this.runs.get(runId);
    if (active) {
      return cloneSnapshot(active.snapshot);
    }
    return this.store?.load(runId).then(snapshot => snapshot && cloneSnapshot(snapshot)) ?? null;
  }

  private async advance(active: ActiveRun): Promise<PipelineRuntimeResult> {
    while (active.snapshot.status === "running") {
      const ready = this.readyNodes(active);
      if (ready.length === 0) {
        if (this.isComplete(active)) {
          return this.complete(active);
        }
        const diagnostic = { code: "deadlock", message: "No runnable nodes remain before completion." };
        return this.fail(active, diagnostic);
      }

      const pause = ready.find(node => node.kind === "pause");
      if (pause) {
        return this.pause(active, pause);
      }

      const batch = ready.filter(node => node.kind === "agent");
      const results = await Promise.all(batch.map(node => this.executeNode(active, node)));
      const failure = results.find(result => "code" in result) as PipelineRuntimeDiagnostic | undefined;
      if (failure) {
        active.controller.abort();
        return this.fail(active, failure);
      }
    }
    return { status: "cancelled", runId: active.snapshot.runId, snapshot: cloneSnapshot(active.snapshot) };
  }

  private readyNodes(active: ActiveRun): CompiledPipelineNode[] {
    return active.program.nodes
      .filter(node => active.snapshot.nodeStates[node.id]?.status === "pending")
      .filter(node => node.needs.every(dependency => active.snapshot.nodeStates[dependency]?.status === "completed"));
  }

  private async executeNode(active: ActiveRun, node: CompiledPipelineNode): Promise<PipelineRuntimeDiagnostic | { ok: true }> {
    const state = active.snapshot.nodeStates[node.id];
    const inputs = resolveInputs(node, active.snapshot.artifacts);
    const skillErrors = this.resolveNodeSkills ? await this.resolveNodeSkills(node) : [];
    if (skillErrors.length > 0) {
      active.snapshot.nodeStates[node.id] = {
        ...state,
        status: "failed",
        attempts: state.attempts + 1,
        completedAt: this.isoNow(),
      };
      active.snapshot.updatedAt = this.isoNow();
      await this.persist(active.snapshot);
      return {
        nodeId: node.id,
        attempt: state.attempts + 1,
        code: "skill_resolution_failed",
        message: skillErrors.join("; "),
      };
    }
    const unsupportedPolicy = this.adapterCapabilities
      ? validateAdapterSupportsPolicy(this.adapterName, this.adapterCapabilities, node.policy)[0]
      : undefined;
    if (unsupportedPolicy) {
      active.snapshot.nodeStates[node.id] = {
        ...state,
        status: "failed",
        attempts: state.attempts + 1,
        completedAt: this.isoNow(),
      };
      active.snapshot.updatedAt = this.isoNow();
      await this.persist(active.snapshot);
      return {
        nodeId: node.id,
        attempt: state.attempts + 1,
        code: unsupportedPolicy.code,
        message: unsupportedPolicy.message,
      };
    }
    for (let attempt = state.attempts + 1; attempt <= node.retry.maxAttempts; attempt++) {
      active.snapshot.nodeStates[node.id] = { ...state, status: "running", attempts: attempt, startedAt: state.startedAt ?? this.isoNow() };
      active.snapshot.updatedAt = this.isoNow();
      await this.persist(active.snapshot);
      await this.emitRuntimeEvent({ runId: active.snapshot.runId, type: "node_started", nodeId: node.id, at: active.snapshot.updatedAt });

      const result = await this.adapter.execute({
        runId: active.snapshot.runId,
        node,
        inputs,
        signal: active.controller.signal,
      });
      if ("artifact" in result) {
        const artifact = assertArtifact(node, result);
        active.snapshot.artifacts[artifactKey(node.id, artifact.name)] = artifact;
        active.snapshot.nodeStates[node.id] = {
          ...active.snapshot.nodeStates[node.id],
          status: "completed",
          completedAt: this.isoNow(),
        };
        active.snapshot.updatedAt = this.isoNow();
        await this.persist(active.snapshot);
        await this.emitRuntimeEvent({ runId: active.snapshot.runId, type: "node_completed", nodeId: node.id, at: active.snapshot.updatedAt });
        return { ok: true };
      }

      active.snapshot.diagnostics.push({ nodeId: node.id, attempt, code: result.code, message: result.message });
      if (!result.retryable || attempt >= node.retry.maxAttempts) {
        active.snapshot.nodeStates[node.id] = {
          ...active.snapshot.nodeStates[node.id],
          status: "failed",
          completedAt: this.isoNow(),
        };
        active.snapshot.updatedAt = this.isoNow();
        await this.persist(active.snapshot);
        await this.emitRuntimeEvent({ runId: active.snapshot.runId, type: "node_failed", nodeId: node.id, message: result.message, at: active.snapshot.updatedAt });
        return { nodeId: node.id, attempt, code: result.code, message: result.message };
      }
      await sleep(node.retry.backoffMs ?? 0);
    }
    return { nodeId: node.id, code: "retry_exhausted", message: `Node "${node.id}" exhausted retries.` };
  }

  private async pause(active: ActiveRun, node: CompiledPipelineNode): Promise<PipelineRuntimeResult> {
    const state = active.snapshot.nodeStates[node.id];
    const pauseId = `${active.snapshot.runId}:${node.id}:${state.attempts + 1}`;
    const pause = {
      id: pauseId,
      nodeId: node.id,
      type: node.pause!,
      content: node.pauseContent!,
      format: node.pauseFormat ?? "markdown",
    };
    active.snapshot.nodeStates[node.id] = {
      ...state,
      status: "paused",
      attempts: state.attempts + 1,
      startedAt: state.startedAt ?? this.isoNow(),
    };
    active.snapshot.pendingPause = pause;
    active.snapshot.status = "paused";
    active.snapshot.updatedAt = this.isoNow();
    await this.persist(active.snapshot);
    await this.emitRuntimeEvent({ runId: active.snapshot.runId, type: "paused", nodeId: node.id, at: active.snapshot.updatedAt });
    return { status: "paused", runId: active.snapshot.runId, pause, snapshot: cloneSnapshot(active.snapshot) };
  }

  private async complete(active: ActiveRun): Promise<PipelineRuntimeResult> {
    const terminalArtifacts = active.program.terminalNodeIds
      .map(nodeId => active.program.nodesById.get(nodeId))
      .filter((node): node is CompiledPipelineNode => Boolean(node?.output))
      .map(node => active.snapshot.artifacts[artifactKey(node.id, node.output!.name)])
      .filter(Boolean);
    active.snapshot.finalArtifact = terminalArtifacts.at(-1);
    active.snapshot.status = "completed";
    active.snapshot.updatedAt = this.isoNow();
    await this.persist(active.snapshot);
    await this.emitRuntimeEvent({ runId: active.snapshot.runId, type: "completed", at: active.snapshot.updatedAt });
    this.runs.delete(active.snapshot.runId);
    return {
      status: "completed",
      runId: active.snapshot.runId,
      artifact: active.snapshot.finalArtifact,
      snapshot: cloneSnapshot(active.snapshot),
    };
  }

  private async fail(active: ActiveRun, diagnostic: PipelineRuntimeDiagnostic): Promise<PipelineRuntimeResult> {
    active.snapshot.status = "failed";
    active.snapshot.diagnostics.push(diagnostic);
    for (const [nodeId, state] of Object.entries(active.snapshot.nodeStates)) {
      if (state.status === "pending" || state.status === "running") {
        active.snapshot.nodeStates[nodeId] = { ...state, status: "cancelled" };
      }
    }
    active.snapshot.updatedAt = this.isoNow();
    await this.persist(active.snapshot);
    await this.emitRuntimeEvent({ runId: active.snapshot.runId, type: "failed", nodeId: diagnostic.nodeId, message: diagnostic.message, at: active.snapshot.updatedAt });
    this.runs.delete(active.snapshot.runId);
    return { status: "failed", runId: active.snapshot.runId, error: diagnostic, snapshot: cloneSnapshot(active.snapshot) };
  }

  private isComplete(active: ActiveRun): boolean {
    return active.program.nodes.every(node => active.snapshot.nodeStates[node.id]?.status === "completed");
  }

  private async requireActiveRun(runId: string): Promise<ActiveRun> {
    const active = this.runs.get(runId);
    if (!active) {
      const snapshot = await this.store?.load(runId);
      const program = snapshot ? this.programsById.get(snapshot.pipelineId) : undefined;
      if (!snapshot || !program) {
        throw new Error(`Unknown active pipeline run "${runId}".`);
      }
      const restored = { program, snapshot, controller: new AbortController() };
      this.runs.set(runId, restored);
      return restored;
    }
    return active;
  }

  private async persist(snapshot: PipelineRuntimeSnapshot): Promise<void> {
    await this.store?.save(cloneSnapshot(snapshot));
  }

  private async emitRuntimeEvent(event: PipelineRuntimeEvent): Promise<void> {
    await this.onEvent?.(event);
    await this.store?.appendEvent(event.runId, event);
  }

  private isoNow(): string {
    return this.now().toISOString();
  }
}

function resolveInputs(node: CompiledPipelineNode, artifacts: Record<string, PipelineArtifact>): Record<string, PipelineArtifact> {
  const result: Record<string, PipelineArtifact> = {};
  for (const input of node.inputs) {
    const producer = parseArtifactProducer(input.from)!;
    result[input.name] = artifacts[artifactKey(producer.nodeId, producer.artifactName)];
  }
  return result;
}

function assertArtifact(node: CompiledPipelineNode, result: PipelineNodeExecutionResult): PipelineArtifact {
  if (!("artifact" in result)) {
    throw new Error("Expected successful node result.");
  }
  if (!node.output) {
    throw new Error(`Node "${node.id}" cannot publish an artifact.`);
  }
  if (result.artifact.name !== node.output.name) {
    throw new Error(`Node "${node.id}" returned artifact "${result.artifact.name}" instead of "${node.output.name}".`);
  }
  if (result.artifact.type !== node.output.type) {
    throw new Error(`Node "${node.id}" returned artifact type "${result.artifact.type}" instead of "${node.output.type}".`);
  }
  if (result.artifact.format !== node.output.format) {
    throw new Error(`Node "${node.id}" returned artifact format "${result.artifact.format}" instead of "${node.output.format}".`);
  }
  return { ...result.artifact, producerNodeId: node.id };
}

function artifactKey(nodeId: string, artifactName: string): string {
  return `${nodeId}.${artifactName}`;
}

function cloneSnapshot(snapshot: PipelineRuntimeSnapshot): PipelineRuntimeSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as PipelineRuntimeSnapshot;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}
