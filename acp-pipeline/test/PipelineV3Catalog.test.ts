import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  compilePipelineV3Catalog,
  resolvePipelineV3PromptFiles,
} from "../dist/index.js";

test("compilePipelineV3Catalog refuses v2 without implicit conversion", () => {
  const result = compilePipelineV3Catalog(
    [{
      filePath: "/workspace/.acp/pipelines/legacy.yaml",
      definition: {
        version: 2,
        id: "legacy",
        title: "Legacy",
        primitives: {},
        steps: [],
      },
    }],
    {
      workspaceCwd: "/workspace",
      maxPromptFileBytes: 1024,
      agentConfigs: {},
    },
  );

  assert.equal(result.programs.length, 0);
  assert.match(result.errors[0]?.errors.join("\n") ?? "", /Unsupported ACP pipeline version 2/);
});

test("compilePipelineV3Catalog returns compiled v3 programs in deterministic file order", () => {
  const result = compilePipelineV3Catalog(
    [
      { filePath: "/workspace/.acp/pipelines/b.yaml", definition: createPipeline("b") },
      { filePath: "/workspace/.acp/pipelines/a.yaml", definition: createPipeline("a") },
    ],
    {
      workspaceCwd: "/workspace",
      maxPromptFileBytes: 1024,
      agentConfigs: { Codex: {} },
    },
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.programs.map(program => program.id), ["a", "b"]);
});

test("resolvePipelineV3PromptFiles composes file content before inline prompt", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-v3-catalog-"));
  const pipelinePath = path.join(workspace, ".acp", "pipelines", "plan.yaml");
  const promptPath = path.join(workspace, ".acp", "agents", "planner.md");
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.mkdirSync(path.dirname(pipelinePath), { recursive: true });
  fs.writeFileSync(promptPath, "From file.", "utf8");

  const result = resolvePipelineV3PromptFiles(
    {
      version: 3,
      id: "plan",
      title: "Plan",
      nodes: [{
        id: "plan",
        agent: "Codex",
        promptFile: "../agents/planner.md",
        prompt: "Inline.",
        output: { name: "plan", type: "acp.plan/v1", format: "markdown" },
      }],
    },
    {
      workspaceCwd: workspace,
      maxBytes: 1024,
      pipelineFilePath: pipelinePath,
    },
  );

  assert.deepEqual(result.errors, []);
  const definition = result.definition as { nodes: Array<{ prompt?: string; promptFile?: string }> };
  assert.equal(definition.nodes[0].prompt, "From file.\n\nInline.");
  assert.equal(definition.nodes[0].promptFile, undefined);
});

test("resolvePipelineV3PromptFiles rejects prompt paths outside ACP config root", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-v3-catalog-"));
  const pipelinePath = path.join(workspace, ".acp", "pipelines", "plan.yaml");
  fs.mkdirSync(path.dirname(pipelinePath), { recursive: true });

  const result = resolvePipelineV3PromptFiles(
    {
      version: 3,
      id: "plan",
      title: "Plan",
      nodes: [{
        id: "plan",
        agent: "Codex",
        promptFile: "../../outside.md",
        output: { name: "plan", type: "acp.plan/v1", format: "markdown" },
      }],
    },
    {
      workspaceCwd: workspace,
      maxBytes: 1024,
      pipelineFilePath: pipelinePath,
    },
  );

  assert.match(result.errors[0]?.error ?? "", /stay within/);
});

function createPipeline(id: string): unknown {
  return {
    version: 3,
    id,
    title: id.toUpperCase(),
    nodes: [{
      id: "plan",
      agent: "Codex",
      prompt: "{{userPrompt}}",
      output: { name: "plan", type: "acp.plan/v1", format: "markdown" },
    }],
  };
}
