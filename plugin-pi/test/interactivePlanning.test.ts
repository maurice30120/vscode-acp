import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { handlePipelineCommand } from '../src/runtime/commands.js';
import type { PipelineController } from '../src/runtime/pipelineController.js';

function commandContext(notifications: string[]): any {
  return {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      notify: (message: string) => notifications.push(message),
      select: async () => undefined,
    },
  };
}

test('/pipeline answer forwards the response to the active planner interview', async () => {
  const notifications: string[] = [];
  let receivedAnswer = '';
  const controller = {
    answer: async (answer: string) => {
      receivedAnswer = answer;
      return {
        plan: '<proposed_plan><interview_state>question</interview_state></proposed_plan>',
        awaitingAnswer: true,
        question: 'Another question?',
      };
    },
  } as unknown as PipelineController;

  await handlePipelineCommand(
    'answer use a repository interface',
    commandContext(notifications),
    controller,
  );

  assert.equal(receivedAnswer, 'use a repository interface');
  assert.match(notifications[0] ?? '', /another question/i);
});

test('/pipeline answer reports when the final plan is ready', async () => {
  const notifications: string[] = [];
  const controller = {
    answer: async () => ({
      plan: '<proposed_plan><interview_state>ready</interview_state></proposed_plan>',
      awaitingAnswer: false,
      question: null,
    }),
  } as unknown as PipelineController;

  await handlePipelineCommand(
    'answer yes',
    commandContext(notifications),
    controller,
  );

  assert.match(notifications[0] ?? '', /interview completed/i);
  assert.match(notifications[0] ?? '', /approve/i);
});

test('/pipeline approve is blocked while the planner has a pending question', async () => {
  const notifications: string[] = [];
  let approved = false;
  const controller = {
    isAwaitingAnswer: () => true,
    approve: async () => {
      approved = true;
      return 'done';
    },
  } as unknown as PipelineController;

  await handlePipelineCommand(
    'approve',
    commandContext(notifications),
    controller,
  );

  assert.equal(approved, false);
  assert.match(notifications[0] ?? '', /not complete/i);
  assert.match(notifications[0] ?? '', /pipeline answer/i);
});
