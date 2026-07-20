import {
  mapPolicyToLegacyPermissions,
  mapPolicyToLegacySideEffects,
} from "./PipelinePolicy";
import type { PipelineAgentRunner } from "./PipelineExecutor";
import type {
  PipelineNodeExecutionInput,
  PipelineNodeExecutionResult,
  PipelineRuntimeAdapter,
} from "./PipelineV3Types";
import { resolvePipelineStepText } from "./PipelineStepCompletion";

export interface PipelineRuntimeAgentAdapterOptions {
  workspaceCwd: () => string;
  runAgent: PipelineAgentRunner;
}

export class PipelineRuntimeAgentAdapter implements PipelineRuntimeAdapter {
  constructor(private readonly options: PipelineRuntimeAgentAdapterOptions) {}

  async execute(input: PipelineNodeExecutionInput): Promise<PipelineNodeExecutionResult> {
    const node = input.node;
    if (!node.agent) {
      return {
        code: "missing_agent",
        message: `Node "${node.id}" does not declare an ACP agent.`,
      };
    }
    if (!node.output) {
      return {
        code: "missing_output",
        message: `Node "${node.id}" does not declare an output artifact.`,
      };
    }

    try {
      const result = await this.options.runAgent({
        workspaceCwd: this.options.workspaceCwd(),
        agentName: node.agent,
        promptText: input.prompt,
        signal: input.signal,
        sideEffects: mapPolicyToLegacySideEffects(node.policy),
        permissions: mapPolicyToLegacyPermissions(node.policy),
        skills: [...node.skills],
      });
      return {
        artifact: {
          name: node.output.name,
          type: node.output.type,
          format: node.output.format,
          value: resolvePipelineStepText(result),
        },
      };
    } catch (e: unknown) {
      return {
        code: "agent_failed",
        message: e instanceof Error && e.message ? e.message : String(e),
        retryable: false,
      };
    }
  }
}
