import type {
	PipelinePermissions,
	PipelineSideEffects,
	PipelineStepStatusHandler,
	PipelineStepStatusUpdate,
} from "./PipelineAgentRunner";

export type PipelineOutputType = "markdown" | "proposed_plan";
export type {
	PipelinePermissions,
	PipelineSideEffects,
	PipelineStepStatusHandler,
	PipelineStepStatusUpdate,
};

export interface PipelinePrimitiveDefinition {
	agent: string;
	prompt?: string;
	promptFile?: string;
	skills?: string[];
	output: PipelineOutputType;
	sideEffects: PipelineSideEffects;
	permissions?: PipelinePermissions;
}

export interface PipelineAgentStepDefinition {
	id: string;
	use: string;
}

export interface PipelineApprovalStepDefinition {
	id: string;
	type: "approval";
	input: string;
}

export interface PipelineParallelBranchDefinition {
	id: string;
	use: string;
}

export interface PipelineParallelStepDefinition {
	id: string;
	type: "parallel";
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
	source?: "workspace";
	filePath?: string;
}

export interface PipelineValidationResult {
	definition?: PipelineDefinition;
	errors: string[];
}
