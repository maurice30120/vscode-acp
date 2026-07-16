import * as assert from "node:assert/strict";
import { test } from "node:test";

import { resolvePipelinePromptFiles } from "../dist/index.js";
import { createTempWorkspace, writeFile } from "./helpers.js";

test("happy path: file content prepended to inline prompt", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/prompts/planner.md", "File content");
	writeFile(workspace, ".acp/pipelines/demo.yaml", "version: 2");

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				prompt: "Inline prompt",
				promptFile: "../prompts/planner.md",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 1024,
		},
	);

	assert.equal(result.errors.length, 0);
	assert.equal(result.primitives.planner.prompt, "File content\n\nInline prompt");
	assert.equal(result.primitives.planner.promptFile, undefined);
});

test("file alone without inline prompt", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/prompts/planner.md", "File only");
	writeFile(workspace, ".acp/pipelines/demo.yaml", "version: 2");

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				promptFile: "../prompts/planner.md",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 1024,
		},
	);

	assert.equal(result.errors.length, 0);
	assert.equal(result.primitives.planner.prompt, "File only");
});

test("missing file returns error and primitive is not resolved", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/pipelines/demo.yaml", "version: 2");

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				prompt: "Inline",
				promptFile: "../prompts/missing.md",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 1024,
		},
	);

	assert.equal(result.errors.length, 1);
	assert.ok(result.errors[0].error.includes("not found"));
	assert.equal(result.primitives.planner, undefined);
});

test("file exceeding maxBytes returns error", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/prompts/huge.md", "x".repeat(200));
	writeFile(workspace, ".acp/pipelines/demo.yaml", "version: 2");

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				promptFile: "../prompts/huge.md",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 100,
		},
	);

	assert.equal(result.errors.length, 1);
	assert.ok(result.errors[0].error.includes("exceeds max size"));
});

test("absolute path returns security error", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/pipelines/demo.yaml", "version: 2");

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				promptFile: "/etc/passwd",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 1024,
		},
	);

	assert.equal(result.errors.length, 1);
	assert.ok(result.errors[0].error.includes("relative"));
});

test("path traversal outside workspace returns security error", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/pipelines/demo.yaml", "version: 2");

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				promptFile: "../../../outside.md",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 1024,
		},
	);

	assert.equal(result.errors.length, 1);
	assert.ok(result.errors[0].error.includes("stay within the workspace"));
});

test("primitive without promptFile is passed through unchanged", () => {
	const workspace = createTempWorkspace();

	const result = resolvePipelinePromptFiles(
		{
			planner: {
				agent: "Codex",
				prompt: "No file",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		{
			workspaceCwd: workspace,
			pipelineFilePath: `${workspace}/.acp/pipelines/demo.yaml`,
			maxBytes: 1024,
		},
	);

	assert.equal(result.errors.length, 0);
	assert.equal(result.primitives.planner.prompt, "No file");
	assert.equal(result.primitives.planner.promptFile, undefined);
});
