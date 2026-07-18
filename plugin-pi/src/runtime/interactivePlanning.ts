import {
  extractClarificationQuestion,
  isProposedPlanAwaitingAnswer,
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
  return Boolean(controller.pendingPlan && isProposedPlanAwaitingAnswer(controller.pendingPlan.plan));
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
  if (!isProposedPlanAwaitingAnswer(controller.pendingPlan.plan)) {
    throw new Error('The planner interview is already complete. Review or approve the plan.');
  }

  const sessionId = controller.activeSessionId;
  controller.permissionContext = ctx;
  controller.startHeartbeat(sessionId);

  try {
    const plan = await controller.service.createPlan(sessionId, answer);
    return {
      plan,
      awaitingAnswer: isProposedPlanAwaitingAnswer(plan),
      question: extractClarificationQuestion(plan),
    };
  } finally {
    controller.permissionContext = undefined;
  }
};
