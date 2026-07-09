import * as assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

import type { PipelineAgentRunner } from "@acp-client/pipeline";
import type { SessionNotification } from "@agentclientprotocol/sdk";

import { EphemeralAcpRunner } from "../src/acp/ephemeralRunner.js";
import { RunAbortedError } from "../src/acp/runAbortedError.js";
import { handlePipelineCommand } from "../src/runtime/commands.js";
import { PipelineController } from "../src/runtime/pipelineController.js";
import {
	createTempWorkspace,
	writeDefaultConfig,
	writeDemoPipeline,
	writeSkill,
} from "./helpers.js";

test("mocked ACP runner collects agent_message_chunk text", async () => {
	const workspace = createTempWorkspace();
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async (input) => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async () => {
						input.sessionUpdateHandler.handleUpdate(textChunk("s1", "hello "));
						input.sessionUpdateHandler.handleUpdate(textChunk("s1", "world"));
						return { stopReason: "end_turn" };
					},
					cancel: async () => {},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {},
		}),
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "prompt",
	});

	assert.equal(result.text, "hello world");
});

test("cancellation calls connection.cancel and disposes the mocked process", async () => {
	const workspace = createTempWorkspace();
	const abortController = new AbortController();
	let cancelCalled = false;
	let disposed = false;
	let resolvePrompt: ((value: { stopReason: "cancelled" }) => void) | undefined;

	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async () =>
						new Promise<{ stopReason: "cancelled" }>((resolve) => {
							resolvePrompt = resolve;
						}),
					cancel: async () => {
						cancelCalled = true;
					},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {
				disposed = true;
			},
		}),
	});

	const promise = runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "prompt",
		signal: abortController.signal,
	});

	while (!resolvePrompt) {
		await setImmediate();
	}
	abortController.abort();

	for (let index = 0; index < 10 && !cancelCalled; index++) {
		await setImmediate();
	}
	resolvePrompt({ stopReason: "cancelled" });

	await assert.rejects(promise, RunAbortedError);
	assert.equal(cancelCalled, true);
	assert.equal(disposed, true);
});

test("/pipeline list reports configured pipelines", async () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeDemoPipeline(workspace);

	const notifications: string[] = [];
	const controller = new PipelineController(
		workspace,
		{ sendMessage: () => {} } as any,
		{
			runner: { run: async () => "<proposed_plan>unused</proposed_plan>" },
		},
	);

	await handlePipelineCommand(
		"list",
		commandContext(workspace, notifications),
		controller,
	);

	assert.match(notifications[0], /\[demo\] Demo Pipeline/);
});

test("/pipeline run then approve executes planner and implementer", async () => {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeDemoPipeline(workspace);

	const notifications: string[] = [];
	const messages: Array<{ content: unknown; details?: unknown }> = [];
	const calls: string[] = [];
	const runner: PipelineAgentRunner = async (input) => {
		calls.push(input.agentName);
		if (input.agentName === "Codex CLI") {
			return "<proposed_plan>Implement the feature.</proposed_plan>";
		}
		return "implementation done";
	};
	const controller = new PipelineController(
		workspace,
		{
			sendMessage: (message: { content: unknown; details?: unknown }) => {
				messages.push(message);
			},
		} as any,
		{
			runner: { run: runner },
		},
	);
	const ctx = commandContext(workspace, notifications);

	await handlePipelineCommand("run demo add tests", ctx, controller);
	await handlePipelineCommand("approve", ctx, controller);

	assert.deepEqual(calls, ["Codex CLI", "Pi Agent"]);
	assert.match(notifications.join("\n"), /plan ready/i);
	assert.equal(messages.length, 2);
	assert.match(String(messages[1].content), /implementation done/);
});

test("EphemeralAcpRunner prefixes the prompt with the filtered skills catalog", async () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});
	let sentPrompt = "";

	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async (request: { prompt: Array<{ text: string }> }) => {
						sentPrompt = request.prompt[0].text;
						return { stopReason: "end_turn" };
					},
					cancel: async () => {},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {},
		}),
	});

	await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "Do the work.",
		skills: ["tdd"],
	});

	assert.ok(sentPrompt.includes("<available_skills>"), sentPrompt);
	assert.ok(sentPrompt.includes("name: tdd"), sentPrompt);
	assert.ok(sentPrompt.endsWith("Do the work."), sentPrompt);
});

test("EphemeralAcpRunner skips skills injection when agents.<name>.skills is false", async () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});
	let sentPrompt = "";

	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			"Codex CLI": { command: "codex", skills: false },
		}),
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async (request: { prompt: Array<{ text: string }> }) => {
						sentPrompt = request.prompt[0].text;
						return { stopReason: "end_turn" };
					},
					cancel: async () => {},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {},
		}),
	});

	await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "Do the work.",
		skills: ["tdd"],
	});

	assert.equal(sentPrompt, "Do the work.");
});

test("EphemeralAcpRunner skips skills injection when skills is omitted", async () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});
	let sentPrompt = "";

	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async (request: { prompt: Array<{ text: string }> }) => {
						sentPrompt = request.prompt[0].text;
						return { stopReason: "end_turn" };
					},
					cancel: async () => {},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {},
		}),
	});

	await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "Do the work.",
	});

	assert.equal(sentPrompt, "Do the work.");
});

function textChunk(sessionId: string, text: string): SessionNotification {
	return {
		sessionId,
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		},
	};
}

function commandContext(workspace: string, notifications: string[]) {
	return {
		cwd: workspace,
		hasUI: true,
		mode: "tui",
		ui: {
			notify: (message: string) => {
				notifications.push(message);
			},
			select: async (_title: string, options: string[]) => options[0],
			confirm: async () => true,
			input: async () => undefined,
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			theme: {},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: true }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		},
		isIdle: () => true,
		isProjectTrusted: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		getSystemPromptOptions: () => ({}),
		waitForIdle: async () => {},
		newSession: async () => ({ cancelled: false }),
		fork: async () => ({ cancelled: false }),
		navigateTree: async () => ({ cancelled: false }),
		switchSession: async () => ({ cancelled: false }),
		reload: async () => {},
	} as any;
}
