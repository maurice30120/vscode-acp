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

test("PipelineRuntime pauses an interview question, records the answer, then produces a ready artifact for approval", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "interview",
    title: "Interview",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan {{userPrompt}}",
        interaction: { protocol: "proposed-plan", repairAttempts: 0 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
      {
        id: "approval",
        type: "pause",
        pause: "approval",
        content: "{{inputs.plan}}",
        format: "proposed-plan",
        needs: ["plan"],
        inputs: [{ name: "plan", from: "plan.plan", type: "acp.grill-decision/v1", format: "markdown" }],
        output: { name: "approved", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  const prompts: string[] = [];
  const runtime = new PipelineRuntime({
    async execute({ prompt }) {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedQuestion("Which API?") } };
      }
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedReady("Use the public API.") } };
    },
  }, { runIdFactory: () => "run-interview" });

  const first = await runtime.start(program, { inputs: { userPrompt: "ship" } });
  assert.equal(first.status, "paused");
  assert.equal(first.pause.type, "question");
  assert.equal(first.pause.content, "Which API?");
  assert.equal(first.snapshot.nodeStates.plan.status, "paused");
  assert.equal(first.snapshot.artifacts["plan.plan"], undefined);

  const approval = await runtime.resume(first.runId, {
    pauseId: first.pause.id,
    kind: "answer",
    value: "Use the public API",
  });

  assert.equal(approval.status, "paused");
  assert.equal(approval.pause.type, "approval");
  assert.match(approval.pause.content, /Use the public API\./);
  assert.match(prompts[1], /User:\nUse the public API/);
  assert.equal(approval.snapshot.activeInterview, undefined);
  assert.equal(approval.snapshot.artifacts["plan.plan"].value, proposedReady("Use the public API."));
});

test("PipelineRuntime completes an interview with complete-interview and rejects later question output", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "done",
    title: "Done",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan",
        interaction: { protocol: "proposed-plan", repairAttempts: 0 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  let call = 0;
  const runtime = new PipelineRuntime({
    async execute() {
      call += 1;
      return {
        artifact: {
          name: "plan",
          type: "acp.grill-decision/v1",
          format: "markdown",
          value: call === 1 ? proposedQuestion("Anything else?") : proposedReady("Final."),
        },
      };
    },
  }, { runIdFactory: () => "run-done" });

  const paused = await runtime.start(program);
  assert.equal(paused.status, "paused");

  const completed = await runtime.resume(paused.runId, {
    pauseId: paused.pause.id,
    kind: "complete-interview",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.artifact?.value, proposedReady("Final."));

  const badRuntime = new PipelineRuntime({
    async execute() {
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedQuestion("Nope?") } };
    },
  }, { runIdFactory: () => "run-bad-done" });
  const badPaused = await badRuntime.start(program);
  assert.equal(badPaused.status, "paused");
  const failed = await badRuntime.resume(badPaused.runId, {
    pauseId: badPaused.pause.id,
    kind: "complete-interview",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "malformed_interview_output");
});

test("PipelineRuntime restores a multi-turn interview from snapshot replay and rejects obsolete answers", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "restore-interview",
    title: "Restore Interview",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan {{userPrompt}}",
        interaction: { protocol: "proposed-plan", repairAttempts: 0 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  const store = new InMemoryPipelineRunStore();
  const firstRuntime = new PipelineRuntime({
    async execute() {
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedQuestion("First?") } };
    },
  }, { runIdFactory: () => "run-restore-interview", store });
  const first = await firstRuntime.start(program, { inputs: { userPrompt: "ship" } });
  assert.equal(first.status, "paused");
  const firstPauseId = first.pause.id;

  const prompts: string[] = [];
  let call = 0;
  const secondRuntime = new PipelineRuntime({
    async execute({ prompt }) {
      prompts.push(prompt);
      call += 1;
      return {
        artifact: {
          name: "plan",
          type: "acp.grill-decision/v1",
          format: "markdown",
          value: call === 1 ? proposedQuestion("Second?") : proposedReady("Done."),
        },
      };
    },
  }, { store, programs: [program] });

  const second = await secondRuntime.resume(first.runId, {
    pauseId: firstPauseId,
    kind: "answer",
    value: "first answer",
  });
  assert.equal(second.status, "paused");
  assert.notEqual(second.pause.id, firstPauseId);
  assert.match(prompts[0], /Agent:\n<proposed_plan>/);
  assert.match(prompts[0], /User:\nfirst answer/);

  const obsolete = await secondRuntime.resume(first.runId, {
    pauseId: firstPauseId,
    kind: "answer",
    value: "late",
  });
  assert.equal(obsolete.status, "failed");
  assert.equal(obsolete.error.code, "invalid_resume");
});

test("PipelineRuntime repairs one malformed interview output before failing explicitly", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "repair",
    title: "Repair",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan",
        interaction: { protocol: "proposed-plan", repairAttempts: 1 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  let call = 0;
  const prompts: string[] = [];
  const runtime = new PipelineRuntime({
    async execute({ prompt }) {
      prompts.push(prompt);
      call += 1;
      return {
        artifact: {
          name: "plan",
          type: "acp.grill-decision/v1",
          format: "markdown",
          value: call === 1 ? "not a plan" : proposedReady("Repaired."),
        },
      };
    },
  }, { runIdFactory: () => "run-repair" });

  const result = await runtime.start(program);

  assert.equal(result.status, "completed");
  assert.match(prompts[1], /Protocol error:/);
  assert.equal(result.artifact?.value, proposedReady("Repaired."));

  const failing = new PipelineRuntime({
    async execute() {
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: "still bad" } };
    },
  }, { runIdFactory: () => "run-repair-fails" });
  const failed = await failing.start(program);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "malformed_interview_output");
});

test("PipelineRuntime gives each interview turn its own repair budget", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "repair-each-turn",
    title: "Repair Each Turn",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan",
        interaction: { protocol: "proposed-plan", repairAttempts: 1 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  const outputs = [
    "bad first turn",
    proposedQuestion("First?"),
    "bad second turn",
    proposedReady("Done."),
  ];
  const runtime = new PipelineRuntime({
    async execute() {
      return {
        artifact: {
          name: "plan",
          type: "acp.grill-decision/v1",
          format: "markdown",
          value: outputs.shift(),
        },
      };
    },
  }, { runIdFactory: () => "run-repair-each-turn" });

  const paused = await runtime.start(program);
  assert.equal(paused.status, "paused");

  const completed = await runtime.resume(paused.runId, {
    pauseId: paused.pause.id,
    kind: "answer",
    value: "first answer",
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.artifact?.value, proposedReady("Done."));
});

test("PipelineRuntime serializes interview nodes while ordinary agents can still run", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "ordered-interviews",
    title: "Ordered Interviews",
    nodes: [
      {
        id: "ordinary",
        agent: "Codex",
        prompt: "ordinary",
        output: { name: "out", type: "note", format: "text" },
      },
      {
        id: "firstInterview",
        agent: "Codex",
        prompt: "first",
        interaction: { protocol: "proposed-plan", repairAttempts: 0 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
      {
        id: "secondInterview",
        agent: "Codex",
        prompt: "second",
        interaction: { protocol: "proposed-plan", repairAttempts: 0 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  const started: string[] = [];
  const runtime = new PipelineRuntime({
    async execute({ node }) {
      started.push(node.id);
      if (node.id === "ordinary") {
        return { artifact: { name: "out", type: "note", format: "text", value: "ok" } };
      }
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedQuestion(`${node.id}?`) } };
    },
  }, { runIdFactory: () => "run-ordered-interviews" });

  const result = await runtime.start(program);

  assert.equal(result.status, "paused");
  assert.equal(result.pause.nodeId, "firstInterview");
  assert.deepEqual(started.sort(), ["firstInterview", "ordinary"]);
  assert.equal(result.snapshot.nodeStates.secondInterview.status, "pending");
  assert.equal(result.snapshot.nodeStates.ordinary.status, "completed");
});

test("PipelineRuntime keeps technical retries independent from interview repairs", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "retry-interview",
    title: "Retry Interview",
    nodes: [
      {
        id: "plan",
        agent: "Codex",
        prompt: "Plan",
        retry: { maxAttempts: 2, backoffMs: 0 },
        interaction: { protocol: "proposed-plan", repairAttempts: 1 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  let call = 0;
  const runtime = new PipelineRuntime({
    async execute() {
      call += 1;
      if (call === 1) {
        return { code: "temporary", message: "temporary", retryable: true };
      }
      if (call === 2) {
        return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: "bad format" } };
      }
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedReady("Ok.") } };
    },
  }, { runIdFactory: () => "run-retry-interview" });

  const result = await runtime.start(program);

  assert.equal(result.status, "completed");
  assert.equal(call, 3);
  assert.equal(result.snapshot.nodeStates.plan.attempts, 2);
  assert.equal(result.snapshot.diagnostics.filter(item => item.code === "temporary").length, 1);
});

test("PipelineRuntime does not let an interview pause mask an ordinary node failure", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "interview-with-failure",
    title: "Interview With Failure",
    nodes: [
      {
        id: "ordinary",
        agent: "Codex",
        prompt: "ordinary",
        output: { name: "out", type: "note", format: "text" },
      },
      {
        id: "plan",
        agent: "Codex",
        prompt: "plan",
        interaction: { protocol: "proposed-plan", repairAttempts: 0 },
        output: { name: "plan", type: "acp.grill-decision/v1", format: "markdown" },
      },
    ],
  }, agents).program!;
  const runtime = new PipelineRuntime({
    async execute({ node }) {
      if (node.id === "ordinary") {
        return { code: "ordinary_failed", message: "ordinary failed" };
      }
      return { artifact: { name: "plan", type: "acp.grill-decision/v1", format: "markdown", value: proposedQuestion("Question?") } };
    },
  }, { runIdFactory: () => "run-interview-with-failure" });

  const result = await runtime.start(program);

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "ordinary_failed");
});

function proposedQuestion(question: string): string {
  return [
    "<proposed_plan>",
    "<interview_state>question</interview_state>",
    `<clarification_question>${question}</clarification_question>`,
    "</proposed_plan>",
  ].join("\n");
}

function proposedReady(body: string): string {
  return [
    "<proposed_plan>",
    "<interview_state>ready</interview_state>",
    body,
    "</proposed_plan>",
  ].join("\n");
}
