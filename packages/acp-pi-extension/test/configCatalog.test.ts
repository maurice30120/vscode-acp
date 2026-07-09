import * as assert from "node:assert/strict";
import { test } from "node:test";

import { parsePiAcpConfig } from "../src/catalog/config.js";
import {
	getPipelineDefinitions,
	loadWorkspacePipelineDefinitions,
	parsePipelineYaml,
} from "../src/catalog/pipelineCatalog.js";
import { resolvePipelinePromptFiles } from "../src/catalog/promptFileResolver.js";
import {
	loadSkillCatalog,
	renderSkillsCatalog,
} from "../src/catalog/skillCatalog.js";
import {
	assertIncludes,
	createTempWorkspace,
	writeFile,
	writeDefaultConfig,
	writeDemoPipeline,
	writeDemoTeam,
	writePipelineFile,
	writeSkill,
} from "./helpers.js";

test("loads .pi/acp-agents.json compatible native ACP config", () => {
	const config = parsePiAcpConfig(
		JSON.stringify({
			agents: {
				"Codex CLI": {
					command: "npx",
					args: ["@zed-industries/codex-acp@latest"],
					env: { FOO: "bar" },
				},
			},
			pipeline: {
				enabled: true,
				instructionsMaxBytes: 1234,
			},
		}),
	);

	assert.deepEqual(config.errors, []);
	assert.equal(config.agents["Codex CLI"].command, "npx");
	assert.equal(
		config.agents["Codex CLI"].args?.[0],
		"@zed-industries/codex-acp@latest",
	);
	assert.equal(config.pipeline.instructionsMaxBytes, 1234);
});

test("rejects sandcastle agents in Pi config v1", () => {
	const config = parsePiAcpConfig(
		JSON.stringify({
			agents: {
				Sandcastle: {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
				},
			},
		}),
	);

	assert.equal(config.agents.Sandcastle, undefined);
	assert.match(config.errors.join("\n"), /sandcastle/);
});

test("validates pipeline agent references against Pi config", () => {
	const valid = parsePipelineYaml(
		[
			"version: 2",
			"id: valid",
			"title: Valid",
			"primitives:",
			"  planner:",
			"    agent: Codex CLI",
			'    prompt: "{{userPrompt}}"',
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
		"valid.yaml",
		{ "Codex CLI": { command: "codex" } },
	);

	assert.equal(valid.errors.length, 0);
	assert.equal(valid.definition?.title, "Valid");

	const invalid = parsePipelineYaml(
		[
			"version: 2",
			"id: invalid",
			"title: Invalid",
			"primitives:",
			"  planner:",
			"    agent: Missing Agent",
			'    prompt: "{{userPrompt}}"',
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
		"invalid.yaml",
		{ "Codex CLI": { command: "codex" } },
	);

	assert.match(invalid.errors.join("\n"), /Missing Agent/);
});

test("loads .pi/.acp/pipelines/*.yaml from workspace", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeDemoPipeline(workspace);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
		"Pi Agent": { command: "pi-acp" },
	});

	assert.equal(definitions.length, 1);
	assert.equal(definitions[0].title, "Demo Pipeline");
});

test("getPipelineDefinitions ignores .acp/teams/*.yaml", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeDemoPipeline(workspace);
	writeDemoTeam(workspace);

	const definitions = getPipelineDefinitions(workspace);

	assert.deepEqual(
		definitions.map((definition) => definition.title),
		["Demo Pipeline"],
	);
});

test("primitive requires either prompt or promptFile", () => {
	const missing = parsePipelineYaml(
		[
			"version: 2",
			"id: missing",
			"title: Missing",
			"primitives:",
			"  planner:",
			"    agent: Codex CLI",
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
		"missing.yaml",
		{ "Codex CLI": { command: "codex" } },
	);

	assert.match(
		missing.errors.join("\n"),
		/must define either prompt or promptFile/,
	);
	assert.equal(missing.definition, undefined);
});

test("promptFile loads and composes the prompt (promptFile + blank line + prompt)", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".pi/.acp/agents/planner.md", "You are a careful planner.");
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .pi/.acp/agents/planner.md",
		"    prompt: |",
		"      User request:",
		"      {{userPrompt}}",
		"    output: proposed_plan",
		"    sideEffects: none",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"",
	]);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.equal(definitions.length, 1);
	const prompt = definitions[0].primitives.planner.prompt;
	assertIncludes(prompt, "You are a careful planner.");
	assertIncludes(prompt, "User request:");
	assert.ok(
		prompt.indexOf("You are a careful planner.") <
			prompt.indexOf("User request:"),
	);
	// promptFile content and inline prompt separated by a blank line
	assertIncludes(prompt, "careful planner.\n\nUser request:");
	assert.equal(definitions[0].primitives.planner.promptFile, undefined);
});

test("promptFile alone (no inline prompt) is accepted", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".pi/.acp/agents/planner.md", "Plan: {{userPrompt}}");
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .pi/.acp/agents/planner.md",
		"    output: proposed_plan",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"",
	]);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.equal(definitions.length, 1);
	assert.equal(
		definitions[0].primitives.planner.prompt,
		"Plan: {{userPrompt}}",
	);
});

test("missing promptFile renders the pipeline invalid", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .pi/.acp/agents/missing.md",
		"    output: proposed_plan",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"",
	]);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.equal(definitions.length, 0);
});

test("oversized promptFile renders the pipeline invalid", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".pi/.acp/agents/planner.md", "0123456789".repeat(100));
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .pi/.acp/agents/planner.md",
		"    output: proposed_plan",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"",
	]);

	// Force a tiny max bytes by calling the resolver directly.
	const result = parsePipelineYaml(
		[
			"version: 2",
			"id: plan",
			"title: Plan Pipeline",
			"primitives:",
			"  planner:",
			"    agent: Codex CLI",
			"    promptFile: .pi/.acp/agents/planner.md",
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
		`${workspace}/.pi/.acp/pipelines/plan.yaml`,
		{ "Codex CLI": { command: "codex" } },
	);

	const resolved = resolvePipelinePromptFiles(result.definition!.primitives, {
		workspaceCwd: workspace,
		maxBytes: 4,
		pipelineFilePath: `${workspace}/.pi/.acp/pipelines/plan.yaml`,
	});

	assert.equal(resolved.errors.length, 1);
	assert.match(resolved.errors[0].error, /exceeds max size/);
});

test("promptFile outside the workspace is rejected", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: ../../etc/passwd",
		"    output: proposed_plan",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"",
	]);

	const result = parsePipelineYaml(
		[
			"version: 2",
			"id: plan",
			"title: Plan Pipeline",
			"primitives:",
			"  planner:",
			"    agent: Codex CLI",
			"    promptFile: ../../etc/passwd",
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
		`${workspace}/.pi/.acp/pipelines/plan.yaml`,
		{ "Codex CLI": { command: "codex" } },
	);

	const resolved = resolvePipelinePromptFiles(result.definition!.primitives, {
		workspaceCwd: workspace,
		maxBytes: 262144,
		pipelineFilePath: `${workspace}/.pi/.acp/pipelines/plan.yaml`,
	});

	assert.equal(resolved.errors.length, 1);
	assert.match(resolved.errors[0].error, /stay within the workspace/);
});

test("loadSkillCatalog parses frontmatter and flags disable-model-invocation", () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});
	writeSkill(workspace, "secret", {
		name: "secret",
		description: "User-only skill.",
		"disable-model-invocation": "true",
	});
	// Skill without a name/description is skipped.
	writeFile(
		workspace,
		".agents/skills/broken/SKILL.md",
		"---\ndescription: nope\n---\n",
	);

	const catalog = loadSkillCatalog({ workspaceCwd: workspace });

	assert.equal(catalog.length, 2);
	assert.equal(catalog[0].name, "secret");
	assert.equal(catalog[0].disableModelInvocation, true);
	assert.equal(catalog[1].name, "tdd");
	assert.equal(catalog[1].disableModelInvocation, false);
});

test("renderSkillsCatalog injects only the allowed skill entry", () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});
	writeSkill(workspace, "code-review", {
		name: "code-review",
		description: "Review code.",
	});

	const catalog = loadSkillCatalog({ workspaceCwd: workspace });
	const block = renderSkillsCatalog(catalog, ["tdd"], workspace);

	assertIncludes(block, "<available_skills>");
	assertIncludes(block, "name: tdd");
	assertIncludes(block, "description: Test-driven development.");
	assertIncludes(block, ".agents/skills/tdd/SKILL.md");
	assert.ok(!block.includes("code-review"));
});

test("skills omitted produces no catalog block", () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});

	const catalog = loadSkillCatalog({ workspaceCwd: workspace });
	const block = renderSkillsCatalog(catalog, undefined, workspace);

	assert.equal(block, "");
});

test("disable-model-invocation skill is excluded from the catalog block", () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "secret", {
		name: "secret",
		description: "User-only.",
		"disable-model-invocation": "true",
	});

	const catalog = loadSkillCatalog({ workspaceCwd: workspace });
	const block = renderSkillsCatalog(catalog, ["secret"], workspace);

	assert.equal(block, "");
});
