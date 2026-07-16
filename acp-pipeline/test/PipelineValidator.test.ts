import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	validatePipelineDefinition,
	extractTemplateVariables,
} from "../dist/index.js";
import { minimalAgentConfigs } from "./helpers.js";

test("valid minimal pipeline returns definition with no errors", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.equal(result.errors.length, 0);
	assert.ok(result.definition);
	assert.equal(result.definition!.id, "demo");
});

test("version !== 2 returns error", () => {
	const result = validatePipelineDefinition(
		{ version: 1, id: "demo", title: "Demo", primitives: {}, steps: [] },
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(result.errors.some((e) => e.includes("version must be 2")));
});

test("primitive without prompt nor promptFile returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes('primitive "p1" must define either prompt or promptFile'),
		),
	);
});

test("unknown agent in primitive returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "UnknownAgent",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes('primitive "p1" references missing ACP agent "UnknownAgent"'),
		),
	);
});

test("step with both use and type returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {},
			steps: [{ id: "s1", use: "p1", type: "approval" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) => e.includes("cannot have both use and type")),
	);
});

test("parallel step with 1 branch returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [
				{
					id: "s1",
					type: "parallel",
					branches: [{ id: "b1", use: "p1" }],
				},
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes('parallel step "s1" must have at least two branches'),
		),
	);
});

test("parallel branch with workspace sideEffects returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "workspace",
					permissions: "ask",
				},
			},
			steps: [
				{
					id: "s1",
					type: "parallel",
					branches: [
						{ id: "b1", use: "p1" },
						{ id: "b2", use: "p1" },
					],
				},
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'parallel step "s1" branch "b1" cannot use workspace side effects',
			),
		),
	);
});

test("workspace sideEffects before approval returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "workspace",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'step "s1" uses workspace side effects before an approval step',
			),
		),
	);
});

test("template referencing future step returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Use {{steps.future.output}}",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
				p2: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [
				{ id: "s1", use: "p1" },
				{ id: "future", use: "p2" },
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'step "s1" template variable "{{steps.future.output}}" must reference a previous step',
			),
		),
	);
});

test("template referencing parallel branch output is valid after parallel step", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Investigate",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
				p2: {
					agent: "Codex",
					prompt:
						"Synthesize {{steps.investigate.branches.repo.output}}",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [
				{
					id: "investigate",
					type: "parallel",
					branches: [
						{ id: "repo", use: "p1" },
						{ id: "docs", use: "p1" },
					],
				},
				{ id: "synth", use: "p2" },
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.equal(result.errors.length, 0);
	assert.ok(result.definition);
});

test("duplicate step ids returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {},
			steps: [
				{ id: "s1", type: "approval", input: "x" },
				{ id: "s1", type: "approval", input: "y" },
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) => e.includes('step id "s1" is duplicated')),
	);
});

test("duplicate branch ids returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [
				{
					id: "s1",
					type: "parallel",
					branches: [
						{ id: "b1", use: "p1" },
						{ id: "b1", use: "p1" },
					],
				},
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes('parallel step "s1" branch id "b1" is duplicated'),
		),
	);
});

test("extractTemplateVariables extracts userPrompt and step outputs", () => {
	const vars = extractTemplateVariables(
		"{{ userPrompt }} {{steps.a.output}}",
	);
	assert.deepEqual(vars, ["userPrompt", "steps.a.output"]);
});

test("extractTemplateVariables returns empty array for plain text", () => {
	const vars = extractTemplateVariables("plain text");
	assert.deepEqual(vars, []);
});

test("non-object pipeline returns error", () => {
	const result = validatePipelineDefinition(
		"not-an-object",
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.deepEqual(result.errors, ["Pipeline YAML must be an object."]);
});

test("primitives not an object returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: [],
			steps: [],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) => e.includes("primitives must be an object")),
	);
});

test("step not an object returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {},
			steps: ["bad"],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) => e.includes("step 1 must be an object")),
	);
});

test("missing required id returns error", () => {
	const result = validatePipelineDefinition(
		{ version: 2, title: "Demo", primitives: {}, steps: [] },
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes("pipeline id must be a non-empty string"),
		),
	);
});

test("missing required title returns error", () => {
	const result = validatePipelineDefinition(
		{ version: 2, id: "demo", primitives: {}, steps: [] },
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes("pipeline title must be a non-empty string"),
		),
	);
});

test("invalid primitive output returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "invalid",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'primitive "p1" output must be "markdown" or "proposed_plan"',
			),
		),
	);
});

test("invalid sideEffects returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "invalid",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'primitive "p1" sideEffects must be "none" or "workspace"',
			),
		),
	);
});

test("invalid permissions returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello",
					output: "markdown",
					sideEffects: "none",
					permissions: "invalid",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'primitive "p1" permissions must be "ask" or "allowAll"',
			),
		),
	);
});

test("unsupported template variable in primitive returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello {{unknown.var}}",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'primitive "p1" uses unsupported template variable "{{unknown.var}}"',
			),
		),
	);
});

test("branch referencing unknown primitive returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {},
			steps: [
				{
					id: "s1",
					type: "parallel",
					branches: [
						{ id: "b1", use: "unknown" },
						{ id: "b2", use: "unknown" },
					],
				},
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'parallel step "s1" branch "b1" references unknown primitive "unknown"',
			),
		),
	);
});

test("approval step missing input returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {},
			steps: [{ id: "approval", type: "approval" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'approval step "approval" input must be a non-empty string',
			),
		),
	);
});

test("unsupported template variable in step prompt returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {
				p1: {
					agent: "Codex",
					prompt: "Hello {{steps.unknown.output}}",
					output: "markdown",
					sideEffects: "none",
					permissions: "ask",
				},
			},
			steps: [{ id: "s1", use: "p1" }],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes(
				'step "s1" template variable "{{steps.unknown.output}}" must reference a previous step',
			),
		),
	);
});

test("parallel branch not an object returns error", () => {
	const result = validatePipelineDefinition(
		{
			version: 2,
			id: "demo",
			title: "Demo",
			primitives: {},
			steps: [
				{
					id: "s1",
					type: "parallel",
					branches: ["bad"],
				},
			],
		},
		"demo.yaml",
		minimalAgentConfigs(),
	);
	assert.ok(
		result.errors.some((e) =>
			e.includes('parallel step "s1" branch 1 must be an object'),
		),
	);
});
