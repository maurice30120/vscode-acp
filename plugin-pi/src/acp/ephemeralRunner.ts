import {
	renderAcpPrompt,
	type PipelineAgentRunInput,
	type PipelineAgentRunner,
	type PipelinePromotionStatus,
} from "@acp-client/pipeline";
import type {
	ClientSideConnection,
	ContentBlock,
	PromptResponse,
	SessionNotification,
} from "@agentclientprotocol/sdk";

import { SessionAuthHandler } from "./authHandler.js";
import {
	defaultAcpConnector,
	type AcpConnector,
	type ConnectedAcpAgent,
} from "./defaultConnector.js";
import {
	PipelineTimeoutError,
	resolveTimeouts,
	withProcessGuard,
	withTimeout,
	type PartialAcpOperationTimeouts,
} from "./operationGuards.js";
import { RunAbortedError } from "./runAbortedError.js";
import {
	sandcastleConnector,
	type SandcastleConnector,
} from "./sandcastleConnector.js";
import { SessionUpdateHandler } from "./sessionUpdateHandler.js";
import { loadPiAgentCatalog } from "../catalog/config.js";
import {
	loadSkillCatalog,
	renderSkillsCatalog,
} from "../catalog/skillCatalog.js";
import {
	decidePromotionPolicy,
	type SandcastlePreview,
} from "../sandcastle/PromotionPolicy.js";
import type {
	Logger,
	PiAgentConfigEntry,
	PiPermissionContext,
	SandcastleAgentConfig,
	SandcastlePromotion,
} from "../types.js";

export type SandcastlePromotionDecision = "approve" | "reject" | "cancelled";

export interface SandcastlePromotionRequest {
	agentName: string;
	sessionId: string;
	preview: SandcastlePreview;
}

export interface EphemeralAcpRunnerOptions {
	getAgentConfigs?: () => Record<string, PiAgentConfigEntry>;
	getSandcastlePromotion?: () => SandcastlePromotion;
	getPermissionContext?: () => PiPermissionContext | undefined;
	connector?: AcpConnector;
	sandcastleConnector?: SandcastleConnector;
	requestSandcastlePromotion?: (
		request: SandcastlePromotionRequest,
	) => Promise<SandcastlePromotionDecision>;
	timeouts?: PartialAcpOperationTimeouts;
	logger?: Logger;
}

export class EphemeralAcpRunner {
	private readonly connector: AcpConnector;
	private readonly sandcastleConnector: SandcastleConnector;

	constructor(
		private readonly workspaceCwd: string,
		private readonly options: EphemeralAcpRunnerOptions = {},
	) {
		this.connector = options.connector ?? defaultAcpConnector;
		this.sandcastleConnector = options.sandcastleConnector ?? sandcastleConnector;
	}

	run: PipelineAgentRunner = async (input: PipelineAgentRunInput) => {
		const result = await this.runAgent(input);
		return result;
	};

	async runAgent(input: PipelineAgentRunInput): Promise<{ text: string; promotion?: PipelinePromotionStatus }> {
		const config = this.readAgentConfig(input.agentName);
		if (input.skills && input.skills.length > 0 && config.skills === false) {
			throw new Error(`Pipeline node declares skills but agent "${input.agentName}" has skills disabled.`);
		}
		const sessionUpdateHandler = new SessionUpdateHandler();
		let connected: ConnectedAcpAgent | null = null;
		let sessionId: string | null = null;
		let collectedText = "";
		let disposed = false;

		const dispose = () => {
			if (disposed) {
				return;
			}
			disposed = true;
			connected?.dispose();
		};

		const throwIfAborted = (): void => {
			if (input.signal?.aborted) {
				throw new RunAbortedError();
			}
		};

		const onAbort = (): void => {
			void (async () => {
				if (sessionId && connected) {
					try {
						await connected.connInfo.connection.cancel({ sessionId });
					} catch (e: unknown) {
						this.options.logger?.error("Ephemeral ACP cancel failed", e);
					}
				}
				dispose();
			})();
		};

		input.signal?.addEventListener("abort", onAbort, { once: true });

		const listener = (update: SessionNotification) => {
			if (sessionId && update.sessionId !== sessionId) {
				return;
			}

			const updateData = update.update;
			if (updateData.sessionUpdate === "agent_message_chunk") {
				const content = updateData.content;
				if (content.type === "text") {
					collectedText += content.text;
				}
			}

			input.onSessionUpdate?.(update);
		};
		sessionUpdateHandler.addListener(listener);

		try {
			throwIfAborted();
			connected = await this.connectAgent(
				input,
				config,
				sessionUpdateHandler,
			);
			throwIfAborted();

			const session = await this.createSessionWithAuth(
				input.agentName,
				connected.agentId,
				connected,
				input.workspaceCwd,
				throwIfAborted,
			);
			sessionId = session.sessionId;
			throwIfAborted();

			const response = await withProcessGuard(
				"prompt",
				connected.processExit,
				withTimeout(
					"prompt",
					resolveTimeouts(this.options.timeouts).promptMs,
					connected.connInfo.connection.prompt({
						sessionId,
						prompt: this.composeRunnerPrompt(input),
					}),
					async () => {
						try {
							await connected?.connInfo.connection.cancel({ sessionId: sessionId ?? "" });
						} catch (e: unknown) {
							this.options.logger?.error("Ephemeral ACP timeout cancel failed", e);
						}
						dispose();
					},
				),
			);
			this.throwIfCancelled(response, input.signal);
			const promotion = await this.finishSandcastleRun(
				config,
				input,
				connected,
				sessionId,
			);
			return promotion
				? { text: collectedText.trim(), promotion }
				: { text: collectedText.trim() };
		} finally {
			input.signal?.removeEventListener("abort", onAbort);
			sessionUpdateHandler.removeListener(listener);
			dispose();
		}
	}

	private readAgentConfig(agentName: string): PiAgentConfigEntry {
		const configs =
			this.options.getAgentConfigs?.() ??
			loadPiAgentCatalog(this.workspaceCwd).agents;
		const config = configs[agentName];
		if (!config) {
			throw new Error(
				`Agent "${agentName}" is not configured in .acp/acp-agents.json or .acp/.sandcastle/config.json.`,
			);
		}
		return config;
	}

	private async connectAgent(
		input: PipelineAgentRunInput,
		config: PiAgentConfigEntry,
		sessionUpdateHandler: SessionUpdateHandler,
	): Promise<ConnectedAcpAgent> {
		const baseInput = {
			agentName: input.agentName,
			workspaceCwd: input.workspaceCwd,
			sessionUpdateHandler,
			getPermissionContext:
				this.options.getPermissionContext ?? (() => undefined),
			permissions: input.permissions,
			timeouts: this.options.timeouts,
			logger: this.options.logger,
		};
		if (isSandcastleConfig(config)) {
			return this.sandcastleConnector({
				...baseInput,
				config,
			});
		}
		return this.connector({
			...baseInput,
			config,
		});
	}

	private async createSessionWithAuth(
		agentName: string,
		agentId: string,
		connected: ConnectedAcpAgent,
		workspaceCwd: string,
		throwIfAborted: () => void,
	): Promise<{ sessionId: string }> {
		throwIfAborted();
		try {
			return await this.newSession(connected, workspaceCwd);
		} catch (e: unknown) {
			const authHandler = new SessionAuthHandler(
				() => connected.dispose(),
				this.options.getPermissionContext ?? (() => undefined),
				{
					timeouts: this.options.timeouts,
					processExit: connected.processExit,
				},
			);
			if (!authHandler.isAuthRequiredError(e)) {
				throw e;
			}
			await authHandler.runAuthFlow(agentName, agentId, connected.connInfo);
			throwIfAborted();
			return this.newSession(connected, workspaceCwd);
		}
	}

	private async newSession(
		connected: ConnectedAcpAgent,
		workspaceCwd: string,
	): Promise<{ sessionId: string }> {
		return withProcessGuard(
			"newSession",
			connected.processExit,
			withTimeout(
				"newSession",
				resolveTimeouts(this.options.timeouts).newSessionMs,
				connected.connInfo.connection.newSession({
					cwd: workspaceCwd,
					mcpServers: [],
				}),
				() => connected.dispose(),
			),
		);
	}

	private throwIfCancelled(
		response: PromptResponse,
		signal: AbortSignal | undefined,
	): void {
		if (signal?.aborted || response.stopReason === "cancelled") {
			throw new RunAbortedError();
		}
	}

	private composeRunnerPrompt(
		input: PipelineAgentRunInput,
	): ContentBlock[] {
		const prompt = input.prompt ?? {
			skills: [...(input.skills ?? [])],
			task: input.promptText,
			context: [],
		};
		return renderAcpPrompt(prompt, {
			renderSkills: skillNames => {
				if (skillNames.length === 0) {
					return "";
				}
				const catalog = loadSkillCatalog({
					workspaceCwd: input.workspaceCwd,
					logger: (message, error) => this.options.logger?.error(message, error),
				});
				return renderSkillsCatalog(
					catalog,
					[...skillNames],
					input.workspaceCwd,
				);
			},
		});
	}

	private async finishSandcastleRun(
		config: PiAgentConfigEntry,
		input: PipelineAgentRunInput,
		connected: ConnectedAcpAgent,
		sessionId: string,
	): Promise<PipelinePromotionStatus | undefined> {
		if (!isSandcastleConfig(config)) {
			return undefined;
		}

		if (input.sideEffects !== "workspace") {
			await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
			return undefined;
		}

		const preview = await this.previewSandcastleChanges(connected, sessionId);
		const promotion = mapPipelinePromotionPolicy(input.promotion)
			?? this.options.getSandcastlePromotion?.()
			?? "ask";
		const decision = decidePromotionPolicy(preview, promotion);

		if (decision === "discard_no_changes") {
			input.onStatus?.({
				status: "implementing",
				message: "Sandcastle run produced no text, no tool calls, and no file diff.",
			});
			await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
			return "no_changes";
		}
		if (decision === "auto_reject") {
			await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
			return "rejected";
		}
		if (decision === "auto_apply") {
			input.onStatus?.({
				status: "implementing",
				message: "Applying Sandcastle changes to the workspace...",
			});
			return this.applySandcastleChanges(connected, sessionId);
		}

		input.onStatus?.({
			status: "implementing",
			message: `Sandcastle changes ready — waiting for promotion (${preview.filesChanged} file(s) changed).`,
		});
		const userDecision = await this.requestSandcastlePromotion(input.agentName, sessionId, preview);
		if (userDecision === "approve") {
			input.onStatus?.({
				status: "implementing",
				message: "Applying Sandcastle changes to the workspace...",
			});
			return this.applySandcastleChanges(connected, sessionId);
		}
		await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
		return userDecision === "reject" ? "rejected" : "cancelled";
	}

	private async previewSandcastleChanges(
		connected: ConnectedAcpAgent,
		sessionId: string,
	): Promise<SandcastlePreview> {
		const response = await connected.connInfo.connection.extMethod("sandcastle/preview", { sessionId });
		return {
			diff: String(response.diff ?? ""),
			filesChanged: Number(response.filesChanged ?? 0),
			branch: String(response.branch ?? ""),
			baseRef: String(response.baseRef ?? ""),
			worktreePath: String(response.worktreePath ?? ""),
		};
	}

	private async applySandcastleChanges(
		connected: ConnectedAcpAgent,
		sessionId: string,
	): Promise<PipelinePromotionStatus> {
		const result = await connected.connInfo.connection.extMethod("sandcastle/apply", { sessionId });
		if (result.success !== true) {
			await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
			throw new Error(String(result.message ?? "Sandcastle changes could not be applied."));
		}
		return Number(result.filesChanged ?? 0) === 0 ? "no_changes" : "applied";
	}

	private async requestSandcastlePromotion(
		agentName: string,
		sessionId: string,
		preview: SandcastlePreview,
	): Promise<SandcastlePromotionDecision> {
		if (this.options.requestSandcastlePromotion) {
			return withTimeout(
				"sandcastle-promotion-ui",
				resolveTimeouts(this.options.timeouts).promotionUiMs,
				this.options.requestSandcastlePromotion({ agentName, sessionId, preview }),
				() => undefined,
			).catch(error => {
				if (error instanceof PipelineTimeoutError) {
					return "cancelled";
				}
				throw error;
			});
		}
		return "cancelled";
	}
}

function mapPipelinePromotionPolicy(
	promotion: PipelineAgentRunInput["promotion"],
): SandcastlePromotion | undefined {
	if (promotion === "ask") {
		return "ask";
	}
	if (promotion === "auto-apply") {
		return "autoApply";
	}
	if (promotion === "auto-reject" || promotion === "discard") {
		return "autoReject";
	}
	return undefined;
}

export type MinimalAcpConnection = Pick<
	ClientSideConnection,
	"newSession" | "prompt" | "cancel" | "authenticate"
>;

function isSandcastleConfig(config: PiAgentConfigEntry): config is SandcastleAgentConfig {
	return config.transport === "sandcastle";
}
