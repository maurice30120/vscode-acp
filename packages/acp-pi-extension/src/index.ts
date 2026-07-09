import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { handlePipelineCommand } from "./runtime/commands.js";
import { PipelineController } from "./runtime/pipelineController.js";
import { consoleLogger } from "./types.js";
import { Type } from "typebox";

export default function acpPipelinePiExtension(pi: ExtensionAPI): void {
	let controller: PipelineController | null = null;
	let controllerCwd: string | null = null;

	const getController = (cwd: string): PipelineController => {
		if (!controller || controllerCwd !== cwd) {
			void controller?.dispose();
			controller = new PipelineController(cwd, pi, { logger: consoleLogger });
			controllerCwd = cwd;
		}
		return controller;
	};

	pi.on("session_start", (_event, ctx) => {
		getController(ctx.cwd);
	});

	pi.on("session_shutdown", async () => {
		await controller?.dispose();
		controller = null;
		controllerCwd = null;
	});

	pi.registerCommand("pipeline", {
		description: "List, run, approve, reject, or cancel ACP pipelines",
		getArgumentCompletions: (prefix) => {
			const words = ["list", "run", "approve", "reject", "cancel"];
			return words
				.filter((word) => word.startsWith(prefix.trim()))
				.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			await handlePipelineCommand(args, ctx, getController(ctx.cwd));
		},
	});

	pi.registerTool({
		name: "run_pipeline",
		label: "Run ACP Pipeline",
		description: "Run an ACP pipeline through the Pi ACP pipeline extension.",
		promptSnippet:
			"Run a configured ACP pipeline when orchestration across external ACP agents is requested.",
		parameters: Type.Object({
			pipelineName: Type.Optional(
				Type.String({
					description:
						"Pipeline id or title to run. If omitted, the first configured pipeline is used.",
				}),
			),
			prompt: Type.String({
				description: "User request to pass to the ACP pipeline.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await getController(ctx.cwd).runPipeline(
				params.pipelineName ?? "",
				params.prompt,
				ctx,
			);
			const text = result.awaitingApproval
				? `Pipeline plan is ready and awaiting user approval.\n\n${result.plan ?? ""}`
				: `Pipeline completed.\n\n${result.output ?? ""}`;
			return {
				content: [{ type: "text", text }],
				details: result,
			};
		},
	});
}

export {
	handlePipelineCommand,
	parseRunArgs,
	registerPipelineCommand,
} from "./runtime/commands.js";
export { PipelineController } from "./runtime/pipelineController.js";
export { registerRunPipelineTool } from "./runtime/tool.js";
export { EphemeralAcpRunner } from "./acp/ephemeralRunner.js";
export { loadPiAcpConfig, parsePiAcpConfig } from "./catalog/config.js";
export {
	getPipelineDefinitions,
	getPipelineDefinitionForAgent,
	loadWorkspacePipelineDefinitions,
	parsePipelineYaml,
} from "./catalog/pipelineCatalog.js";
export { resolvePipelinePromptFiles } from "./catalog/promptFileResolver.js";
export {
	loadSkillCatalog,
	renderSkillsCatalog,
} from "./catalog/skillCatalog.js";
export type {
	SkillCatalogEntry,
	SkillCatalogOptions,
} from "./catalog/skillCatalog.js";
export type {
	PromptFileResolveError,
	PromptFileResolveOptions,
} from "./catalog/promptFileResolver.js";
