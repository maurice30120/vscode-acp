import * as assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

import { PipelineService, type PipelineAgentRunner } from "@acp-client/pipeline";
import type { SessionNotification } from "@agentclientprotocol/sdk";

import { EphemeralAcpRunner } from "../src/acp/ephemeralRunner.js";
import { RunAbortedError } from "../src/acp/runAbortedError.js";
import {
	handlePipelineCommand,
	parseRunArgs,
	registerPipelineCommand,
} from "../src/runtime/commands.js";
import { PipelineController } from "../src/runtime/pipelineController.js";
import { registerRunPipelineTool } from "../src/runtime/tool.js";
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

test("EphemeralAcpRunner routes Sandcastle agents to the Sandcastle connector", async () => {
	const workspace = createTempWorkspace();
	let nativeCalls = 0;
	let sandcastleCalls = 0;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			"Codex CLI": { command: "codex" },
			"Codex Sandcastle": {
				transport: "sandcastle",
				provider: "codex",
				model: "gpt-5",
			},
		}),
		connector: async () => {
			nativeCalls += 1;
			throw new Error("native connector should not run");
		},
		sandcastleConnector: async (input) => {
			sandcastleCalls += 1;
			return mockConnectedAgent(input, {
				extMethod: async (method) => {
					assert.equal(method, "sandcastle/reject");
					return { success: true };
				},
			});
		},
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex Sandcastle",
		promptText: "prompt",
	});

	assert.equal(result.text, "sandcastle output");
	assert.equal(result.promotion, undefined);
	assert.equal(nativeCalls, 0);
	assert.equal(sandcastleCalls, 1);
});

test("EphemeralAcpRunner discards Sandcastle sideEffects none without promotion outcome", async () => {
	const workspace = createTempWorkspace();
	const calls: string[] = [];
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			Sandbox: {
				transport: "sandcastle",
				provider: "codex",
				model: "gpt-5",
			},
		}),
		sandcastleConnector: async (input) => mockConnectedAgent(input, {
			extMethod: async (method) => {
				calls.push(method);
				return { success: true };
			},
		}),
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Sandbox",
		promptText: "prompt",
		sideEffects: "none",
	});

	assert.equal(result.text, "sandcastle output");
	assert.equal(result.promotion, undefined);
	assert.deepEqual(calls, ["sandcastle/reject"]);
});

test("EphemeralAcpRunner auto-applies Sandcastle workspace promotion", async () => {
	const workspace = createTempWorkspace();
	const calls: string[] = [];
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			Sandbox: {
				transport: "sandcastle",
				provider: "codex",
				model: "gpt-5",
			},
		}),
		getSandcastlePromotion: () => "autoApply",
		sandcastleConnector: async (input) => mockConnectedAgent(input, {
			extMethod: async (method) => {
				calls.push(method);
				if (method === "sandcastle/preview") {
					return sandcastlePreview(2);
				}
				if (method === "sandcastle/apply") {
					return { success: true, filesChanged: 2 };
				}
				throw new Error(`unexpected method ${method}`);
			},
		}),
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Sandbox",
		promptText: "prompt",
		sideEffects: "workspace",
	});

	assert.equal(result.promotion, "applied");
	assert.deepEqual(calls, ["sandcastle/preview", "sandcastle/apply"]);
});

test("EphemeralAcpRunner maps Sandcastle no changes to no_changes", async () => {
	const workspace = createTempWorkspace();
	const calls: string[] = [];
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			Sandbox: {
				transport: "sandcastle",
				provider: "codex",
				model: "gpt-5",
			},
		}),
		getSandcastlePromotion: () => "autoApply",
		sandcastleConnector: async (input) => mockConnectedAgent(input, {
			extMethod: async (method) => {
				calls.push(method);
				if (method === "sandcastle/preview") {
					return sandcastlePreview(0);
				}
				if (method === "sandcastle/reject") {
					return { success: true };
				}
				throw new Error(`unexpected method ${method}`);
			},
		}),
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Sandbox",
		promptText: "prompt",
		sideEffects: "workspace",
	});

	assert.equal(result.promotion, "no_changes");
	assert.deepEqual(calls, ["sandcastle/preview", "sandcastle/reject"]);
});

test("EphemeralAcpRunner auto-rejects Sandcastle workspace promotion", async () => {
	const workspace = createTempWorkspace();
	const calls: string[] = [];
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			Sandbox: {
				transport: "sandcastle",
				provider: "codex",
				model: "gpt-5",
			},
		}),
		getSandcastlePromotion: () => "autoReject",
		sandcastleConnector: async (input) => mockConnectedAgent(input, {
			extMethod: async (method) => {
				calls.push(method);
				if (method === "sandcastle/preview") {
					return sandcastlePreview(1);
				}
				if (method === "sandcastle/reject") {
					return { success: true };
				}
				throw new Error(`unexpected method ${method}`);
			},
		}),
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Sandbox",
		promptText: "prompt",
		sideEffects: "workspace",
	});

	assert.equal(result.promotion, "rejected");
	assert.deepEqual(calls, ["sandcastle/preview", "sandcastle/reject"]);
});

test("EphemeralAcpRunner maps ask promotion approval, rejection, and headless cancel", async () => {
	const workspace = createTempWorkspace();

	for (const [decision, expected] of [
		["approve", "applied"],
		["reject", "rejected"],
		["cancelled", "cancelled"],
	] as const) {
		const calls: string[] = [];
		const runner = new EphemeralAcpRunner(workspace, {
			getAgentConfigs: () => ({
				Sandbox: {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
				},
			}),
			getSandcastlePromotion: () => "ask",
			requestSandcastlePromotion: async () => decision,
			sandcastleConnector: async (input) => mockConnectedAgent(input, {
				extMethod: async (method) => {
					calls.push(method);
					if (method === "sandcastle/preview") {
						return sandcastlePreview(1);
					}
					if (method === "sandcastle/apply") {
						return { success: true, filesChanged: 1 };
					}
					if (method === "sandcastle/reject") {
						return { success: true };
					}
					throw new Error(`unexpected method ${method}`);
				},
			}),
		});

		const result = await runner.runAgent({
			workspaceCwd: workspace,
			agentName: "Sandbox",
			promptText: "prompt",
			sideEffects: "workspace",
		});

		assert.equal(result.promotion, expected);
		assert.deepEqual(
			calls,
			decision === "approve"
				? ["sandcastle/preview", "sandcastle/apply"]
				: ["sandcastle/preview", "sandcastle/reject"],
		);
	}
});

test("EphemeralAcpRunner surfaces Sandcastle apply check failures", async () => {
	const workspace = createTempWorkspace();
	const calls: string[] = [];
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			Sandbox: {
				transport: "sandcastle",
				provider: "codex",
				model: "gpt-5",
			},
		}),
		getSandcastlePromotion: () => "autoApply",
		sandcastleConnector: async (input) => mockConnectedAgent(input, {
			extMethod: async (method) => {
				calls.push(method);
				if (method === "sandcastle/preview") {
					return sandcastlePreview(1);
				}
				if (method === "sandcastle/apply") {
					return { success: false, filesChanged: 1, message: "git apply --check failed" };
				}
				return { success: true };
			},
		}),
	});

	await assert.rejects(
		() => runner.runAgent({
			workspaceCwd: workspace,
			agentName: "Sandbox",
			promptText: "prompt",
			sideEffects: "workspace",
		}),
		/git apply --check failed/,
	);
	assert.deepEqual(calls, ["sandcastle/preview", "sandcastle/apply", "sandcastle/reject"]);
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

test("EphemeralAcpRunner rejects unknown agents before connecting", async () => {
	const workspace = createTempWorkspace();
	let connectorCalled = false;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({}),
		connector: async () => {
			connectorCalled = true;
			throw new Error("should not connect");
		},
	});

	await assert.rejects(
		() =>
			runner.runAgent({
				workspaceCwd: workspace,
				agentName: "Missing",
				promptText: "prompt",
			}),
		/not configured/,
	);
	assert.equal(connectorCalled, false);
});

test("EphemeralAcpRunner rejects an already aborted signal before connecting", async () => {
	const workspace = createTempWorkspace();
	const abortController = new AbortController();
	abortController.abort();
	let connectorCalled = false;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async () => {
			connectorCalled = true;
			throw new Error("should not connect");
		},
	});

	await assert.rejects(
		() =>
			runner.runAgent({
				workspaceCwd: workspace,
				agentName: "Codex CLI",
				promptText: "prompt",
				signal: abortController.signal,
			}),
		RunAbortedError,
	);
	assert.equal(connectorCalled, false);
});

test("EphemeralAcpRunner throws RunAbortedError when prompt response is cancelled", async () => {
	const workspace = createTempWorkspace();
	let disposed = false;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async () => ({ stopReason: "cancelled" }),
					cancel: async () => {},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {
				disposed = true;
			},
		}),
	});

	await assert.rejects(
		() =>
			runner.runAgent({
				workspaceCwd: workspace,
				agentName: "Codex CLI",
				promptText: "prompt",
			}),
		RunAbortedError,
	);
	assert.equal(disposed, true);
});

test("EphemeralAcpRunner retries newSession after auth flow", async () => {
	const workspace = createTempWorkspace();
	let newSessionCalls = 0;
	let authenticatedMethod = "";
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		getPermissionContext: () => ({
			hasUI: true,
			ui: {
				confirm: async () => true,
			},
		} as any),
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {
					authMethods: [{ id: "browser", name: "Browser" }],
				},
				client: undefined,
				connection: {
					newSession: async () => {
						newSessionCalls += 1;
						if (newSessionCalls === 1) {
							throw { code: -32000 };
						}
						return { sessionId: "s1" };
					},
					prompt: async () => ({ stopReason: "end_turn" }),
					cancel: async () => {},
					authenticate: async ({ methodId }: { methodId: string }) => {
						authenticatedMethod = methodId;
						return {};
					},
				},
			} as any,
			dispose: () => {},
		}),
	});

	await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "prompt",
	});

	assert.equal(newSessionCalls, 2);
	assert.equal(authenticatedMethod, "browser");
});

test("EphemeralAcpRunner ignores and does not forward updates from other sessions", async () => {
	const workspace = createTempWorkspace();
	const forwarded: string[] = [];
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
						input.sessionUpdateHandler.handleUpdate(textChunk("other", "ignore"));
						input.sessionUpdateHandler.handleUpdate(textChunk("s1", "keep"));
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
		onSessionUpdate: (update) => forwarded.push(update.sessionId),
	});

	assert.equal(result.text, "keep");
	assert.deepEqual(forwarded, ["s1"]);
});

test("/pipeline list reports configured pipelines", async () => {
	const workspace = createTempWorkspace();

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

	assert.match(notifications[0], /\[plan-execute-verify\] Plan Execute Verify/);
});

test("/pipeline run then approve executes planner and implementer", async () => {
	const workspace = createTempWorkspace();

	const notifications: string[] = [];
	const messages: Array<{ content: unknown; details?: unknown }> = [];
	const calls: string[] = [];
	const runner: PipelineAgentRunner = async (input) => {
		calls.push(input.agentName);
		if (input.agentName === "Pi Agent") {
			return "<proposed_plan>Implement the feature.</proposed_plan>";
		}
		if (input.agentName === "Vibe") {
			return "implementation done";
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

	await handlePipelineCommand("run plan-execute-verify add tests", ctx, controller);
	await handlePipelineCommand("approve", ctx, controller);

	assert.deepEqual(calls, ["Pi Agent", "Vibe", "OpenCode"]);
	assert.match(notifications.join("\n"), /plan ready/i);
	assert.ok(messages.length >= 2);
	assert.ok(messages.some((message) => String(message.content).includes("ACP Pipeline Plan")));
	assert.ok(!messages.some((message) => String(message.content).includes("Sandcastle implementation")));
	assert.ok(messages.some((message) => String(message.content).includes("implementation done")));
});

test("PipelineService plan_ready message mentions Sandcastle for a Sandcastle implementer", async () => {
	const workspace = createTempWorkspace();
	const statuses: string[] = [];
	const definition = {
		version: 2 as const,
		id: "sandcastle-plan",
		title: "Sandcastle Plan",
		primitives: {
			planner: {
				agent: "Planner",
				prompt: "Plan {{userPrompt}}",
				output: "proposed_plan" as const,
				sideEffects: "none" as const,
			},
			implementer: {
				agent: "Codex Sandcastle",
				prompt: "Implement {{steps.approval.output}}",
				output: "markdown" as const,
				sideEffects: "workspace" as const,
			},
		},
		steps: [
			{ id: "plan", use: "planner" },
			{ id: "approval", type: "approval" as const, input: "{{steps.plan.output}}" },
			{ id: "implement", use: "implementer" },
		],
	};
	const service = new PipelineService(
		() => workspace,
		{
			getPipelineDefinitions: () => [definition],
			getPipelineDefinitionForAgent: agentName =>
				agentName === definition.id ? definition : null,
			getAgentConfigs: () => ({
				Planner: { command: "planner" },
				"Codex Sandcastle": {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
				},
			}),
			isAgentSandcastle: (agentName, configs) =>
				(configs[agentName] as { transport?: string } | undefined)?.transport === "sandcastle",
			runAgent: async () => "<proposed_plan>Use Sandcastle.</proposed_plan>",
		},
	);
	service.on("status", event => {
		if (event.status === "awaiting_approval") {
			statuses.push(event.message);
		}
	});

	await service.createPlan("session-1", "add feature", "sandcastle-plan");

	assert.deepEqual(statuses, ["Plan ready — approve before Sandcastle implementation."]);
	await service.dispose();
});

test("/pipeline verbose toggles runtime verbose mode", async () => {
	const notifications: string[] = [];
	const controller = new PipelineController(
		createTempWorkspace(),
		{ sendMessage: () => {} } as any,
		{
			runner: { run: async () => "unused" },
		},
	);
	const ctx = commandContext(createTempWorkspace(), notifications);

	await handlePipelineCommand("verbose status", ctx, controller);
	await handlePipelineCommand("verbose on", ctx, controller);
	await handlePipelineCommand("verbose status", ctx, controller);
	await handlePipelineCommand("verbose off", ctx, controller);

	assert.match(notifications[0], /disabled/);
	assert.match(notifications[1], /enabled/);
	assert.match(notifications[2], /enabled/);
	assert.match(notifications[3], /disabled/);
});

test("PipelineController compact activity omits agent message chunks", async () => {
	const workspace = createTempWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.(textChunk("s1", "internal chunk"));
		if (input.agentName === "Pi Agent") {
			return "<proposed_plan>Implement the feature.</proposed_plan>";
		}
		return "implementation done";
	};
	const controller = new PipelineController(
		workspace,
		{
			sendMessage: (message: { content: unknown; details?: { kind?: string } }) => {
				messages.push(message);
			},
		} as any,
		{
			runner: { run: runner },
		},
	);

	await controller.runPipeline("plan-execute-verify", "add tests");

	assert.ok(messages.some((message) => message.details?.kind === "activity-status"));
	assert.ok(!messages.some((message) => message.details?.kind === "verbose-session-update"));
	assert.ok(!messages.some((message) => String(message.content).includes("internal chunk")));
});

test("PipelineController verbose activity relays session updates", async () => {
	const workspace = createTempWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.(textChunk("s1", "debug chunk"));
		if (input.agentName === "Pi Agent") {
			return "<proposed_plan>Implement the feature.</proposed_plan>";
		}
		return "implementation done";
	};
	const controller = new PipelineController(
		workspace,
		{
			sendMessage: (message: { content: unknown; details?: { kind?: string } }) => {
				messages.push(message);
			},
		} as any,
		{
			runner: { run: runner },
		},
	);
	controller.setVerbose(true);

	await controller.runPipeline("plan-execute-verify", "add tests");

	assert.ok(messages.some((message) => message.details?.kind === "verbose-status"));
	assert.ok(messages.some((message) => message.details?.kind === "verbose-session-update"));
	assert.ok(messages.some((message) => String(message.content).includes("debug chunk")));
});

test("PipelineController sends compact heartbeat during long-running activity", async () => {
	const workspace = createTempWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
		return "<proposed_plan>Implement the feature.</proposed_plan>";
	};
	const controller = new PipelineController(
		workspace,
		{
			sendMessage: (message: { content: unknown; details?: { kind?: string } }) => {
				messages.push(message);
			},
		} as any,
		{
			runner: { run: runner },
			heartbeatIntervalMs: 5,
		},
	);

	await controller.runPipeline("plan-execute-verify", "add tests");

	assert.ok(messages.some((message) => message.details?.kind === "activity-heartbeat"));
});

test("parseRunArgs prefers the longest configured pipeline name", () => {
	const parsed = parseRunArgs("demo full add tests", ["demo", "demo full"]);

	assert.deepEqual(parsed, {
		pipelineName: "demo full",
		prompt: "add tests",
	});
});

test("parseRunArgs supports multi-word pipeline titles", () => {
	const parsed = parseRunArgs("Demo Pipeline add tests", [
		"demo",
		"Demo Pipeline",
	]);

	assert.deepEqual(parsed, {
		pipelineName: "Demo Pipeline",
		prompt: "add tests",
	});
});

test("parseRunArgs falls back to first word as pipeline id", () => {
	const parsed = parseRunArgs("unknown add tests", ["demo"]);

	assert.deepEqual(parsed, {
		pipelineName: "unknown",
		prompt: "add tests",
	});
});

test("parseRunArgs rejects missing prompt", () => {
	assert.equal(parseRunArgs("", ["demo"]), null);
	assert.equal(parseRunArgs("demo", ["demo"]), null);
});

test("/pipeline run without a prompt reports usage", async () => {
	const notifications: string[] = [];
	const controller = {
		listPipelines: () => [{ id: "demo", title: "Demo Pipeline" }],
	} as unknown as PipelineController;

	await handlePipelineCommand(
		"run demo",
		commandContext(createTempWorkspace(), notifications),
		controller,
	);

	assert.match(notifications[0], /Usage: \/pipeline run/);
});

test("/pipeline approve forwards edited plan text", async () => {
	const notifications: string[] = [];
	let approvedPlan = "";
	const controller = {
		approve: async (_ctx: unknown, plan?: string) => {
			approvedPlan = plan ?? "";
			return "done";
		},
	} as unknown as PipelineController;

	await handlePipelineCommand(
		"approve edited plan",
		commandContext(createTempWorkspace(), notifications),
		controller,
	);

	assert.equal(approvedPlan, "edited plan");
	assert.match(notifications[0], /approved/);
});

test("/pipeline reject and cancel call controller actions", async () => {
	const notifications: string[] = [];
	const calls: string[] = [];
	const controller = {
		reject: () => calls.push("reject"),
		cancel: () => calls.push("cancel"),
	} as unknown as PipelineController;
	const ctx = commandContext(createTempWorkspace(), notifications);

	await handlePipelineCommand("reject", ctx, controller);
	await handlePipelineCommand("cancel", ctx, controller);

	assert.deepEqual(calls, ["reject", "cancel"]);
	assert.match(notifications.join("\n"), /rejected/);
	assert.match(notifications.join("\n"), /cancelled/);
});

test("PipelineController rejects approve, reject, and cancel without an active run", async () => {
	const workspace = createTempWorkspace();
	const controller = new PipelineController(
		workspace,
		{ sendMessage: () => {} } as any,
		{
			runner: { run: async () => "unused" },
		},
	);

	await assert.rejects(() => controller.approve(), /No pending pipeline plan/);
	assert.throws(() => controller.reject(), /No pending pipeline plan/);
	assert.throws(() => controller.cancel(), /No active pipeline run/);
});

test("PipelineController rejects blank pipeline prompts", async () => {
	const workspace = createTempWorkspace();
	const controller = new PipelineController(
		workspace,
		{ sendMessage: () => {} } as any,
		{
			runner: { run: async () => "unused" },
		},
	);

	await assert.rejects(
		() => controller.runPipeline("demo", "  "),
		/Pipeline prompt is required/,
	);
});

test("registerPipelineCommand registers completions and delegates handler", async () => {
	let commandRegistration:
		| {
				getArgumentCompletions: (prefix: string) => Array<{ value: string }>;
				handler: (args: string, ctx: unknown) => Promise<void>;
		  }
		| undefined;
	const controller = {
		formatPipelineList: () => "No ACP pipelines found.",
	} as unknown as PipelineController;
	const pi = {
		registerCommand: (name: string, registration: typeof commandRegistration) => {
			assert.equal(name, "pipeline");
			commandRegistration = registration;
		},
	};
	registerPipelineCommand(pi as any, controller);

	assert.deepEqual(commandRegistration?.getArgumentCompletions("ap"), [
		{ value: "approve", label: "approve" },
	]);
	assert.deepEqual(commandRegistration?.getArgumentCompletions("verb"), [
		{ value: "verbose", label: "verbose" },
	]);
	const notifications: string[] = [];
	await commandRegistration?.handler(
		"list",
		commandContext(createTempWorkspace(), notifications),
	);
	assert.equal(notifications[0], "No ACP pipelines found.");
});

test("registerRunPipelineTool returns awaiting approval details", async () => {
	let execute:
		| ((
				toolCallId: string,
				params: { pipelineName?: string; prompt: string },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
		  ) => Promise<{ content: Array<{ text: string }>; details: unknown }>)
		| undefined;
	const controller = {
		runPipeline: async (pipelineName: string, prompt: string) => ({
			sessionId: "session-1",
			plan: `${pipelineName}:${prompt}`,
			awaitingApproval: true,
		}),
	} as unknown as PipelineController;
	const pi = {
		registerTool: (registration: { execute: NonNullable<typeof execute> }) => {
			execute = registration.execute;
		},
	};
	registerRunPipelineTool(pi as any, controller);

	const result = await execute!(
		"tool-1",
		{ pipelineName: "demo", prompt: "add tests" },
		new AbortController().signal,
		undefined,
		{},
	);

	assert.match(result.content[0].text, /awaiting user approval/);
	assert.match(result.content[0].text, /demo:add tests/);
	assert.deepEqual(result.details, {
		sessionId: "session-1",
		plan: "demo:add tests",
		awaitingApproval: true,
	});
});

test("registerRunPipelineTool returns completed output details", async () => {
	let execute:
		| ((
				toolCallId: string,
				params: { pipelineName?: string; prompt: string },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
		  ) => Promise<{ content: Array<{ text: string }>; details: unknown }>)
		| undefined;
	const controller = {
		runPipeline: async (pipelineName: string, prompt: string) => ({
			sessionId: "session-1",
			output: `${pipelineName || "default"}:${prompt}`,
			awaitingApproval: false,
		}),
	} as unknown as PipelineController;
	const pi = {
		registerTool: (registration: { execute: NonNullable<typeof execute> }) => {
			execute = registration.execute;
		},
	};
	registerRunPipelineTool(pi as any, controller);

	const result = await execute!(
		"tool-1",
		{ prompt: "add tests" },
		new AbortController().signal,
		undefined,
		{},
	);

	assert.match(result.content[0].text, /Pipeline completed/);
	assert.match(result.content[0].text, /default:add tests/);
	assert.deepEqual(result.details, {
		sessionId: "session-1",
		output: "default:add tests",
		awaitingApproval: false,
	});
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

function mockConnectedAgent(
	input: {
		sessionUpdateHandler: { handleUpdate: (update: SessionNotification) => void };
	},
	overrides: {
		extMethod?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
	} = {},
) {
	return {
		agentId: "sandcastle_agent",
		connInfo: {
			initResponse: {},
			client: undefined,
			connection: {
				newSession: async () => ({ sessionId: "s1" }),
				prompt: async () => {
					input.sessionUpdateHandler.handleUpdate(textChunk("s1", "sandcastle output"));
					return { stopReason: "end_turn" };
				},
				cancel: async () => {},
				authenticate: async () => ({}),
				extMethod: overrides.extMethod ?? (async () => ({ success: true })),
			},
		} as any,
		dispose: () => {},
	};
}

function sandcastlePreview(filesChanged: number) {
	return {
		diff: filesChanged > 0 ? "diff --git a/file b/file" : "",
		filesChanged,
		branch: "sandcastle/acp/codex/test",
		baseRef: "HEAD",
		worktreePath: "/tmp/worktree",
	};
}

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
