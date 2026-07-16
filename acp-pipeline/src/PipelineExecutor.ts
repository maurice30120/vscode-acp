import type { SessionNotification } from "@agentclientprotocol/sdk";

import type {
	PipelinePrimitiveDefinition,
	PipelinePermissions,
	PipelineSideEffects,
} from "./PipelineTypes";
import {
	resolvePipelineStepText,
	type PipelineStepRunResult,
} from "./PipelineStepCompletion";

export type PipelineStepRunCallback = (
	kind: string,
	promptText: string,
	onSessionUpdate?: (update: SessionNotification) => void,
	signal?: AbortSignal,
) => Promise<PipelineStepRunResult>;

export interface PipelineStepContext {
	signal: AbortSignal;
	approvedPlan?: string;
	onSessionUpdate?: (update: SessionNotification) => void;
}

export interface PipelineAgentRunInput {
	workspaceCwd: string;
	agentName: string;
	promptText: string;
	onSessionUpdate?: (update: SessionNotification) => void;
	signal?: AbortSignal;
	sideEffects?: PipelineSideEffects;
	permissions?: PipelinePermissions;
	skills?: string[];
}

export type PipelineAgentRunner = (
	input: PipelineAgentRunInput,
) => Promise<PipelineStepRunResult>;

export interface PipelineExecutorDependencies {
	workspaceCwd: () => string;
	runAgent?: PipelineAgentRunner;
	runAcpAgent?: PipelineStepRunCallback;
}

/**
 * Runs a single PipelineStep primitive and normalizes adapter output to step text.
 */
export class PipelineExecutor {
	constructor(private readonly dependencies: PipelineExecutorDependencies) {}

	async runStep(
		kind: string,
		primitive: PipelinePrimitiveDefinition,
		promptText: string,
		context: PipelineStepContext,
	): Promise<string> {
		if (primitive.sideEffects === "workspace" && !context.approvedPlan) {
			throw new Error("Workspace side effects require an approved plan.");
		}

		if (this.dependencies.runAcpAgent) {
			const result = await this.dependencies.runAcpAgent(
				kind,
				promptText,
				context.onSessionUpdate,
				context.signal,
			);
			return resolvePipelineStepText(result);
		}

		if (!this.dependencies.runAgent) {
			throw new Error(
				"PipelineExecutor requires runAgent or runAcpAgent dependency.",
			);
		}

		const result = await this.dependencies.runAgent({
			workspaceCwd: this.dependencies.workspaceCwd(),
			agentName: primitive.agent,
			promptText,
			onSessionUpdate: context.onSessionUpdate,
			signal: context.signal,
			sideEffects: primitive.sideEffects,
			permissions: primitive.permissions ?? "ask",
			skills: primitive.skills,
		});
		return resolvePipelineStepText(result);
	}

	async runAgent(
		agentName: string,
		promptText: string,
		options: {
			onSessionUpdate?: (update: SessionNotification) => void;
			signal?: AbortSignal;
			sideEffects?: "none" | "workspace";
		} = {},
	): Promise<PipelineStepRunResult> {
		if (!this.dependencies.runAgent) {
			throw new Error("PipelineExecutor requires runAgent dependency.");
		}

		return this.dependencies.runAgent({
			workspaceCwd: this.dependencies.workspaceCwd(),
			agentName,
			promptText,
			onSessionUpdate: options.onSessionUpdate,
			signal: options.signal,
			sideEffects: options.sideEffects,
		});
	}
}
