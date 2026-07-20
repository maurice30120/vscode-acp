import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";
import {
	compilePipelineV3Catalog,
	type CompiledPipelineProgram,
	validatePipelineDefinition,
	type PipelineV3CatalogResult,
	type PipelineDefinition,
	type PipelineValidationResult,
} from "@acp-client/pipeline";

import { loadPiAcpConfig, loadPiAgentCatalog } from "./config.js";
import { getPiPluginRoot } from "./pluginRoot.js";
import { resolvePipelinePromptFiles } from "./promptFileResolver.js";
import type { Logger, PiAgentConfigEntry } from "../types.js";

const PIPELINE_DIR = path.join(".acp", "pipelines");

export function getPipelineDefinitions(
	workspaceCwd: string,
	logger?: Logger,
): PipelineDefinition[] {
	const pluginRoot = getPiPluginRoot();
	const catalog = loadPiAgentCatalog(workspaceCwd, pluginRoot);
	const config = catalog.native;
	if (!config.pipeline.enabled) {
		return [];
	}

	for (const error of catalog.errors) {
		logger?.error(error);
	}

	return loadPipelineDefinitionsFromRoot({
		workspaceCwd,
		configRoot: pluginRoot,
		agentConfigs: catalog.agents,
		instructionsMaxBytes: config.pipeline.instructionsMaxBytes,
		logger,
	});
}

export function getPipelinePrograms(
	workspaceCwd: string,
	logger?: Logger,
): CompiledPipelineProgram[] {
	const pluginRoot = getPiPluginRoot();
	const catalog = loadPiAgentCatalog(workspaceCwd, pluginRoot);
	const config = catalog.native;
	if (!config.pipeline.enabled) {
		return [];
	}

	for (const error of catalog.errors) {
		logger?.error(error);
	}

	return loadPipelineProgramsFromRoot({
		workspaceCwd,
		configRoot: pluginRoot,
		agentConfigs: catalog.agents,
		instructionsMaxBytes: config.pipeline.instructionsMaxBytes,
		logger,
	}).programs;
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

export function loadWorkspacePipelinePrograms(
	workspaceCwd: string,
	agentConfigs: Record<string, PiAgentConfigEntry>,
	logger?: Logger,
): PipelineV3CatalogResult {
	return loadPipelineProgramsFromRoot({
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

export function loadPipelineProgramsFromRoot(
	options: PipelineDefinitionsFromRootOptions,
): PipelineV3CatalogResult {
	const maxBytes = options.instructionsMaxBytes ?? 256 * 1024;
	const dir = path.join(options.configRoot, PIPELINE_DIR);
	if (!fs.existsSync(dir)) {
		return { programs: [], errors: [] };
	}

	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch (e: unknown) {
		options.logger?.error(`Failed to read ACP pipeline directory ${dir}`, e);
		return {
			programs: [],
			errors: [{
				filePath: dir,
				errors: [`Failed to read ACP pipeline directory: ${e instanceof Error ? e.message : String(e)}`],
			}],
		};
	}

	const sources = [];
	const errors = [];
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) {
			continue;
		}
		const filePath = path.join(dir, entry);
		try {
			sources.push({
				filePath,
				definition: parseYamlDocument(fs.readFileSync(filePath, "utf8")),
			});
		} catch (e: unknown) {
			const message = e instanceof Error && e.message ? e.message : String(e);
			errors.push({ filePath, errors: [`YAML parse error: ${message}`] });
		}
	}

	const result = compilePipelineV3Catalog(sources, {
		workspaceCwd: options.workspaceCwd,
		configRoot: options.configRoot,
		maxPromptFileBytes: maxBytes,
		agentConfigs: options.agentConfigs,
	});
	const combined = { programs: result.programs, errors: [...errors, ...result.errors] };
	for (const error of combined.errors) {
		options.logger?.error(
			`Ignoring invalid ACP pipeline ${error.filePath}: ${error.errors.join("; ")}`,
		);
	}
	return combined;
}

export function parsePipelineYaml(
	text: string,
	filePath: string,
	agentConfigs: Record<string, PiAgentConfigEntry>,
): PipelineValidationResult {
	try {
		return validatePipelineDefinition(parseYamlDocument(text), filePath, agentConfigs);
	} catch (e: unknown) {
		const message = e instanceof Error && e.message ? e.message : String(e);
		return { errors: [`YAML parse error: ${message}`] };
	}
}

function parseYamlDocument(text: string): unknown {
	return yaml.load(text);
}
