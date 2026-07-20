import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  PipelineService,
  compilePipelineV3Definition,
  type CompiledPipelineProgram,
  type PipelineAgentRunInput,
} from "../dist/index.js";

test("PipelineService runs a v3 program through PipelineRuntime with two approvals", async () => {
  const program = createTwoApprovalProgram();
  const calls: PipelineAgentRunInput[] = [];
  const service = new PipelineService(
    () => "/workspace",
    {
      getPipelinePrograms: () => [program],
      getPipelineProgramForAgent: name => name === program.title ? program : null,
      getAgentConfigs: () => ({ Codex: {}, "Vibe Sandcastle": {} }),
      runAgent: async input => {
        calls.push(input);
        if (input.agentName === "Codex") {
          return { text: "spec artifact" };
        }
        return { text: "implementation complete" };
      },
    },
  );
  const pauses: string[] = [];
  service.on("plan-ready", (event: any) => pauses.push(event.plan));

  try {
    const firstPause = await service.createPlan("session-v3", "ship it", program.title);
    assert.equal(firstPause, "Approve plan for ship it");
    assert.deepEqual(pauses, ["Approve plan for ship it"]);

    const secondPause = await service.approvePlan("session-v3", "approved plan");
    assert.equal(secondPause, "Approve delivery spec artifact");
    assert.deepEqual(pauses, [
      "Approve plan for ship it",
      "Approve delivery spec artifact",
    ]);

    const output = await service.approvePlan("session-v3", "approved delivery");
    assert.equal(output, "implementation complete");
    assert.deepEqual(calls.map(call => call.promptText), [
      "Write spec for approved plan",
      "Implement approved delivery",
    ]);
    assert.deepEqual(calls.map(call => call.agentName), ["Codex", "Vibe Sandcastle"]);
  } finally {
    await service.dispose();
  }
});

test("PipelineService cancel clears active v3 runtime sessions", async () => {
  const program = createTwoApprovalProgram();
  const service = new PipelineService(
    () => "/workspace",
    {
      getPipelinePrograms: () => [program],
      getPipelineProgramForAgent: name => name === program.title ? program : null,
      getAgentConfigs: () => ({ Codex: {}, "Vibe Sandcastle": {} }),
      runAgent: async () => ({ text: "spec artifact" }),
    },
  );

  try {
    await service.createPlan("session-v3-cancel", "ship it", program.title);
    service.cancel("session-v3-cancel");
    await assert.rejects(
      () => service.approvePlan("session-v3-cancel", "approved"),
      /No pending pipeline plan/,
    );
  } finally {
    await service.dispose();
  }
});

test("PipelineService projects v3 pause rejection as rejected", async () => {
  const program = createTwoApprovalProgram();
  const service = new PipelineService(
    () => "/workspace",
    {
      getPipelinePrograms: () => [program],
      getPipelineProgramForAgent: name => name === program.title ? program : null,
      getAgentConfigs: () => ({ Codex: {}, "Vibe Sandcastle": {} }),
      runAgent: async () => ({ text: "spec artifact" }),
    },
  );
  const statuses: string[] = [];
  service.on("status", (event: any) => statuses.push(event.status));

  try {
    await service.createPlan("session-v3-reject", "ship it", program.title);
    service.rejectPlan("session-v3-reject");
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(statuses.includes("rejected"));
    assert.ok(!statuses.includes("cancelled"));
  } finally {
    await service.dispose();
  }
});

function createTwoApprovalProgram(): CompiledPipelineProgram {
  return compilePipelineV3Definition({
    version: 3,
    id: "delivery",
    title: "Delivery",
    nodes: [
      {
        id: "plan_approval",
        type: "pause",
        pause: "approval",
        content: "Approve plan for {{userPrompt}}",
        output: { name: "approved", type: "acp.grill-decision/v1", format: "markdown" },
      },
      {
        id: "spec",
        agent: "Codex",
        prompt: "Write spec for {{inputs.plan}}",
        needs: ["plan_approval"],
        inputs: [{ name: "plan", from: "plan_approval.approved", type: "acp.grill-decision/v1", format: "markdown" }],
        output: { name: "spec", type: "acp.specification/v1", format: "markdown" },
      },
      {
        id: "delivery_approval",
        type: "pause",
        pause: "approval",
        content: "Approve delivery {{inputs.spec}}",
        needs: ["spec"],
        inputs: [{ name: "spec", from: "spec.spec", type: "acp.specification/v1", format: "markdown" }],
        output: { name: "approved", type: "acp.ticket-graph/v1", format: "markdown" },
      },
      {
        id: "implementation",
        agent: "Vibe Sandcastle",
        prompt: "Implement {{inputs.delivery}}",
        needs: ["delivery_approval"],
        inputs: [{ name: "delivery", from: "delivery_approval.approved", type: "acp.ticket-graph/v1", format: "markdown" }],
        policy: {
          filesystem: "workspace-write",
          terminal: "workspace-write",
          network: "disabled",
          promotion: "ask",
        },
        output: { name: "result", type: "acp.implementation-result/v1", format: "markdown" },
      },
    ],
  }, { Codex: {}, "Vibe Sandcastle": {} }).program!;
}
