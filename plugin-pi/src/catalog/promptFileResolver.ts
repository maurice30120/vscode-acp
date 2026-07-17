import * as fs from "node:fs";
import * as path from "node:path";

import type { PipelinePrimitiveDefinition } from "@acp-client/pipeline";

export interface PromptFileResolveError {
	primitiveId: string;
	error: string;
}

export interface PromptFileResolveOptions {
	workspaceCwd: string;
	configRoot?: string;
	maxBytes: number;
	pipelineFilePath: string;
}

/**
 * Resolves `promptFile` for every primitive on a pipeline and composes the
 * final `prompt` text. When both `promptFile` and `prompt` are present the
 * file content is prefixed to the inline prompt, separated by a blank line.
 *
 * Paths are resolved relative to the pipeline YAML file (or the config root
 * when the path starts with `.acp/`). Paths that escape the selected
 * config root are rejected. Returns the composed primitives plus any
 * resolution errors.
 */
export function resolvePipelinePromptFiles(
	primitives: Record<string, PipelinePrimitiveDefinition>,
	options: PromptFileResolveOptions,
): {
	primitives: Record<string, PipelinePrimitiveDefinition>;
	errors: PromptFileResolveError[];
} {
	const errors: PromptFileResolveError[] = [];
	const resolved: Record<string, PipelinePrimitiveDefinition> = {};

	for (const [primitiveId, primitive] of Object.entries(primitives)) {
		if (!primitive.promptFile) {
			resolved[primitiveId] = primitive;
			continue;
		}

		const outcome = readPromptFile(primitive.promptFile, options);
		if ("error" in outcome) {
			errors.push({ primitiveId, error: outcome.error });
			continue;
		}

		const inlinePrompt = primitive.prompt ?? "";
		const composed =
			inlinePrompt.length > 0
				? `${outcome.content}\n\n${inlinePrompt}`
				: outcome.content;

		resolved[primitiveId] = {
			...primitive,
			prompt: composed,
			promptFile: undefined,
		};
	}

	return { primitives: resolved, errors };
}

function readPromptFile(
	relativePath: string,
	options: PromptFileResolveOptions,
): { content: string } | { error: string } {
	const safePath = resolveSafePath(relativePath, options);
	if ("error" in safePath) {
		return safePath;
	}

	let stat: fs.Stats;
	try {
		stat = fs.statSync(safePath.absolutePath);
	} catch {
		return { error: `promptFile not found: ${relativePath}` };
	}

	if (!stat.isFile()) {
		return { error: `promptFile path is not a file: ${relativePath}` };
	}

	if (stat.size > options.maxBytes) {
		return {
			error: `promptFile exceeds max size (${options.maxBytes} bytes): ${relativePath}`,
		};
	}

	try {
		return { content: fs.readFileSync(safePath.absolutePath, "utf8") };
	} catch (e: unknown) {
		const message = e instanceof Error && e.message ? e.message : String(e);
		return { error: `Failed to read promptFile: ${message}` };
	}
}

function resolveSafePath(
	relativePath: string,
	options: PromptFileResolveOptions,
): { absolutePath: string } | { error: string } {
	if (path.isAbsolute(relativePath)) {
		return {
			error: "promptFile path must be relative to the pipeline YAML file.",
		};
	}

	const normalizedRelative = path.normalize(relativePath);
	if (path.isAbsolute(normalizedRelative)) {
		return { error: "promptFile path must be relative." };
	}

	const pipelineDir = path.dirname(options.pipelineFilePath);
	const configRoot = path.resolve(options.configRoot ?? options.workspaceCwd);
	const acpRoot = path.join(configRoot, ".acp");
	const baseDir = normalizedRelative.startsWith(".acp/")
		? configRoot
		: pipelineDir;
	const candidate = path.resolve(baseDir, normalizedRelative);
	const relativeToAcpRoot = path.relative(acpRoot, candidate);

	if (
		relativeToAcpRoot.startsWith("..") ||
		path.isAbsolute(relativeToAcpRoot)
	) {
		return { error: "promptFile path must stay within the Pi ACP config root." };
	}

	return { absolutePath: candidate };
}
