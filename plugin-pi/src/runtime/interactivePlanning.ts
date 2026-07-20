import {
  extractClarificationQuestion,
  type PipelinePlanReadyEvent,
  type PipelineService,
} from '@acp-client/pipeline';
import type { ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';

import { PipelineController } from './pipelineController.js';
import type { PiPermissionContext } from '../types.js';

export interface PipelineAnswerResult {
  plan: string;
  awaitingAnswer: boolean;
  question: string | null;
}

type InteractiveControllerInternals = {
  service: PipelineService;
  permissionContext: PiPermissionContext | undefined;
  pendingPlan: PipelinePlanReadyEvent | null;
  activeSessionId: string | null;
  startHeartbeat(sessionId: string): void;
};

declare module './pipelineController.js' {
  interface PipelineController {
    answer(
      answer: string,
      ctx?: ExtensionContext | ExtensionCommandContext,
    ): Promise<PipelineAnswerResult>;
    isAwaitingAnswer(): boolean;
  }
}

PipelineController.prototype.isAwaitingAnswer = function isAwaitingAnswer(): boolean {
  const controller = this as unknown as InteractiveControllerInternals;
  return controller.pendingPlan?.pauseType === 'question';
};

PipelineController.prototype.answer = async function answer(
  answerText: string,
  ctx?: ExtensionContext | ExtensionCommandContext,
): Promise<PipelineAnswerResult> {
  const controller = this as unknown as InteractiveControllerInternals;
  const answer = answerText.trim();
  if (!answer) {
    throw new Error('An answer is required.');
  }
  if (!controller.activeSessionId || !controller.pendingPlan) {
    throw new Error('No active planner interview.');
  }
  const pause = await controller.service.getPendingPause(controller.activeSessionId);
  if (pause?.type !== 'question') {
    throw new Error('The planner interview is already complete. Review or approve the plan.');
  }

  const sessionId = controller.activeSessionId;
  controller.permissionContext = ctx;
  controller.startHeartbeat(sessionId);

  try {
    const result = await controller.service.resumePipeline(sessionId, {
      pauseId: pause.id,
      kind: answer === '/done' ? 'complete-interview' : 'answer',
      ...(answer === '/done' ? {} : { value: answer }),
    });
    const plan = result.status === 'paused'
      ? result.pause.content
      : result.status === 'completed'
        ? String(result.artifact?.value ?? '')
        : '';
    return {
      plan,
      awaitingAnswer: result.status === 'paused' && result.pause.type === 'question',
      question: extractClarificationQuestion(plan),
    };
  } finally {
    controller.permissionContext = undefined;
  }
};
