import * as assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

import {
	PipelineService,
	compilePipelineV3Definition,
	type AgentNodeSessionFactory,
	type AgentNodeSessionTurnInput,
	type PipelineAgentRunner,
} from "@acp-client/pipeline";
import type { SessionNotification } from "@agentclientprotocol/sdk";

import { EphemeralAcpRunner } from "../src/acp/ephemeralRunner.js";
import {
	AgentProcessDiedError,
	PipelineTimeoutError,
} from "../src/acp/operationGuards.js";
import { RunAbortedError } from "../src/acp/runAbortedError.js";
import {
	handlePipelineCommand,
	parseRunArgs,
	registerPipelineCommand,
} from "../src/runtime/commands.js";
import acpPipelinePiExtension from "../src/index.js";
import { PipelineController } from "../src/runtime/pipelineController.js";
import { registerRunPipelineTool } from "../src/runtime/tool.js";
import {
	createTempWorkspace,
	writeFile,
	writeDefaultConfig,
	writeDemoPipeline,
	writePlanExecuteVerifyPipeline,
	writeSkill,
} from "./helpers.js";

test("mocked ACP runner collects agent_message_chunk text", async () => {
	const workspace = createTempWorkspace();
	let capturedPermissions: string | undefined;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async (input) => {
			capturedPermissions = input.permissions;
			return {
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
			};
		},
	});

	const result = await runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "prompt",
		permissions: "allowAll",
	});

	assert.equal(result.text, "hello world");
	assert.equal(capturedPermissions, "allowAll");
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

test("EphemeralAcpRunner lets node promotion policy override Sandcastle catalog promotion", async () => {
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
		getSandcastlePromotion: () => "ask",
		requestSandcastlePromotion: async () => {
			throw new Error("promotion UI should not be requested");
		},
		sandcastleConnector: async (input) => mockConnectedAgent(input, {
			extMethod: async (method) => {
				calls.push(method);
				if (method === "sandcastle/preview") {
					return sandcastlePreview(1);
				}
				if (method === "sandcastle/apply") {
					return { success: true, filesChanged: 1 };
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
		promotion: "auto-apply",
	});

	assert.equal(result.promotion, "applied");
	assert.deepEqual(calls, ["sandcastle/preview", "sandcastle/apply"]);
});

test("EphemeralAcpRunner maps Sandcastle no changes to no_changes", async () => {
	const workspace = createTempWorkspace();
	const calls: string[] = [];
	const statuses: string[] = [];
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
		onStatus: event => statuses.push(event.message ?? ""),
	});

	assert.equal(result.promotion, "no_changes");
	assert.deepEqual(calls, ["sandcastle/preview", "sandcastle/reject"]);
	assert.deepEqual(statuses, ["Sandcastle run produced no text, no tool calls, and no file diff."]);
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

test("EphemeralAcpRunner times out an unresponsive prompt and disposes the process", async () => {
	const workspace = createTempWorkspace();
	let disposed = false;
	let cancelCalled = false;
	let resolvePrompt!: (value: { stopReason: "end_turn" }) => void;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		timeouts: { promptMs: 5 },
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async () =>
						new Promise<{ stopReason: "end_turn" }>(resolve => {
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

	await assert.rejects(
		() =>
			runner.runAgent({
				workspaceCwd: workspace,
				agentName: "Codex CLI",
				promptText: "prompt",
			}),
		PipelineTimeoutError,
	);
	resolvePrompt({ stopReason: "end_turn" });
	assert.equal(cancelCalled, true);
	assert.equal(disposed, true);
});

test("EphemeralAcpRunner times out an unresponsive newSession", async () => {
	const workspace = createTempWorkspace();
	let disposed = false;
	let resolveNewSession!: (value: { sessionId: string }) => void;
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		timeouts: { newSessionMs: 5 },
		connector: async () => ({
			agentId: "agent_1",
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () =>
						new Promise<{ sessionId: string }>(resolve => {
							resolveNewSession = resolve;
						}),
					prompt: async () => ({ stopReason: "end_turn" }),
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
		PipelineTimeoutError,
	);
	resolveNewSession({ sessionId: "s1" });
	assert.equal(disposed, true);
});

test("EphemeralAcpRunner rejects when the process dies during prompt", async () => {
	const workspace = createTempWorkspace();
	let processDied!: (exit: { agentId: string; code: number; signal: null }) => void;
	let resolvePrompt!: (value: { stopReason: "end_turn" }) => void;
	const processExit = new Promise<any>(resolve => {
		processDied = resolve;
	});
	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({ "Codex CLI": { command: "codex" } }),
		connector: async () => ({
			agentId: "agent_1",
			processExit,
			connInfo: {
				initResponse: {},
				client: undefined,
				connection: {
					newSession: async () => ({ sessionId: "s1" }),
					prompt: async () =>
						new Promise<{ stopReason: "end_turn" }>(resolve => {
							resolvePrompt = resolve;
						}),
					cancel: async () => {},
					authenticate: async () => ({}),
				},
			} as any,
			dispose: () => {},
		}),
	});

	const promise = runner.runAgent({
		workspaceCwd: workspace,
		agentName: "Codex CLI",
		promptText: "prompt",
	});
	await setImmediate();
	processDied({ agentId: "agent_1", code: 1, signal: null });

	await assert.rejects(promise, AgentProcessDiedError);
	resolvePrompt({ stopReason: "end_turn" });
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
	const workspace = createConfiguredPipelineWorkspace();

	const notifications: string[] = [];
	const controller = new PipelineController(
		workspace,
		{ sendMessage: () => {} } as any,
		{
			createSession: createSessionFromRunner(async () => "<proposed_plan>unused</proposed_plan>"),
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
	const workspace = createConfiguredPipelineWorkspace();

	const notifications: string[] = [];
	const messages: Array<{ content: unknown; details?: unknown }> = [];
	const calls: string[] = [];
	const runner: PipelineAgentRunner = async (input) => {
		calls.push(input.agentName);
		if (input.agentName === "Pi Agent") {
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
			createSession: createSessionFromRunner(runner),
		},
	);
	const ctx = commandContext(workspace, notifications);

	await handlePipelineCommand("run plan-execute-verify add tests", ctx, controller);
	await handlePipelineCommand("approve", ctx, controller);

	assert.deepEqual(calls, ["Pi Agent", "Vibe Sandcastle", "Vibe"]);
	assert.match(notifications.join("\n"), /plan ready/i);
	assert.ok(messages.length >= 2);
	assert.ok(messages.some((message) => String(message.content).includes("ACP Pipeline Plan")));
	assert.ok(messages.some((message) => String(message.content).includes("implementation done")));
});

test("PipelineService emits approval pause status for a v3 Sandcastle implementer pipeline", async () => {
	const workspace = createTempWorkspace();
	const statuses: string[] = [];
	const program = compilePipelineV3Definition({
		version: 3 as const,
		id: "sandcastle-plan",
		title: "Sandcastle Plan",
		nodes: [
			{
				id: "approval",
				type: "pause" as const,
				pause: "approval" as const,
				content: "<proposed_plan>Use Sandcastle.</proposed_plan>",
				output: { name: "approved", type: "acp.approval/v1", format: "markdown" as const },
			},
			{
				id: "implement",
				agent: "Codex Sandcastle",
				prompt: "Implement {{inputs.plan}}",
				needs: ["approval"],
				inputs: [{ name: "plan", from: "approval.approved", type: "acp.approval/v1", format: "markdown" as const }],
				policy: {
					filesystem: "workspace-write" as const,
					terminal: "workspace-write" as const,
					promotion: "ask" as const,
				},
				output: { name: "result", type: "acp.implementation-result/v1", format: "markdown" as const },
			},
		],
	}, {
		"Codex Sandcastle": {
			transport: "sandcastle",
			provider: "codex",
			model: "gpt-5",
		},
	}).program!;
	const service = new PipelineService(
		() => workspace,
		{
			getPipelinePrograms: () => [program],
			getPipelineProgramForAgent: agentName =>
				agentName === program.id ? program : null,
			getAgentConfigs: () => ({
				"Codex Sandcastle": {
					transport: "sandcastle",
					provider: "codex",
					model: "gpt-5",
				},
			}),
			isAgentSandcastle: (agentName, configs) =>
				(configs[agentName] as { transport?: string } | undefined)?.transport === "sandcastle",
			createSession: createSessionFromRunner(async () => "implementation done"),
		},
	);
	service.on("status", event => {
		if (event.status === "awaiting_approval") {
			statuses.push(event.message);
		}
	});

	await service.createPlan("session-1", "add feature", "sandcastle-plan");

	assert.ok(statuses.includes("Pipeline paused for approval."));
	await service.dispose();
});

test("/pipeline verbose toggles runtime verbose mode", async () => {
	const notifications: string[] = [];
	const controller = new PipelineController(
		createTempWorkspace(),
		{ sendMessage: () => {} } as any,
		{
			createSession: createSessionFromRunner(async () => "unused"),
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

test("PipelineController activity relays agent message chunks", async () => {
	const workspace = createConfiguredPipelineWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.(textChunk("s1", "generated chunk"));
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
			createSession: createSessionFromRunner(runner),
		},
	);

	await controller.runPipeline("plan-execute-verify", "add tests");

	assert.ok(messages.some((message) => message.details?.kind === "activity-status"));
	assert.ok(messages.some((message) => String(message.content).includes("generated chunk")));
	assert.ok(messages.some((message) => /^Phase: \S+/m.test(String(message.content))));
});

test("PipelineController groups adjacent agent message chunks", async () => {
	const workspace = createConfiguredPipelineWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.(textChunk("s1", "gen"));
		input.onSessionUpdate?.(textChunk("s1", "erated"));
		input.onSessionUpdate?.(textChunk("s1", " chunk"));
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
			createSession: createSessionFromRunner(runner),
		},
	);

	await controller.runPipeline("plan-execute-verify", "add tests");

	const outputMessages = messages.filter((message) => message.details?.kind === "activity-status");
	assert.ok(outputMessages.some((message) => String(message.content).includes("generated chunk")));
});

test("PipelineController activity relays agent thought chunks", async () => {
	const workspace = createConfiguredPipelineWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.(thoughtChunk("s1", "thinking chunk"));
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
			createSession: createSessionFromRunner(runner),
		},
	);

	await controller.runPipeline("plan-execute-verify", "add tests");
	assert.ok(messages.some((message) => String(message.content).includes("thinking chunk")));
});

test("PipelineController verbose activity still reports non-text session updates", async () => {
	const workspace = createConfiguredPipelineWorkspace();

	const messages: Array<{ content: unknown; details?: { kind?: string } }> = [];
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.({
			sessionId: "s1",
			update: {
				sessionUpdate: "tool_call",
				rawInput: {},
				status: "pending",
				toolCallId: "tool-1",
				title: "Tool",
				kind: "read",
				content: [],
			},
		} as SessionNotification);
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
				createSession: createSessionFromRunner(runner),
			},
	);
	controller.setVerbose(true);

	await controller.runPipeline("plan-execute-verify", "add tests");

	assert.ok(messages.some((message) => message.details?.kind === "verbose-status"));
	assert.ok(messages.some((message) => String(message.content).includes("tool_call")));
});

test("PipelineController keeps heartbeat internal during long-running activity", async () => {
	const workspace = createConfiguredPipelineWorkspace();

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
			createSession: createSessionFromRunner(runner),
			heartbeatIntervalMs: 5,
		},
	);

	await controller.runPipeline("plan-execute-verify", "add tests");

	assert.ok(!messages.some((message) => message.details?.kind === "activity-heartbeat"));
	assert.ok(messages.some((message) => message.details?.kind === "activity-status"));
});

test("PipelineController status reports agent update counters without duplicating chunk text", async () => {
	const workspace = createConfiguredPipelineWorkspace();

	const messages: Array<{
		content: unknown;
		details?: {
			kind?: string;
			sessionUpdateCount?: number;
			agentTextChunkCount?: number;
			agentThoughtChunkCount?: number;
		};
	}> = [];
	let finishRun: (() => void) | undefined;
	const runner: PipelineAgentRunner = async (input) => {
		input.onSessionUpdate?.(textChunk("s1", "hidden chunk"));
		await new Promise<void>((resolve) => {
			finishRun = resolve;
		});
		return "<proposed_plan>Implement the feature.</proposed_plan>";
	};
	const controller = new PipelineController(
		workspace,
		{
			sendMessage: (message: {
				content: unknown;
				details?: {
					kind?: string;
					sessionUpdateCount?: number;
					agentTextChunkCount?: number;
					agentThoughtChunkCount?: number;
				};
			}) => {
				messages.push(message);
			},
		} as any,
			{
				createSession: createSessionFromRunner(runner),
				heartbeatIntervalMs: 5,
			},
	);

	const run = controller.runPipeline("plan-execute-verify", "add tests");
	let snapshot = "";
	for (let attempts = 0; attempts < 50; attempts += 1) {
		snapshot = controller.formatActivitySnapshot();
		if (snapshot.includes("Agent updates received: 0")) {
			break;
		}
		await setImmediate();
	}
	finishRun?.();
	await run;

	assert.ok(!messages.some((message) => message.details?.kind === "activity-heartbeat"));
	assert.match(snapshot, /Agent updates received: 0/);
	assert.match(snapshot, /Agent text chunks received: 0/);
	assert.match(snapshot, /Agent thought chunks received: 0/);
	assert.match(snapshot, /Agent threads:/);
	assert.match(snapshot, /Pi Agent:/);
	assert.ok(!snapshot.includes("hidden chunk"));
	assert.ok(messages.some((message) => String(message.content).includes("hidden chunk")));
});

test("/pipeline status reports active pipeline diagnostics", async () => {
	const notifications: string[] = [];
	const controller = {
		formatActivitySnapshot: () => [
			"Active pipeline session: session-1",
			"Current activity: implement (Vibe)",
			"Agent updates received: 0",
			"Agent thought chunks received: 0",
			"Last agent update: none yet",
		].join("\n"),
	} as unknown as PipelineController;

	await handlePipelineCommand(
		"status",
		commandContext(createTempWorkspace(), notifications),
		controller,
	);

	assert.match(notifications[0], /implement \(Vibe\)/);
	assert.match(notifications[0], /Agent updates received: 0/);
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
			createSession: createSessionFromRunner(async () => "unused"),
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
			createSession: createSessionFromRunner(async () => "unused"),
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

function createSessionFromRunner(runner: PipelineAgentRunner): AgentNodeSessionFactory {
	return async ({ runId, node }) => {
		let activityHandler: ((activity: { kind: "message" | "thought" | "status"; content: string }) => void) | undefined;
		return {
		runId,
		nodeId: node.id,
		onActivity(handler) {
			activityHandler = handler;
			return () => {
				activityHandler = undefined;
			};
		},
		async send(input: AgentNodeSessionTurnInput) {
			const text = await runner({
				workspaceCwd: input.node.prompt ?? "",
				agentName: input.node.agent ?? "",
				promptText: input.prompt,
				signal: input.signal,
				skills: [...input.node.skills],
				onSessionUpdate: update => {
					const data = update.update;
					if (data.sessionUpdate === "agent_message_chunk" && data.content.type === "text") {
						activityHandler?.({ kind: "message", content: data.content.text });
					} else if (data.sessionUpdate === "agent_thought_chunk" && data.content.type === "text") {
						activityHandler?.({ kind: "thought", content: data.content.text });
					} else {
						activityHandler?.({ kind: "status", content: data.sessionUpdate });
					}
				},
			});
			return {
				artifact: {
					name: input.node.output!.name,
					type: input.node.output!.type,
					format: input.node.output!.format,
					value: typeof text === "string" ? text : text.text,
				},
			};
		},
		async cancel() {},
		async close() {},
		};
	};
}

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

test("extension keeps one PipelineController per cwd across session_start events", async () => {
	const originalDispose = PipelineController.prototype.dispose;
	const disposed: string[] = [];
	const handlers = new Map<string, (event: unknown, ctx: { cwd: string }) => unknown>();

	PipelineController.prototype.dispose = function patchedDispose(this: PipelineController) {
		disposed.push((this as any).workspaceCwd);
		return Promise.resolve();
	};

	try {
		acpPipelinePiExtension({
			on: (event: string, handler: (event: unknown, ctx: { cwd: string }) => unknown) => {
				handlers.set(event, handler);
			},
			registerCommand: () => {},
			registerTool: () => {},
			sendMessage: () => {},
		} as any);

		const workspaceA = createTempWorkspace();
		const workspaceB = createTempWorkspace();
		handlers.get("session_start")?.({}, { cwd: workspaceA });
		handlers.get("session_start")?.({}, { cwd: workspaceB });

		assert.deepEqual(disposed, []);

		await handlers.get("session_shutdown")?.({}, { cwd: workspaceA });
		assert.deepEqual(disposed.sort(), [workspaceA, workspaceB].sort());
	} finally {
		PipelineController.prototype.dispose = originalDispose;
	}
});

test("EphemeralAcpRunner prefixes the prompt with explicit pipeline skills", async () => {
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

	assert.ok(sentPrompt.includes('<skill name="tdd">'), sentPrompt);
	assert.ok(sentPrompt.includes("Test-driven development."), sentPrompt);
	assert.ok(sentPrompt.endsWith("Do the work."), sentPrompt);
});

test("EphemeralAcpRunner rejects declared skills when agents.<name>.skills is false", async () => {
	const workspace = createTempWorkspace();
	writeSkill(workspace, "tdd", {
		name: "tdd",
		description: "Test-driven development.",
	});

	const runner = new EphemeralAcpRunner(workspace, {
		getAgentConfigs: () => ({
			"Codex CLI": { command: "codex", skills: false },
		}),
		connector: async () => {
			throw new Error("connector should not run");
		},
	});

	await assert.rejects(
		runner.runAgent({
			workspaceCwd: workspace,
			agentName: "Codex CLI",
			promptText: "Do the work.",
			skills: ["tdd"],
		}),
		/skills disabled/,
	);
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

function thoughtChunk(sessionId: string, text: string): SessionNotification {
	return {
		sessionId,
		update: {
			sessionUpdate: "agent_thought_chunk",
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

function createConfiguredPipelineWorkspace(): string {
	const workspace = createTempWorkspace();
	writeDefaultConfig(workspace);
	writeFile(
		workspace,
		".acp/acp-agents.json",
		JSON.stringify(
			{
				agents: {
					"Codex CLI": { command: "codex", args: [], env: {} },
					"Pi Agent": { command: "pi-acp", args: [], env: {} },
					Vibe: { command: "vibe", args: [], env: {} },
				},
				pipeline: {
					enabled: true,
					instructionsMaxBytes: 262144,
				},
			},
			null,
			2,
		),
	);
	writeFile(
		workspace,
		".acp/.sandcastle/config.json",
		JSON.stringify(
			{
				promotion: "ask",
				agents: {
					"Vibe Sandcastle": {
						transport: "sandcastle",
						provider: "vibe",
						model: "mistral-large-latest",
					},
				},
			},
			null,
			2,
		),
	);
	writePlanExecuteVerifyPipeline(workspace);
	return workspace;
}
