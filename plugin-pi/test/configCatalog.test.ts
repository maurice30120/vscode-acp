import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	loadPiAcpConfig,
	loadPiAgentCatalog,
	loadSandcastleConfig,
	parsePiAcpConfig,
	parseSandcastleConfig,
} from "../src/catalog/config.js";
import {
	getPipelineDefinitionForAgent,
	getPipelineDefinitions,
	loadPipelineDefinitionsFromRoot,
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

test("loads .acp/acp-agents.json compatible native ACP config", () => {
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

test("loadPiAcpConfig loads the embedded plugin config for an empty workspace", () => {
	const workspace = createTempWorkspace();

	const config = loadPiAcpConfig(workspace);

	assert.deepEqual(config.errors, []);
	assert.equal(config.agents["Codex CLI"].command, "npx");
	assert.equal(config.agents["Pi Agent"].command, "npx");
	assert.equal(config.pipeline.enabled, true);
	assert.equal(config.pipeline.instructionsMaxBytes, 262144);
	assert.match(config.filePath, /plugin-pi[\/\\]\.acp[\/\\]acp-agents\.json$/);
});

test("parsePiAcpConfig reports JSON parse errors as empty config", () => {
	const config = parsePiAcpConfig("{not json");

	assert.deepEqual(config.agents, {});
	assert.equal(config.pipeline.enabled, true);
	assert.match(config.errors.join("\n"), /JSON parse error/);
});

test("parsePiAcpConfig rejects invalid agent and pipeline fields", () => {
	const config = parsePiAcpConfig(
		JSON.stringify({
			agents: {
				BadArgs: {
					command: "codex",
					args: ["ok", 1],
				},
				BadEnv: {
					command: "codex",
					env: { TOKEN: 123 },
				},
				BadTransport: {
					transport: "stdio",
					command: "codex",
				},
				Good: {
					transport: "acp",
					command: "  codex  ",
					loginShell: true,
					displayName: "Codex",
					use_idea_mcp: true,
					use_custom_mcp: false,
					skills: false,
				},
			},
			pipeline: {
				enabled: "yes",
				instructionsMaxBytes: 0,
				timeouts: {
					promptMs: 1234,
					newSessionMs: -1,
				},
			},
		}),
	);

	assert.deepEqual(Object.keys(config.agents), ["Good"]);
	assert.equal(config.agents.Good.command, "codex");
	assert.equal(config.agents.Good.transport, "acp");
	assert.equal(config.agents.Good.loginShell, true);
	assert.equal(config.agents.Good.skills, false);
	assert.equal(config.pipeline.enabled, true);
	assert.equal(config.pipeline.instructionsMaxBytes, 262144);
	assert.equal(config.pipeline.timeouts?.promptMs, 1234);
	assert.match(config.errors.join("\n"), /BadArgs\.args/);
	assert.match(config.errors.join("\n"), /BadEnv\.env\.TOKEN/);
	assert.match(config.errors.join("\n"), /BadTransport\.transport/);
	assert.match(config.errors.join("\n"), /pipeline\.enabled/);
	assert.match(config.errors.join("\n"), /pipeline\.instructionsMaxBytes/);
	assert.match(config.errors.join("\n"), /pipeline\.timeouts\.newSessionMs/);
});

test("rejects sandcastle agents in native Pi config and points to dedicated file", () => {
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
	assert.match(config.errors.join("\n"), /agents\.Sandcastle\.transport/);
	assert.match(config.errors.join("\n"), /\.acp\/\.sandcastle\/config\.json/);
});

test("parseSandcastleConfig validates dedicated Sandcastle config", () => {
	const config = parseSandcastleConfig(
		JSON.stringify({
			promotion: "ask",
			agents: {
				"Codex Sandcastle": {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
					effort: "medium",
					maxIterations: 6,
					displayName: "Codex in Sandcastle",
					env: { FOO: "bar" },
					skills: false,
				},
				"Pi Sandcastle": {
					transport: "sandcastle",
					provider: "pi",
					model: "opencode-go/kimi-k2.6",
				},
				"Vibe Sandcastle": {
					transport: "sandcastle",
					provider: "vibe",
					model: "mistral-large-latest",
				},
			},
		}),
	);

	assert.deepEqual(config.errors, []);
	assert.equal(config.promotion, "ask");
	assert.equal(config.agents["Codex Sandcastle"].transport, "sandcastle");
	assert.equal(config.agents["Codex Sandcastle"].provider, "codex");
	assert.equal(config.agents["Codex Sandcastle"].model, "gpt-5");
	assert.equal(config.agents["Codex Sandcastle"].effort, "medium");
	assert.equal(config.agents["Codex Sandcastle"].maxIterations, 6);
	assert.equal(config.agents["Codex Sandcastle"].displayName, "Codex in Sandcastle");
	assert.deepEqual(config.agents["Codex Sandcastle"].env, { FOO: "bar" });
	assert.equal(config.agents["Codex Sandcastle"].skills, false);
	assert.equal(config.agents["Pi Sandcastle"].provider, "pi");
	assert.equal(config.agents["Vibe Sandcastle"].provider, "vibe");
});

test("parseSandcastleConfig reports explicit field errors", () => {
	const config = parseSandcastleConfig(
		JSON.stringify({
			promotion: "manual",
			agents: {
				Bad: {
					transport: "sandcastle",
					provider: "claude",
					model: " ",
					effort: "max",
					maxIterations: 21,
					env: { TOKEN: 123 },
				},
				MissingTransport: {
					provider: "codex",
					model: "gpt-5",
				},
			},
		}),
	);

	assert.deepEqual(config.agents, {});
	const errors = config.errors.join("\n");
	assert.match(errors, /promotion/);
	assert.match(errors, /agents\.Bad\.provider/);
	assert.match(errors, /agents\.Bad\.model/);
	assert.match(errors, /agents\.Bad\.effort/);
	assert.match(errors, /agents\.Bad\.maxIterations/);
	assert.match(errors, /agents\.Bad\.env\.TOKEN/);
	assert.match(errors, /agents\.MissingTransport\.transport/);
});

test("loadSandcastleConfig missing file is an empty non-regression", () => {
	const workspace = createTempWorkspace();
	const pluginRoot = createTempWorkspace();

	const config = loadSandcastleConfig(workspace, pluginRoot);

	assert.deepEqual(config.errors, []);
	assert.deepEqual(config.agents, {});
	assert.equal(config.promotion, "ask");
});

test("loadPiAgentCatalog keeps native and Sandcastle agents disjoint but combines names for pipelines", () => {
	const workspace = createTempWorkspace();
	const pluginRoot = createTempWorkspace();
	writeDefaultConfig(pluginRoot);
	writeFile(
		pluginRoot,
		".acp/.sandcastle/config.json",
		JSON.stringify({
			promotion: "autoReject",
			agents: {
				"Codex Sandcastle": {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
				},
			},
		}),
	);

	const catalog = loadPiAgentCatalog(workspace, pluginRoot);

	assert.deepEqual(catalog.errors, []);
	assert.ok(catalog.native.agents["Codex CLI"]);
	assert.equal(catalog.sandcastle.agents["Codex Sandcastle"].transport, "sandcastle");
	assert.equal(catalog.agents["Codex CLI"].transport, undefined);
	assert.equal(catalog.agents["Codex Sandcastle"].transport, "sandcastle");
});

test("duplicate native and Sandcastle agent names are errors and make pipelines referencing the name invalid", () => {
	const workspace = createTempWorkspace();
	const pluginRoot = createTempWorkspace();
	writeDefaultConfig(pluginRoot);
	writeFile(
		pluginRoot,
		".acp/.sandcastle/config.json",
		JSON.stringify({
			promotion: "ask",
			agents: {
				"Codex CLI": {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
				},
			},
		}),
	);
	writeFile(
		pluginRoot,
		".acp/pipelines/duplicate.yaml",
		[
			"version: 2",
			"id: duplicate",
			"title: Duplicate",
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
	);
	const errors: string[] = [];

	const catalog = loadPiAgentCatalog(workspace, pluginRoot);
	const definitions = loadPipelineDefinitionsFromRoot({
		workspaceCwd: workspace,
		configRoot: pluginRoot,
		agentConfigs: catalog.agents,
		logger: {
			log: () => {},
			error: message => errors.push(message),
		},
	});

	assert.match(catalog.errors.join("\n"), /declared in both/);
	assert.equal(catalog.agents["Codex CLI"], undefined);
	assert.deepEqual(definitions, []);
	assert.match(errors.join("\n"), /Codex CLI/);
});

test("parsePipelineYaml reports YAML parse errors", () => {
	const result = parsePipelineYaml(
		"version: 2\nprimitives:\n  - : broken",
		"broken.yaml",
		{ "Codex CLI": { command: "codex" } },
	);

	assert.equal(result.definition, undefined);
	assert.match(result.errors.join("\n"), /YAML parse error/);
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

test("getPipelineDefinitions loads embedded pipelines for an empty workspace", () => {
	const workspace = createTempWorkspace();

	const definitions = getPipelineDefinitions(workspace);

	assert.deepEqual(
		definitions.map((definition) => definition.id),
		["async-use-case-review", "plan-execute-verify", "vibe"],
	);
});

test("loads .acp/pipelines/*.yaml from workspace", () => {
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

test("loads .acp/pipelines/*.yml from workspace", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "short.yml", [
		"version: 2",
		"id: short",
		"title: Short Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		'    prompt: "{{userPrompt}}"',
		"    output: proposed_plan",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"",
	]);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.deepEqual(
		definitions.map((definition) => definition.id),
		["short"],
	);
});

test("getPipelineDefinitionForAgent resolves by id or title", () => {
	const workspace = createTempWorkspace();

	assert.equal(
		getPipelineDefinitionForAgent(workspace, "plan-execute-verify")?.title,
		"Plan Execute Verify",
	);
	assert.equal(
		getPipelineDefinitionForAgent(workspace, "Plan Execute Verify")?.id,
		"plan-execute-verify",
	);
	assert.equal(getPipelineDefinitionForAgent(workspace, "missing"), null);
});

test("workspace fixture loader ignores .acp/teams/*.yaml", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeDemoPipeline(workspace);
	writeDemoTeam(workspace);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
		"Pi Agent": { command: "pi-acp" },
	});

	assert.deepEqual(
		definitions.map((definition) => definition.title),
		["Demo Pipeline"],
	);
});

test("loadWorkspacePipelineDefinitions logs invalid pipeline files and keeps valid ones", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "bad.yaml", ["version: 2", "id: bad", "title: Bad"]);
	writeDemoPipeline(workspace);
	const errors: string[] = [];

	const definitions = loadWorkspacePipelineDefinitions(
		workspace,
		{
			"Codex CLI": { command: "codex" },
			"Pi Agent": { command: "pi-acp" },
		},
		{
			log: () => {},
			error: (message) => errors.push(message),
		},
	);

	assert.deepEqual(
		definitions.map((definition) => definition.id),
		["demo"],
	);
	assert.match(errors.join("\n"), /Ignoring invalid ACP pipeline/);
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

test("promptFile can be resolved relative to the pipeline YAML file", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".acp/pipelines/prompts/planner.md", "Relative plan.");
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: prompts/planner.md",
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
	assert.equal(definitions[0].primitives.planner.prompt, "Relative plan.");
});

test("promptFile loads and composes the prompt (promptFile + blank line + prompt)", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".acp/agents/planner.md", "You are a careful planner.");
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .acp/agents/planner.md",
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
	if (typeof prompt !== "string") {
		assert.fail("expected planner prompt to be resolved");
	}
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

test("pipeline primitive permissions accepts allowAll and defaults to ask", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "permissions.yaml", [
		"version: 2",
		"id: permissions",
		"title: Permissions",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output: proposed_plan",
		"    sideEffects: none",
		"    permissions: allowAll",
		"  reviewer:",
		"    agent: Codex CLI",
		"    prompt: '{{steps.planner.output}}'",
		"    output: markdown",
		"    sideEffects: none",
		"steps:",
		"  - id: planner",
		"    use: planner",
		"  - id: reviewer",
		"    use: reviewer",
		"",
	]);

	const definitions = loadWorkspacePipelineDefinitions(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.equal(definitions.length, 1);
	assert.equal(definitions[0].primitives.planner.permissions, "allowAll");
	assert.equal(definitions[0].primitives.reviewer.permissions, "ask");
});

test("pipeline primitive permissions rejects invalid values", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "permissions.yaml", [
		"version: 2",
		"id: permissions",
		"title: Permissions",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output: proposed_plan",
		"    sideEffects: none",
		"    permissions: yolo",
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

test("embedded promptFile paths resolve from config root, not workspace root", () => {
	const workspace = createTempWorkspace();
	const pluginRoot = createTempWorkspace();
	writeFile(pluginRoot, ".acp/agents/planner.md", "Embedded planner.");
	writeFile(workspace, ".acp/agents/planner.md", "Workspace planner.");
	writeFile(
		pluginRoot,
		".acp/pipelines/plan.yaml",
		[
			"version: 2",
			"id: plan",
			"title: Plan Pipeline",
			"primitives:",
			"  planner:",
			"    agent: Codex CLI",
			"    promptFile: .acp/agents/planner.md",
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
	);

	const definitions = loadPipelineDefinitionsFromRoot({
		workspaceCwd: workspace,
		configRoot: pluginRoot,
		agentConfigs: { "Codex CLI": { command: "codex" } },
	});

	assert.equal(definitions.length, 1);
	assert.equal(definitions[0].primitives.planner.prompt, "Embedded planner.");
});

test("directory promptFile renders the pipeline invalid", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".acp/agents/planner/.keep", "");
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .acp/agents/planner",
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

test("promptFile alone (no inline prompt) is accepted", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(workspace, ".acp/agents/planner.md", "Plan: {{userPrompt}}");
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .acp/agents/planner.md",
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
		"    promptFile: .acp/agents/missing.md",
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
	writeFile(workspace, ".acp/agents/planner.md", "0123456789".repeat(100));
	writePipelineFile(workspace, "plan.yaml", [
		"version: 2",
		"id: plan",
		"title: Plan Pipeline",
		"primitives:",
		"  planner:",
		"    agent: Codex CLI",
		"    promptFile: .acp/agents/planner.md",
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
			"    promptFile: .acp/agents/planner.md",
			"    output: proposed_plan",
			"steps:",
			"  - id: planner",
			"    use: planner",
			"",
		].join("\n"),
		`${workspace}/.acp/pipelines/plan.yaml`,
		{ "Codex CLI": { command: "codex" } },
	);

	const resolved = resolvePipelinePromptFiles(result.definition!.primitives, {
		workspaceCwd: workspace,
		maxBytes: 4,
		pipelineFilePath: `${workspace}/.acp/pipelines/plan.yaml`,
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
		`${workspace}/.acp/pipelines/plan.yaml`,
		{ "Codex CLI": { command: "codex" } },
	);

	const resolved = resolvePipelinePromptFiles(result.definition!.primitives, {
		workspaceCwd: workspace,
		maxBytes: 262144,
		pipelineFilePath: `${workspace}/.acp/pipelines/plan.yaml`,
	});

	assert.equal(resolved.errors.length, 1);
	assert.match(resolved.errors[0].error, /stay within/);
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
