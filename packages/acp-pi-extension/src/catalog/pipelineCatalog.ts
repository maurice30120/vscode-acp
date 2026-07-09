import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";
import {
	validatePipelineDefinition,
	type PipelineDefinition,
	type PipelineValidationResult,
} from "@acp-client/pipeline";

import { loadPiAcpConfig } from "./config.js";
import { resolvePipelinePromptFiles } from "./promptFileResolver.js";
import type { Logger, NativeAcpAgentConfig } from "../types.js";

const PIPELINE_DIR = path.join(".pi", ".acp", "pipelines");

export function getPipelineDefinitions(
	workspaceCwd: string,
	logger?: Logger,
): PipelineDefinition[] {
	const config = loadPiAcpConfig(workspaceCwd);
	if (!config.pipeline.enabled) {
		return [];
	}

	for (const error of config.errors) {
		logger?.error(error);
	}

	return loadWorkspacePipelineDefinitions(workspaceCwd, config.agents, logger);
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
	agentConfigs: Record<string, NativeAcpAgentConfig>,
	logger?: Logger,
): PipelineDefinition[] {
	const config = loadPiAcpConfig(workspaceCwd);
	const maxBytes = config.pipeline.instructionsMaxBytes;

	const dir = path.join(workspaceCwd, PIPELINE_DIR);
	if (!fs.existsSync(dir)) {
		return [];
	}

	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch (e: unknown) {
		logger?.error(`Failed to read ACP pipeline directory ${dir}`, e);
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
			const result = parsePipelineYaml(text, filePath, agentConfigs);
			if (!result.definition) {
				logger?.error(
					`Ignoring invalid ACP pipeline ${filePath}: ${result.errors.join("; ")}`,
				);
				continue;
			}

			const resolved = resolvePipelinePromptFiles(
				result.definition.primitives,
				{
					workspaceCwd,
					maxBytes,
					pipelineFilePath: filePath,
				},
			);
			if (resolved.errors.length > 0) {
				const messages = resolved.errors.map(
					(item) => `primitive "${item.primitiveId}": ${item.error}`,
				);
				logger?.error(
					`Ignoring invalid ACP pipeline ${filePath}: ${messages.join("; ")}`,
				);
				continue;
			}

			definitions.push({
				...result.definition,
				primitives: resolved.primitives,
			});
		} catch (e: unknown) {
			logger?.error(`Ignoring unreadable ACP pipeline ${filePath}`, e);
		}
	}
	return definitions;
}

export function parsePipelineYaml(
	text: string,
	filePath: string,
	agentConfigs: Record<string, NativeAcpAgentConfig>,
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
