import * as assert from "node:assert/strict";
import { test } from "node:test";

import { compilePipelineV3Definition } from "../dist/index.js";

test("compilePipelineV3Definition accepts instructionsFile as the public role-file field", () => {
  const result = compilePipelineV3Definition({
    version: 3,
    id: "structured-prompt",
    title: "Structured Prompt",
    nodes: [{
      id: "plan",
      agent: "Codex",
      instructionsFile: "../agents/planner.md",
      prompt: "Plan {{userPrompt}}",
      output: { name: "plan", type: "acp.plan/v1", format: "markdown" },
    }],
  }, { Codex: {} });

  assert.deepEqual(result.errors, []);
  assert.equal(result.program?.nodes[0].prompt, "Plan {{userPrompt}}");
  assert.equal(result.program?.nodes[0].promptFile, "../agents/planner.md");
});
