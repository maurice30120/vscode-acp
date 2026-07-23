import type { AcpConnector, ConnectedAcpAgent, SandcastleConnector } from "@acp-client/runtime";
import type { PipelinePermissions } from "@acp-client/pipeline";
import type { PartialAcpOperationTimeouts, SessionUpdateHandler } from "@acp-client/runtime";
import type {
	AgentConfigEntry,
	Logger,
	RuntimePermissionContext,
	SandcastleAgentConfig,
} from "../types.js";

/**
 * Workspace-level connector selection.
 * Decides whether a configured agent uses the native ACP connector or Sandcastle connector.
 */
export function resolveConnector(
	config: AgentConfigEntry,
	defaultConnector: AcpConnector,
	sandcastleConnector: SandcastleConnector,
): AcpConnector | SandcastleConnector {
	if (isSandcastleConfig(config)) {
		// Sandcastle agents use the Sandcastle connector
		return sandcastleConnector;
	}
	// Native ACP agents use the default connector
	return defaultConnector;
}

/**
 * Type guard to check if a config entry is a Sandcastle config
 */
export function isSandcastleConfig(config: AgentConfigEntry): config is SandcastleAgentConfig {
	return config.transport === 'sandcastle';
}

/**
 * Connect an agent using the appropriate connector based on its configuration
 */
export async function connectAgent(
	agentName: string,
	config: AgentConfigEntry,
	workspaceCwd: string,
	sessionUpdateHandler: SessionUpdateHandler,
	options: {
		getPermissionContext: () => RuntimePermissionContext | undefined;
		permissions?: PipelinePermissions;
		timeouts?: PartialAcpOperationTimeouts;
		logger?: Logger;
	},
	defaultConnector: AcpConnector,
	sandcastleConnector: SandcastleConnector,
): Promise<ConnectedAcpAgent> {
	const connector = resolveConnector(config, defaultConnector, sandcastleConnector);
	
	const baseInput = {
		agentName,
		workspaceCwd,
		sessionUpdateHandler,
		getPermissionContext: options.getPermissionContext,
		permissions: options.permissions,
		timeouts: options.timeouts,
		logger: options.logger,
	};

	if (isSandcastleConfig(config)) {
		return sandcastleConnector({ ...baseInput, config });
	}
	return defaultConnector({ ...baseInput, config });
}
