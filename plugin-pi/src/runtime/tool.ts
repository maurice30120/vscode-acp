import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import './interactivePlanning.js';
import type { PipelineController } from './pipelineController.js';

const RUN_PIPELINE_PARAMS = Type.Object({
  pipelineName: Type.Optional(Type.String({
    description: 'Pipeline id or title to run. If omitted, the first configured pipeline is used.',
  })),
  prompt: Type.String({
    description: 'User request to pass to the ACP pipeline.',
  }),
});

export function registerRunPipelineTool(pi: ExtensionAPI, controller: PipelineController): void {
  pi.registerTool({
    name: 'run_pipeline',
    label: 'Run ACP Pipeline',
    description: 'Run an ACP pipeline through the Pi ACP pipeline extension.',
    promptSnippet: 'Run a configured ACP pipeline when orchestration across external ACP agents is requested.',
    parameters: RUN_PIPELINE_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await controller.runPipeline(params.pipelineName ?? '', params.prompt, ctx);
      const text = controller.isAwaitingAnswer()
        ? `Planner interview is waiting for your answer. Use /pipeline answer <response>.\n\n${result.plan ?? ''}`
        : result.awaitingApproval
          ? `Pipeline plan is ready and awaiting user approval.\n\n${result.plan ?? ''}`
          : `Pipeline completed.\n\n${result.output ?? ''}`;
      return {
        content: [{ type: 'text', text }],
        details: result,
      };
    },
  });
}
