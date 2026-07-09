import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type {
	CreateSandboxOptions,
	Sandbox,
	SandboxRunOptions,
} from "@ai-hero/sandcastle";

import { parseBridgeConfig } from "../src/sandcastle/BridgeConfig.js";
import { decidePromotionPolicy } from "../src/sandcastle/PromotionPolicy.js";
import {
	SandcastleBridgeAgent,
	type SandcastleRuntime,
} from "../src/sandcastle/BridgeAgent.js";

test("parseBridgeConfig parses provider model effort and image", () => {
	const config = parseBridgeConfig(
		["--provider", "codex", "--model", "gpt-5", "--effort", "xhigh"],
		{ ACP_SANDCASTLE_IMAGE: "custom:image" },
	);

	assert.deepEqual(config, {
		provider: "codex",
		model: "gpt-5",
		effort: "xhigh",
		imageName: "custom:image",
	});
	assert.throws(
		() => parseBridgeConfig(["--provider", "other", "--model", "gpt-5"], {}),
		/provider/,
	);
});

test("decidePromotionPolicy maps no changes and promotion modes", () => {
	const changed = {
		diff: "diff",
		filesChanged: 1,
		branch: "sandcastle/test",
		baseRef: "HEAD",
		worktreePath: "/tmp/worktree",
	};
	const empty = { ...changed, diff: "", filesChanged: 0 };

	assert.equal(decidePromotionPolicy(empty, "ask"), "discard_no_changes");
	assert.equal(decidePromotionPolicy(changed, "autoApply"), "auto_apply");
	assert.equal(decidePromotionPolicy(changed, "autoReject"), "auto_reject");
	assert.equal(decidePromotionPolicy(changed, "ask"), "prompt");
});

test("SandcastleBridgeAgent previews applies and rejects through an isolated worktree", async () => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sandcastle-agent-"));
	try {
		git(repo, ["init"]);
		git(repo, ["config", "user.email", "tests@example.com"]);
		git(repo, ["config", "user.name", "ACP Tests"]);
		fs.writeFileSync(path.join(repo, "README.md"), "# Test\n", "utf8");
		git(repo, ["add", "."]);
		git(repo, ["commit", "-m", "initial"]);

		const connection = new FakeConnection();
		const runtime = new FakeRuntime();
		const agent = new SandcastleBridgeAgent(connection as unknown as AgentSideConnection, {
			provider: "codex",
			model: "test",
			imageName: "fake",
		}, runtime);
		const { sessionId } = await agent.newSession({ cwd: repo, mcpServers: [] });

		const result = await agent.prompt({
			sessionId,
			prompt: [{ type: "text", text: "make a change" }],
		});

		assert.equal(result.stopReason, "end_turn");
		assert.equal(fs.existsSync(path.join(repo, "sentinel.txt")), false);
		assert.ok(connection.updates.some(update => update.update.content?.text === "done"));
		const preview = await agent.extMethod("sandcastle/preview", { sessionId });
		assert.equal(preview.filesChanged, 1);
		const applied = await agent.extMethod("sandcastle/apply", { sessionId });
		assert.equal(applied.success, true);
		assert.equal(fs.readFileSync(path.join(repo, "sentinel.txt"), "utf8"), "make a change");
		await agent.dispose();
	} finally {
		fs.rmSync(repo, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

class FakeConnection {
	readonly updates: any[] = [];

	async sessionUpdate(update: any): Promise<void> {
		this.updates.push(update);
	}
}

class FakeRuntime implements SandcastleRuntime {
	createProvider(): any {
		return {
			name: "fake",
			env: {},
			captureSessions: false,
			buildPrintCommand: () => ({ command: "true" }),
			parseStreamLine: () => [],
		};
	}

	createSandboxProvider(): any {
		return {};
	}

	async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
		const repo = options.cwd!;
		const worktree = path.join(repo, ".sandcastle-test", options.branch.replaceAll("/", "-"));
		fs.mkdirSync(path.dirname(worktree), { recursive: true });
		git(repo, ["worktree", "add", "-b", options.branch, worktree, options.baseBranch || "HEAD"]);

		return {
			branch: options.branch,
			worktreePath: worktree,
			run: async (runOptions: SandboxRunOptions) => {
				const prompt = runOptions.prompt || "";
				fs.writeFileSync(path.join(worktree, "sentinel.txt"), prompt, "utf8");
				(runOptions.logging as { onAgentStreamEvent?: (event: {
					type: "text";
					message: string;
					iteration: number;
					timestamp: Date;
				}) => void } | undefined)?.onAgentStreamEvent?.({
					type: "text",
					message: "done",
					iteration: 1,
					timestamp: new Date(),
				});
				return {
					iterations: [],
					stdout: "done",
					commits: [],
				};
			},
			interactive: async () => ({ commits: [], exitCode: 0 }),
			close: async () => {
				git(repo, ["worktree", "remove", "--force", worktree]);
				git(repo, ["branch", "-D", options.branch]);
				return {};
			},
			[Symbol.asyncDispose]: async () => undefined,
		};
	}
}
