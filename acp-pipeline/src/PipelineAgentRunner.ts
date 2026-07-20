import type { SessionNotification } from "@agentclientprotocol/sdk";

import type { NormalizedPromotionPolicy } from "./PipelinePolicy";
import type { PipelineStatus } from "./PipelineEvents";
import type { PipelineStepRunResult } from "./PipelineStepCompletion";

export type PipelineSideEffects = "none" | "workspace";
export type PipelinePermissions = "ask" | "allowAll";

export interface PipelineStepStatusUpdate {
	status: PipelineStatus;
	message: string;
}

export type PipelineStepStatusHandler = (update: PipelineStepStatusUpdate) => void;

export interface PipelineAgentRunInput {
	workspaceCwd: string;
	agentName: string;
	promptText: string;
	onSessionUpdate?: (update: SessionNotification) => void;
	onStatus?: PipelineStepStatusHandler;
	signal?: AbortSignal;
	sideEffects?: PipelineSideEffects;
	permissions?: PipelinePermissions;
	promotion?: NormalizedPromotionPolicy;
	skills?: string[];
}

export type PipelineAgentRunner = (
	input: PipelineAgentRunInput,
) => Promise<PipelineStepRunResult>;
