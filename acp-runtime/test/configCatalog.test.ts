import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	loadAcpConfig,
	loadAgentCatalog,
	loadSandcastleConfig,
	parseAcpConfig,
	parseSandcastleConfig,
} from "../src/catalog/config.js";
import {
	getPipelineProgramForAgent,
	getPipelinePrograms,
	loadPipelineProgramsFromRoot,
	loadWorkspacePipelinePrograms,
} from "../src/catalog/pipelineCatalog.js";
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
	const config = parseAcpConfig(
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

test("loadAcpConfig loads config from the workspace root", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);

	const config = loadAcpConfig(workspace);

	assert.deepEqual(config.errors, []);
	assert.equal(config.agents["Codex CLI"].command, "codex");
	assert.equal(config.agents["Pi Agent"].command, "pi-acp");
	assert.equal(config.pipeline.enabled, true);
	assert.equal(config.pipeline.instructionsMaxBytes, 262144);
	assert.equal(config.filePath.replaceAll(String.fromCharCode(92), "/"), `${workspace.replaceAll(String.fromCharCode(92), "/")}/.acp/acp-agents.json`);
});

test("loadAcpConfig reports missing workspace config without package fallback", () => {
	const workspace = createTempWorkspace();

	const config = loadAcpConfig(workspace);

	assert.deepEqual(config.agents, {});
	assert.match(config.errors.join("\n"), /Missing ACP config at workspace root/);
});

test("parseAcpConfig reports JSON parse errors as empty config", () => {
	const config = parseAcpConfig("{not json");

	assert.deepEqual(config.agents, {});
	assert.equal(config.pipeline.enabled, true);
	assert.match(config.errors.join("\n"), /JSON parse error/);
});

test("parseAcpConfig rejects invalid agent and pipeline fields", () => {
	const config = parseAcpConfig(
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
	const config = parseAcpConfig(
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
	const configRoot = createTempWorkspace();

	const config = loadSandcastleConfig(workspace, configRoot);

	assert.deepEqual(config.errors, []);
	assert.deepEqual(config.agents, {});
	assert.equal(config.promotion, "autoApply");
});

test("loadAgentCatalog keeps native and Sandcastle agents disjoint but combines names for pipelines", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(
		workspace,
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

	const catalog = loadAgentCatalog(workspace);

	assert.deepEqual(catalog.errors, []);
	assert.ok(catalog.native.agents["Codex CLI"]);
	assert.equal(catalog.sandcastle.agents["Codex Sandcastle"].transport, "sandcastle");
	assert.equal(catalog.agents["Codex CLI"].transport, undefined);
	assert.equal(catalog.agents["Codex Sandcastle"].transport, "sandcastle");
});

test("duplicate native and Sandcastle agent names are errors and make v3 pipelines referencing the name invalid", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(
		workspace,
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
	writePipelineFile(workspace, "duplicate.yaml", [
		"version: 3",
		"id: duplicate",
		"title: Duplicate",
		"nodes:",
		"  - id: planner",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);
	const errors: string[] = [];

	const catalog = loadAgentCatalog(workspace);
	const result = loadPipelineProgramsFromRoot({
		workspaceCwd: workspace,
		configRoot: workspace,
		agentConfigs: catalog.agents,
		logger: {
			log: () => {},
			error: (message: string) => errors.push(message),
		},
	});

	assert.match(catalog.errors.join("\n"), /declared in both/);
	assert.equal(catalog.agents["Codex CLI"], undefined);
	assert.deepEqual(result.programs, []);
	assert.match(errors.join("\n"), /Codex CLI/);
});

test("loadPipelineProgramsFromRoot reports YAML parse errors", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/pipelines/broken.yaml", "version: 3\nnodes:\n  - : broken");

	const result = loadPipelineProgramsFromRoot({
		workspaceCwd: workspace,
		configRoot: workspace,
		agentConfigs: { "Codex CLI": { command: "codex" } },
	});

	assert.equal(result.programs.length, 0);
	assert.match(result.errors[0]?.errors.join("\n") ?? "", /YAML parse error/);
});

test("validates v3 pipeline agent references against Pi config", () => {
	const workspace = createTempWorkspace();
	writePipelineFile(workspace, "invalid.yaml", [
		"version: 3",
		"id: invalid",
		"title: Invalid",
		"nodes:",
		"  - id: planner",
		"    agent: Missing Agent",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);

	const result = loadWorkspacePipelinePrograms(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.equal(result.programs.length, 0);
	assert.match(result.errors[0]?.errors.join("\n") ?? "", /Missing Agent/);
});

test("getPipelinePrograms returns no pipelines for an unconfigured workspace", () => {
	const workspace = createTempWorkspace();

	const programs = getPipelinePrograms(workspace);

	assert.deepEqual(programs, []);
});

test("loads compiled v3 pipeline programs from workspace", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "demo.yaml", [
		"version: 3",
		"id: demo",
		"title: Demo Pipeline",
		"nodes:",
		"  - id: plan",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);

	const result = loadWorkspacePipelinePrograms(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.programs.map(program => program.id), ["demo"]);
	assert.deepEqual(result.programs[0].rootNodeIds, ["plan"]);
});

test("v3 pipeline program loader refuses v2 without conversion", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeDemoPipeline(workspace);

	const result = loadWorkspacePipelinePrograms(workspace, {
		"Codex CLI": { command: "codex" },
		"Pi Agent": { command: "pi-acp" },
	});

	assert.equal(result.programs.length, 0);
	assert.match(result.errors[0]?.errors.join("\n") ?? "", /Unsupported ACP pipeline version 2/);
});

test("loads .acp/pipelines/*.yml as v3 pipeline programs", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "short.yml", [
		"version: 3",
		"id: short",
		"title: Short Pipeline",
		"nodes:",
		"  - id: planner",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);

	const result = loadWorkspacePipelinePrograms(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.programs.map((program) => program.id), ["short"]);
});

test("getPipelineProgramForAgent resolves by id or title", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "plan-execute-verify.yaml", [
		"version: 3",
		"id: plan-execute-verify",
		"title: Plan Execute Verify",
		"nodes:",
		"  - id: planner",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);

	assert.equal(
		getPipelineProgramForAgent(workspace, "plan-execute-verify")?.title,
		"Plan Execute Verify",
	);
	assert.equal(
		getPipelineProgramForAgent(workspace, "Plan Execute Verify")?.id,
		"plan-execute-verify",
	);
	assert.equal(getPipelineProgramForAgent(workspace, "missing"), null);
});

test("workspace fixture loader ignores .acp/teams/*.yaml", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "demo.yaml", [
		"version: 3",
		"id: demo",
		"title: Demo Pipeline",
		"nodes:",
		"  - id: planner",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);
	writeDemoTeam(workspace);

	const result = loadWorkspacePipelinePrograms(workspace, {
		"Codex CLI": { command: "codex" },
	});

	assert.deepEqual(result.programs.map((program) => program.title), ["Demo Pipeline"]);
});

test("loadWorkspacePipelinePrograms logs invalid pipeline files and keeps valid ones", () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writePipelineFile(workspace, "bad.yaml", ["version: 3", "id: bad", "title: Bad"]);
	writePipelineFile(workspace, "good.yaml", [
		"version: 3",
		"id: good",
		"title: Good",
		"nodes:",
		"  - id: planner",
		"    agent: Codex CLI",
		"    prompt: '{{userPrompt}}'",
		"    output:",
		"      name: plan",
		"      type: acp.plan/v1",
		"      format: markdown",
		"",
	]);
	const errors: string[] = [];

	const result = loadWorkspacePipelinePrograms(
		workspace,
		{ "Codex CLI": { command: "codex" } },
		{
			log: () => {},
			error: (message: string) => errors.push(message),
		},
	);

	assert.deepEqual(result.programs.map((program) => program.id), ["good"]);
	assert.match(errors.join("\n"), /Ignoring invalid ACP pipeline/);
});

test("v3 promptFile paths resolve from workspace config root", () => {
	const workspace = createTempWorkspace();
	writeFile(workspace, ".acp/agents/planner.md", "Workspace planner.");
	writeFile(
		workspace,
		".acp/pipelines/plan.yaml",
		[
			"version: 3",
			"id: plan",
			"title: Plan Pipeline",
			"nodes:",
			"  - id: plan",
			"    agent: Codex CLI",
			"    promptFile: .acp/agents/planner.md",
			"    output:",
			"      name: plan",
			"      type: acp.plan/v1",
			"      format: markdown",
			"",
		].join("\n"),
	);

	const result = loadPipelineProgramsFromRoot({
		workspaceCwd: workspace,
		configRoot: workspace,
		agentConfigs: { "Codex CLI": { command: "codex" } },
	});

	assert.deepEqual(result.errors, []);
	assert.equal(result.programs[0].nodes[0].prompt, "Workspace planner.");
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

	assertIncludes(block, '<skill name="tdd">');
	assertIncludes(block, "Test-driven development.");
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

test("disable-model-invocation skill is injected when explicitly requested", () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "secret", {
		name: "secret",
		description: "User-only.",
		"disable-model-invocation": "true",
	});

	const catalog = loadSkillCatalog({ workspaceCwd: workspace });
	const block = renderSkillsCatalog(catalog, ["secret"], workspace);

	assertIncludes(block, '<skill name="secret">');
	assertIncludes(block, "User-only.");
});
