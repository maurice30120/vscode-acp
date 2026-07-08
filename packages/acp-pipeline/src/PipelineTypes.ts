import type { CompiledTeamMetadata } from './AgentTeamCompiler';

export type PipelineOutputType = 'markdown' | 'proposed_plan';
export type PipelineSideEffects = 'none' | 'workspace';

export interface PipelinePrimitiveDefinition {
  agent: string;
  prompt: string;
  output: PipelineOutputType;
  sideEffects: PipelineSideEffects;
}

export interface PipelineAgentStepDefinition {
  id: string;
  use: string;
}

export interface PipelineApprovalStepDefinition {
  id: string;
  type: 'approval';
  input: string;
}

export interface PipelineParallelBranchDefinition {
  id: string;
  use: string;
}

export interface PipelineParallelStepDefinition {
  id: string;
  type: 'parallel';
  branches: PipelineParallelBranchDefinition[];
}

export type PipelineStepDefinition =
  | PipelineAgentStepDefinition
  | PipelineApprovalStepDefinition
  | PipelineParallelStepDefinition;

export interface PipelineDefinition {
  version: 2;
  id: string;
  title: string;
  primitives: Record<string, PipelinePrimitiveDefinition>;
  steps: PipelineStepDefinition[];
  source?: 'workspace' | 'team';
  filePath?: string;
  metadata?: CompiledTeamMetadata;
}

export interface PipelineValidationResult {
  definition?: PipelineDefinition;
  errors: string[];
}
