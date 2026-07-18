import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";
import {
	validatePipelineDefinition,
	type PipelineDefinition,
	type PipelineValidationResult,
} from "@acp-client/pipeline";

import { loadPiAcpConfig, loadPiAgentCatalog } from "./config.js";
import { resolvePipelinePromptFiles } from "./promptFileResolver.js";
import type { Logger, PiAgentConfigEntry } from "../types.js";

const PIPELINE_DIR = path.join(".acp", "pipelines");

export function getPipelineDefinitions(
	workspaceCwd: string,
	logger?: Logger,
): PipelineDefinition[] {
	const catalog = loadPiAgentCatalog(workspaceCwd);
	const config = catalog.native;
	if (!config.pipeline.enabled) {
		return [];
	}

	for (const error of catalog.errors) {
		logger?.error(error);
	}

	return loadPipelineDefinitionsFromRoot({
		workspaceCwd,
		configRoot: workspaceCwd,
		agentConfigs: catalog.agents,
		instructionsMaxBytes: config.pipeline.instructionsMaxBytes,
		logger,
	});
}

export function getPipelineDefinitionForAgent(
	workspaceCwd: string,
	agentName: string,
	logger?: Logger,
): PipelineDefinition | null {
	return (
		getPipelineDefinitions(workspaceCwd, logger).find(
			(definition) =>
				definition.id === agentName || definition.title === agentName,
		) ?? null
	);
}

export function loadWorkspacePipelineDefinitions(
	workspaceCwd: string,
	agentConfigs: Record<string, PiAgentConfigEntry>,
	logger?: Logger,
): PipelineDefinition[] {
	return loadPipelineDefinitionsFromRoot({
		workspaceCwd,
		configRoot: workspaceCwd,
		agentConfigs,
		instructionsMaxBytes: loadPiAcpConfig(workspaceCwd).pipeline.instructionsMaxBytes,
		logger,
	});
}

export interface PipelineDefinitionsFromRootOptions {
	workspaceCwd: string;
	configRoot: string;
	agentConfigs: Record<string, PiAgentConfigEntry>;
	instructionsMaxBytes?: number;
	logger?: Logger;
}

export function loadPipelineDefinitionsFromRoot(
	options: PipelineDefinitionsFromRootOptions,
): PipelineDefinition[] {
	const maxBytes = options.instructionsMaxBytes ?? 256 * 1024;
	const dir = path.join(options.configRoot, PIPELINE_DIR);
	if (!fs.existsSync(dir)) {
		return [];
	}

	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch (e: unknown) {
		options.logger?.error(`Failed to read ACP pipeline directory ${dir}`, e);
		return [];
	}

	const definitions: PipelineDefinition[] = [];
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) {
			continue;
		}
		const filePath = path.join(dir, entry);
		try {
			const text = fs.readFileSync(filePath, "utf8");
			const result = parsePipelineYaml(text, filePath, options.agentConfigs);
			if (!result.definition) {
				options.logger?.error(
					`Ignoring invalid ACP pipeline ${filePath}: ${result.errors.join("; ")}`,
				);
				continue;
			}

			const resolved = resolvePipelinePromptFiles(
				result.definition.primitives,
				{
					workspaceCwd: options.workspaceCwd,
					configRoot: options.configRoot,
					maxBytes,
					pipelineFilePath: filePath,
				},
			);
			if (resolved.errors.length > 0) {
				const messages = resolved.errors.map(
					(item) => `primitive "${item.primitiveId}": ${item.error}`,
				);
				options.logger?.error(
					`Ignoring invalid ACP pipeline ${filePath}: ${messages.join("; ")}`,
				);
				continue;
			}

			definitions.push({
				...result.definition,
				primitives: resolved.primitives,
			});
		} catch (e: unknown) {
			options.logger?.error(`Ignoring unreadable ACP pipeline ${filePath}`, e);
		}
	}
	return definitions;
}

export function parsePipelineYaml(
	text: string,
	filePath: string,
	agentConfigs: Record<string, PiAgentConfigEntry>,
): PipelineValidationResult {
	let parsed: unknown;
	try {
		parsed = yaml.load(text);
	} catch (e: unknown) {
		const message = e instanceof Error && e.message ? e.message : String(e);
		return { errors: [`YAML parse error: ${message}`] };
	}

	return validatePipelineDefinition(parsed, filePath, agentConfigs);
}
