import type { NormalizedPipelinePolicy } from "./PipelinePolicy";

export type PipelineArtifactFormat = "text" | "markdown" | "json";

export type PipelinePauseType = "approval" | "question" | "promotion";

export type PipelinePauseFormat = "text" | "markdown" | "json" | "proposed-plan";

export interface PipelineArtifact<T = unknown> {
  name: string;
  type: string;
  format: PipelineArtifactFormat;
  value: T;
  producerNodeId: string;
}

export interface PipelineNodeInputDefinition {
  name: string;
  from: string;
  type?: string;
  format?: PipelineArtifactFormat;
}

export interface PipelineNodeOutputDefinition {
  name: string;
  type: string;
  format: PipelineArtifactFormat;
}

export interface PipelineRetryDefinition {
  maxAttempts: number;
  backoffMs?: number;
}

export interface PipelinePolicyReference {
  profile?: string;
  filesystem?: "read-only" | "workspace-write";
  terminal?: "none" | "read-only" | "workspace-write";
  network?: "disabled" | "enabled";
  promotion?: "discard" | "ask" | "auto-apply" | "auto-reject";
}

export interface PipelineAgentNodeDefinition {
  id: string;
  type?: "agent";
  agent: string;
  prompt?: string;
  promptFile?: string;
  skills?: string[];
  needs?: string[];
  inputs?: PipelineNodeInputDefinition[];
  output: PipelineNodeOutputDefinition;
  retry?: PipelineRetryDefinition;
  policy?: string | PipelinePolicyReference;
}

export interface PipelinePauseNodeDefinition {
  id: string;
  type: "pause";
  pause: PipelinePauseType;
  content: string;
  format?: PipelinePauseFormat;
  needs?: string[];
  inputs?: PipelineNodeInputDefinition[];
  output?: PipelineNodeOutputDefinition;
  policy?: string | PipelinePolicyReference;
}

export type PipelineNodeDefinition =
  | PipelineAgentNodeDefinition
  | PipelinePauseNodeDefinition;

export interface PipelineV3Definition {
  version: 3;
  id: string;
  title: string;
  agents?: Record<string, unknown>;
  policies?: Record<string, PipelinePolicyReference>;
  nodes: PipelineNodeDefinition[];
  source?: "workspace" | "embedded";
  filePath?: string;
}

export interface CompiledPipelineNode {
  id: string;
  kind: "agent" | "pause";
  agent?: string;
  prompt?: string;
  promptFile?: string;
  skills: readonly string[];
  needs: readonly string[];
  inputs: readonly PipelineNodeInputDefinition[];
  output?: PipelineNodeOutputDefinition;
  retry: PipelineRetryDefinition;
  pause?: PipelinePauseType;
  pauseContent?: string;
  pauseFormat?: PipelinePauseFormat;
  policy: NormalizedPipelinePolicy;
}

export interface CompiledPipelineProgram {
  version: 3;
  id: string;
  title: string;
  nodes: readonly CompiledPipelineNode[];
  nodesById: ReadonlyMap<string, CompiledPipelineNode>;
  dependentsById: ReadonlyMap<string, readonly string[]>;
  rootNodeIds: readonly string[];
  terminalNodeIds: readonly string[];
}

export interface PipelineCompileResult {
  program?: CompiledPipelineProgram;
  errors: string[];
}

export interface PipelineRuntimeSnapshot {
  runId: string;
  pipelineId: string;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  inputVariables?: Record<string, unknown>;
  nodeStates: Record<string, PipelineRuntimeNodeSnapshot>;
  artifacts: Record<string, PipelineArtifact>;
  pendingPause?: PipelinePauseSnapshot;
  finalArtifact?: PipelineArtifact;
  diagnostics: PipelineRuntimeDiagnostic[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRuntimeNodeSnapshot {
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  attempts: number;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelinePauseSnapshot {
  id: string;
  nodeId: string;
  type: PipelinePauseType;
  content: string;
  format: PipelinePauseFormat;
}

export interface PipelineRuntimeDiagnostic {
  nodeId?: string;
  attempt?: number;
  code: string;
  message: string;
}

export type PipelineRuntimeResult =
  | { status: "completed"; runId: string; artifact?: PipelineArtifact; snapshot: PipelineRuntimeSnapshot }
  | { status: "paused"; runId: string; pause: PipelinePauseSnapshot; snapshot: PipelineRuntimeSnapshot }
  | { status: "failed"; runId: string; error: PipelineRuntimeDiagnostic; snapshot: PipelineRuntimeSnapshot }
  | { status: "cancelled"; runId: string; snapshot: PipelineRuntimeSnapshot };

export interface PipelineResumeDecision {
  pauseId: string;
  kind: "approve" | "answer" | "reject";
  value?: unknown;
}

export interface PipelineNodeExecutionInput {
  runId: string;
  node: CompiledPipelineNode;
  prompt: string;
  inputs: Record<string, PipelineArtifact>;
  signal: AbortSignal;
}

export interface PipelineNodeExecutionSuccess {
  artifact: Omit<PipelineArtifact, "producerNodeId">;
}

export interface PipelineNodeExecutionFailure {
  code: string;
  message: string;
  retryable?: boolean;
}

export type PipelineNodeExecutionResult =
  | PipelineNodeExecutionSuccess
  | PipelineNodeExecutionFailure;

export interface PipelineRuntimeAdapter {
  execute(input: PipelineNodeExecutionInput): Promise<PipelineNodeExecutionResult>;
}
