import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  PipelineRuntime,
  compilePipelineV3Definition,
  InMemoryPipelineRunStore,
  NATIVE_ACP_BASELINE_CAPABILITIES,
  type PipelineRuntimeAdapter,
} from "../dist/index.js";

const agents = { Codex: {} };

test("PipelineRuntime completes a linear pipeline with strict inputs and final artifact", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "linear",
    title: "Linear",
    nodes: [
      {
        id: "first",
        agent: "Codex",
        prompt: "first",
        output: { name: "out", type: "text-note", format: "text" },
      },
      {
        id: "second",
        agent: "Codex",
        prompt: "second",
        needs: ["first"],
        inputs: [{ name: "first", from: "first.out", type: "text-note", format: "text" }],
        output: { name: "out", type: "text-note", format: "text" },
      },
    ],
  }, agents).program!;
  const adapter: PipelineRuntimeAdapter = {
    async execute({ node, inputs }) {
      return {
        artifact: {
          name: "out",
          type: "text-note",
          format: "text",
          value: node.id === "first" ? "one" : `two:${inputs.first.value}`,
        },
      };
    },
  };
  const runtime = new PipelineRuntime(adapter, { runIdFactory: () => "run-1" });

  const result = await runtime.start(program);

  assert.equal(result.status, "completed");
  assert.equal(result.artifact?.value, "two:one");
  assert.equal(result.snapshot.nodeStates.first.status, "completed");
  assert.equal(result.snapshot.nodeStates.second.status, "completed");
});

test("PipelineRuntime renders node prompts from start inputs and typed artifacts", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "render",
    title: "Render",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan {{userPrompt}}",
        output: { name: "out", type: "text-note", format: "text" },
      },
      {
        id: "implement",
        agent: "Codex",
        prompt: "Implement {{inputs.planText}} for {{userPrompt}}",
        needs: ["plan"],
        inputs: [{ name: "planText", from: "plan.out", type: "text-note", format: "text" }],
        output: { name: "out", type: "text-note", format: "text" },
      },
    ],
  }, agents).program!;
  const prompts: string[] = [];
  const adapter: PipelineRuntimeAdapter = {
    async execute({ node, prompt }) {
      prompts.push(prompt);
      return {
        artifact: {
          name: "out",
          type: "text-note",
          format: "text",
          value: node.id === "plan" ? "approved plan" : prompt,
        },
      };
    },
  };

  const runtime = new PipelineRuntime(adapter, { runIdFactory: () => "run-render" });
  const result = await runtime.start(program, { inputs: { userPrompt: "ship feature" } });

  assert.equal(result.status, "completed");
  assert.deepEqual(prompts, [
    "Plan ship feature",
    "Implement approved plan for ship feature",
  ]);
  assert.equal(result.snapshot.inputVariables?.userPrompt, "ship feature");
});

test("PipelineRuntime renders pause content from typed inputs", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "pause-render",
    title: "Pause Render",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan",
        output: { name: "out", type: "text-note", format: "markdown" },
      },
      {
        id: "approval",
        type: "pause",
        pause: "approval",
        content: "Approve {{inputs.planText}} for {{userPrompt}}",
        needs: ["plan"],
        inputs: [{ name: "planText", from: "plan.out", type: "text-note", format: "markdown" }],
        output: { name: "approved", type: "approval", format: "markdown" },
      },
    ],
  }, agents).program!;
  const adapter: PipelineRuntimeAdapter = {
    async execute() {
      return {
        artifact: {
          name: "out",
          type: "text-note",
          format: "markdown",
          value: "the plan",
        },
      };
    },
  };

  const runtime = new PipelineRuntime(adapter, { runIdFactory: () => "run-pause-render" });
  const result = await runtime.start(program, { inputs: { userPrompt: "ship feature" } });

  assert.equal(result.status, "paused");
  assert.equal(result.pause.content, "Approve the plan for ship feature");
});

test("PipelineRuntime supports multiple stable pauses and rejects obsolete resumes", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "pauses",
    title: "Pauses",
    nodes: [
      {
        id: "approvePlan",
        type: "pause",
        pause: "approval",
        content: "Approve?",
        format: "proposed-plan",
        output: { name: "decision", type: "approval", format: "text" },
      },
      {
        id: "question",
        type: "pause",
        pause: "question",
        content: "Question?",
        needs: ["approvePlan"],
        output: { name: "answer", type: "answer", format: "text" },
      },
      {
        id: "final",
        agent: "Codex",
        prompt: "final",
        needs: ["question"],
        inputs: [{ name: "answer", from: "question.answer", type: "answer", format: "text" }],
        output: { name: "out", type: "text-note", format: "text" },
      },
    ],
  }, agents).program!;
  const runtime = new PipelineRuntime({
    async execute({ inputs }) {
      return { artifact: { name: "out", type: "text-note", format: "text", value: inputs.answer.value } };
    },
  }, { runIdFactory: () => "run-paused" });

  const first = await runtime.start(program);
  assert.equal(first.status, "paused");
  assert.equal(first.pause.type, "approval");

  const second = await runtime.resume(first.runId, { pauseId: first.pause.id, kind: "approve", value: "yes" });
  assert.equal(second.status, "paused");
  assert.equal(second.pause.type, "question");

  const obsolete = await runtime.resume(first.runId, { pauseId: first.pause.id, kind: "answer", value: "old" });
  assert.equal(obsolete.status, "failed");
  assert.equal(obsolete.error.code, "invalid_resume");

  const final = await runtime.resume(second.runId, { pauseId: second.pause.id, kind: "answer", value: "42" });
  assert.equal(final.status, "completed");
  assert.equal(final.artifact?.value, "42");
});

test("PipelineRuntime resumes a persisted pause after runtime reconstruction", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "persisted",
    title: "Persisted",
    nodes: [
      {
        id: "question",
        type: "pause",
        pause: "question",
        content: "Question?",
        output: { name: "answer", type: "answer", format: "text" },
      },
      {
        id: "final",
        agent: "Codex",
        prompt: "final",
        needs: ["question"],
        inputs: [{ name: "answer", from: "question.answer", type: "answer", format: "text" }],
        output: { name: "out", type: "text-note", format: "text" },
      },
    ],
  }, agents).program!;
  const store = new InMemoryPipelineRunStore();
  const firstRuntime = new PipelineRuntime({
    async execute() {
      throw new Error("first runtime should not execute after pause");
    },
  }, { runIdFactory: () => "run-restored", store });
  const paused = await firstRuntime.start(program);
  assert.equal(paused.status, "paused");

  const restoredRuntime = new PipelineRuntime({
    async execute({ inputs }) {
      return { artifact: { name: "out", type: "text-note", format: "text", value: inputs.answer.value } };
    },
  }, { store, programs: [program] });

  const completed = await restoredRuntime.resume(paused.runId, {
    pauseId: paused.pause.id,
    kind: "answer",
    value: "restored",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.artifact?.value, "restored");
});

test("PipelineRuntime emits telemetry through options without EventEmitter surface", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "events",
    title: "Events",
    nodes: [
      {
        id: "only",
        agent: "Codex",
        prompt: "only",
        output: { name: "out", type: "note", format: "text" },
      },
    ],
  }, agents).program!;
  const events: string[] = [];
  const runtime = new PipelineRuntime({
    async execute() {
      return { artifact: { name: "out", type: "note", format: "text", value: "ok" } };
    },
  }, {
    runIdFactory: () => "run-events",
    onEvent: event => {
      events.push(event.type);
    },
  });

  await runtime.start(program);

  assert.deepEqual(events, ["run_started", "node_started", "node_completed", "completed"]);
  assert.equal(typeof (runtime as unknown as { on?: unknown }).on, "undefined");
});

test("PipelineRuntime runs ready nodes together and retries transient failures", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "parallel",
    title: "Parallel",
    nodes: [
      {
        id: "a",
        agent: "Codex",
        prompt: "A",
        retry: { maxAttempts: 2, backoffMs: 0 },
        output: { name: "out", type: "note", format: "text" },
      },
      {
        id: "b",
        agent: "Codex",
        prompt: "B",
        output: { name: "out", type: "note", format: "text" },
      },
      {
        id: "join",
        agent: "Codex",
        prompt: "J",
        needs: ["a", "b"],
        inputs: [
          { name: "a", from: "a.out", type: "note", format: "text" },
          { name: "b", from: "b.out", type: "note", format: "text" },
        ],
        output: { name: "out", type: "note", format: "text" },
      },
    ],
  }, agents).program!;
  const starts: string[] = [];
  let aAttempts = 0;
  const runtime = new PipelineRuntime({
    async execute({ node, inputs }) {
      starts.push(node.id);
      if (node.id === "a" && ++aAttempts === 1) {
        return { code: "temporary", message: "try again", retryable: true };
      }
      return {
        artifact: {
          name: "out",
          type: "note",
          format: "text",
          value: node.id === "join" ? `${inputs.a.value}${inputs.b.value}` : node.id,
        },
      };
    },
  }, { runIdFactory: () => "run-parallel" });

  const result = await runtime.start(program);

  assert.equal(result.status, "completed");
  assert.equal(result.artifact?.value, "ab");
  assert.deepEqual(starts.slice(0, 2).sort(), ["a", "b"]);
  assert.equal(result.snapshot.nodeStates.a.attempts, 2);
});

test("PipelineRuntime fail-fast result preserves diagnostics and cancels pending nodes", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "fail",
    title: "Fail",
    nodes: [
      {
        id: "failer",
        agent: "Codex",
        prompt: "fail",
        output: { name: "out", type: "note", format: "text" },
      },
      {
        id: "after",
        agent: "Codex",
        prompt: "after",
        needs: ["failer"],
        output: { name: "out", type: "note", format: "text" },
      },
    ],
  }, agents).program!;
  const store = new InMemoryPipelineRunStore();
  const runtime = new PipelineRuntime({
    async execute() {
      return { code: "boom", message: "failed", retryable: false };
    },
  }, { runIdFactory: () => "run-fail", store });

  const result = await runtime.start(program);

  assert.equal(result.status, "failed");
  assert.equal(result.error.nodeId, "failer");
  assert.equal(result.snapshot.nodeStates.after.status, "cancelled");
  assert.ok(await store.load("run-fail"));
  assert.equal((await store.readEvents("run-fail")).at(-1)?.type, "failed");
});

test("PipelineRuntime refuses unsupported adapter policies before sending prompts", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "policy",
    title: "Policy",
    nodes: [
      {
        id: "networked",
        agent: "Codex",
        prompt: "fetch",
        policy: { network: "enabled" },
        output: { name: "out", type: "note", format: "text" },
      },
    ],
  }, agents).program!;
  let executed = false;
  const runtime = new PipelineRuntime({
    async execute() {
      executed = true;
      return { artifact: { name: "out", type: "note", format: "text", value: "bad" } };
    },
  }, {
    runIdFactory: () => "run-policy",
    adapterName: "native ACP",
    adapterCapabilities: NATIVE_ACP_BASELINE_CAPABILITIES,
  });

  const result = await runtime.start(program);

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "unsupported_policy");
  assert.equal(executed, false);
});

test("PipelineRuntime refuses unresolved node skills before sending prompts", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "skills",
    title: "Skills",
    nodes: [
      {
        id: "withSkill",
        agent: "Codex",
        prompt: "use skill",
        skills: ["missing"],
        output: { name: "out", type: "note", format: "text" },
      },
    ],
  }, agents).program!;
  let executed = false;
  const runtime = new PipelineRuntime({
    async execute() {
      executed = true;
      return { artifact: { name: "out", type: "note", format: "text", value: "bad" } };
    },
  }, {
    runIdFactory: () => "run-skills",
    resolveNodeSkills: node => node.skills.includes("missing") ? ['Pipeline node references missing skill "missing".'] : [],
  });

  const result = await runtime.start(program);

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "skill_resolution_failed");
  assert.equal(executed, false);
});
