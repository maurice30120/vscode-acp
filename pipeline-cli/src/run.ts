import {
  extractClarificationQuestion,
  getProposedPlanInterviewState,
  type PipelineDefinition,
} from '@acp-client/pipeline';

import type { CliPipelineHostLike, CliPipelineSnapshot } from './host.js';
import type { CliTerminal } from './terminal.js';

export interface InteractiveRunOptions {
  pipelineName: string;
  prompt: string;
  yes: boolean;
  json: boolean;
}

export interface InteractiveRunResult {
  status: 'completed' | 'rejected';
  sessionId: string;
  output?: string;
}

export function formatPipelineList(definitions: PipelineDefinition[], json: boolean): string {
  if (json) {
    return JSON.stringify(
      definitions.map(definition => ({ id: definition.id, title: definition.title })),
      null,
      2,
    );
  }
  if (definitions.length === 0) {
    return 'No ACP pipelines found.';
  }
  return definitions.map(definition => `${definition.id}\t${definition.title}`).join('\n');
}

export async function runPipelineInteractive(
  host: CliPipelineHostLike,
  terminal: CliTerminal,
  options: InteractiveRunOptions,
): Promise<InteractiveRunResult> {
  let snapshot = await host.start(options.pipelineName, options.prompt);

  while (snapshot.plan) {
    writePlan(terminal, snapshot.plan, options.json);
    const state = getProposedPlanInterviewState(snapshot.plan);
    if (state === 'question') {
      const question = extractClarificationQuestion(snapshot.plan);
      if (!question) {
        throw new Error('Planner returned interview_state=question without clarification_question.');
      }
      const answer = await terminal.ask(question);
      if (!answer) {
        throw new Error('A non-empty answer is required to continue the planner interview.');
      }
      snapshot = await host.answer(answer);
      continue;
    }

    const approved = options.yes || await terminal.confirm('Approve this decision-complete plan?');
    if (!approved) {
      host.reject();
      const result: InteractiveRunResult = {
        status: 'rejected',
        sessionId: snapshot.sessionId,
      };
      terminal.write(options.json ? JSON.stringify(result, null, 2) : 'Pipeline plan rejected.');
      return result;
    }

    const output = await host.approve();
    const result: InteractiveRunResult = {
      status: 'completed',
      sessionId: snapshot.sessionId,
      output,
    };
    terminal.write(options.json ? JSON.stringify(result, null, 2) : output || 'Pipeline completed.');
    return result;
  }

  return writeCompletedSnapshot(snapshot, terminal, options.json);
}

function writePlan(terminal: CliTerminal, plan: string, json: boolean): void {
  if (json) {
    terminal.writeError(plan);
  } else {
    terminal.write(plan);
  }
}

function writeCompletedSnapshot(
  snapshot: CliPipelineSnapshot,
  terminal: CliTerminal,
  json: boolean,
): InteractiveRunResult {
  const result: InteractiveRunResult = {
    status: 'completed',
    sessionId: snapshot.sessionId,
    output: snapshot.output,
  };
  terminal.write(json ? JSON.stringify(result, null, 2) : snapshot.output || 'Pipeline completed.');
  return result;
}
