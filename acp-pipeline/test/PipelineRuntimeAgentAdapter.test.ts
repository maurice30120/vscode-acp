import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  PipelineRuntime,
  PipelineRuntimeAgentAdapter,
  compilePipelineV3Definition,
  type PipelineAgentRunInput,
} from "../dist/index.js";

test("PipelineRuntimeAgentAdapter runs v3 nodes through a PipelineAgentRunner", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "adapter",
    title: "Adapter",
    nodes: [{
      id: "implement",
      agent: "Vibe Sandcastle",
      prompt: "Implement {{userPrompt}}",
      skills: ["implement", "tdd"],
      policy: {
        filesystem: "workspace-write",
        terminal: "workspace-write",
        network: "disabled",
        promotion: "ask",
      },
      output: { name: "result", type: "acp.implementation-result/v1", format: "markdown" },
    }],
  }, { "Vibe Sandcastle": {} }).program!;
  const calls: PipelineAgentRunInput[] = [];
  const adapter = new PipelineRuntimeAgentAdapter({
    workspaceCwd: () => "/workspace",
    runAgent: async input => {
      calls.push(input);
      return { text: "done" };
    },
  });

  const runtime = new PipelineRuntime(adapter, { runIdFactory: () => "run-adapter" });
  const result = await runtime.start(program, { inputs: { userPrompt: "the change" } });

  assert.equal(result.status, "completed");
  assert.equal(result.artifact?.value, "done");
  assert.deepEqual(calls, [{
    workspaceCwd: "/workspace",
    agentName: "Vibe Sandcastle",
    promptText: "Implement the change",
    signal: calls[0].signal,
    sideEffects: "workspace",
    permissions: "ask",
    skills: ["implement", "tdd"],
  }]);
});

test("PipelineRuntimeAgentAdapter converts runner failures to node diagnostics", async () => {
  const program = compilePipelineV3Definition({
    version: 3,
    id: "adapter-fail",
    title: "Adapter Fail",
    nodes: [{
      id: "verify",
      agent: "Codex",
      prompt: "Verify",
      output: { name: "report", type: "acp.verification-report/v1", format: "markdown" },
    }],
  }, { Codex: {} }).program!;
  const adapter = new PipelineRuntimeAgentAdapter({
    workspaceCwd: () => "/workspace",
    runAgent: async () => {
      throw new Error("boom");
    },
  });

  const runtime = new PipelineRuntime(adapter, { runIdFactory: () => "run-adapter-fail" });
  const result = await runtime.start(program);

  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "agent_failed");
  assert.match(result.error.message, /boom/);
});
