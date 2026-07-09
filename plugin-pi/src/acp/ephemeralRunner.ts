import type {
	PipelineAgentRunInput,
	PipelineAgentRunner,
	PipelinePromotionStatus,
} from "@acp-client/pipeline";
import type {
	ClientSideConnection,
	PromptResponse,
	SessionNotification,
} from "@agentclientprotocol/sdk";

import { SessionAuthHandler } from "./authHandler.js";
import {
	defaultAcpConnector,
	type AcpConnector,
	type ConnectedAcpAgent,
} from "./defaultConnector.js";
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

			const response = await connected.connInfo.connection.prompt({
				sessionId,
				prompt: [
					{ type: "text", text: this.composeRunnerPrompt(input, config) },
				],
			});
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
				`Agent "${agentName}" is not configured in .pi/.acp/acp-agents.json or .pi/.acp/.sandcastle/config.json.`,
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
			return await connected.connInfo.connection.newSession({
				cwd: workspaceCwd,
				mcpServers: [],
			});
		} catch (e: unknown) {
			const authHandler = new SessionAuthHandler(
				() => connected.dispose(),
				this.options.getPermissionContext ?? (() => undefined),
			);
			if (!authHandler.isAuthRequiredError(e)) {
				throw e;
			}
			await authHandler.runAuthFlow(agentName, agentId, connected.connInfo);
			throwIfAborted();
			return connected.connInfo.connection.newSession({
				cwd: workspaceCwd,
				mcpServers: [],
			});
		}
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
		config: PiAgentConfigEntry,
	): string {
		const skills = input.skills;
		if (config.skills === false || !skills || skills.length === 0) {
			return input.promptText;
		}

		const catalog = loadSkillCatalog({
			workspaceCwd: input.workspaceCwd,
			logger: (message, error) => this.options.logger?.error(message, error),
		});
		const skillsBlock = renderSkillsCatalog(
			catalog,
			skills,
			input.workspaceCwd,
		);
		if (!skillsBlock) {
			return input.promptText;
		}

		return `${skillsBlock}\n\n${input.promptText}`;
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
		const promotion = this.options.getSandcastlePromotion?.() ?? "ask";
		const decision = decidePromotionPolicy(preview, promotion);

		if (decision === "discard_no_changes") {
			await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
			return "no_changes";
		}
		if (decision === "auto_reject") {
			await connected.connInfo.connection.extMethod("sandcastle/reject", { sessionId });
			return "rejected";
		}
		if (decision === "auto_apply") {
			return this.applySandcastleChanges(connected, sessionId);
		}

		const userDecision = await this.requestSandcastlePromotion(input.agentName, sessionId, preview);
		if (userDecision === "approve") {
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
			return this.options.requestSandcastlePromotion({ agentName, sessionId, preview });
		}
		return "cancelled";
	}
}

export type MinimalAcpConnection = Pick<
	ClientSideConnection,
	"newSession" | "prompt" | "cancel" | "authenticate"
>;

function isSandcastleConfig(config: PiAgentConfigEntry): config is SandcastleAgentConfig {
	return config.transport === "sandcastle";
}
