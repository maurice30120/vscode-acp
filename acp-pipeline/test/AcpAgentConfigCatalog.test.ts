import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import {
	parseAcpAgentConfigCatalog,
	DEFAULT_INSTRUCTIONS_MAX_BYTES,
} from "../dist/index.js";

test("parses the shared flat ACP agent config used by VS Code and Pi", () => {
	const catalog = parseAcpAgentConfigCatalog(JSON.stringify({
		"Codex CLI": {
			command: " npx ",
			args: ["@zed-industries/codex-acp@latest"],
			env: { FOO: "bar" },
		},
		"Vibe Sandcastle": {
			transport: "sandcastle",
			provider: "vibe",
			model: "mistral-large-latest",
			maxIterations: 1,
			env: {
				VIBE_HOME: ".sandcastle/vibe-home",
			},
		},
	}));

	assert.deepEqual(catalog.errors, []);
	assert.equal(catalog.nativeAgents["Codex CLI"].command, "npx");
	assert.equal(catalog.sandcastleAgents["Vibe Sandcastle"].provider, "vibe");
	assert.equal(catalog.agents["Codex CLI"].transport, undefined);
	assert.equal(catalog.agents["Vibe Sandcastle"].transport, "sandcastle");
	assert.equal(catalog.pipeline.enabled, true);
	assert.equal(catalog.pipeline.instructionsMaxBytes, DEFAULT_INSTRUCTIONS_MAX_BYTES);
	assert.equal(catalog.promotion, "ask");
});

test("reports invalid native and Sandcastle agent fields through one validator", () => {
	const catalog = parseAcpAgentConfigCatalog(JSON.stringify({
		BadArgs: {
			command: "codex",
			args: ["ok", 1],
		},
		BadTransport: {
			transport: "stdio",
			command: "codex",
		},
		BadSandcastle: {
			transport: "sandcastle",
			provider: "claude",
			model: " ",
			effort: "max",
			maxIterations: 21,
			env: { TOKEN: 123 },
		},
	}));

	assert.deepEqual(catalog.agents, {});
	const errors = catalog.errors.join("\n");
	assert.match(errors, /agents\.BadArgs\.args/);
	assert.match(errors, /agents\.BadTransport\.transport/);
	assert.match(errors, /agents\.BadSandcastle\.provider/);
	assert.match(errors, /agents\.BadSandcastle\.model/);
	assert.match(errors, /agents\.BadSandcastle\.effort/);
	assert.match(errors, /agents\.BadSandcastle\.maxIterations/);
	assert.match(errors, /agents\.BadSandcastle\.env\.TOKEN/);
});

test("keeps ACP and Sandcastle config only at the repository root", () => {
	const repo = path.resolve(__dirname, "..", "..");
	const rootConfig = path.join(repo, ".acp");
	const rootSandcastle = path.join(repo, ".sandcastle");

	assert.ok(fs.existsSync(path.join(rootConfig, "acp-agents.json")));
	assert.ok(fs.existsSync(path.join(rootConfig, "pipelines", "plan-execute-verify.yaml")));
	assert.ok(fs.existsSync(path.join(rootSandcastle, "Dockerfile")));
	assert.deepEqual(findPluginConfigFiles(repo), []);
});

function findPluginConfigFiles(repo: string): string[] {
	const candidates = [
		path.join(repo, "plugin-pi", ".acp"),
		path.join(repo, "plugin-pi", ".pi", ".acp"),
		path.join(repo, "plugin-pi", ".sandcastle"),
		path.join(repo, "plugin-vscode", ".acp"),
		path.join(repo, "plugin-vscode", ".sandcastle"),
		path.join(repo, "plugin-vscode", "resources", "workspace-starter", ".acp"),
		path.join(repo, "plugin-vscode", "resources", "workspace-starter", ".sandcastle"),
	];
	const files: string[] = [];
	for (const root of candidates) {
		if (fs.existsSync(root)) {
			walk(root);
		}
	}
	return files.sort();

	function walk(dir: string): void {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const absolutePath = path.join(dir, entry.name);
			const relativePath = path.relative(repo, absolutePath).split(path.sep).join("/");
			if (entry.isDirectory()) {
				walk(absolutePath);
			} else if (entry.isFile()) {
				files.push(relativePath);
			}
		}
	}
}
