import type {
  PipelineArtifact,
  PipelinePauseSnapshot,
  PipelineRuntimeResult,
} from '@acp-client/pipeline';

import type { CliRunCommand } from './args.js';
import type { CliPipelineHost, CliPipelineListEntry } from './host.js';
import type { CliTerminal } from './terminal.js';

export interface CliRunResult {
  status: 'completed' | 'cancelled' | 'failed';
  runId: string;
  artifact?: PipelineArtifact;
  error?: { code: string; message: string; nodeId?: string; attempt?: number };
}

export async function runPipelineInteractive(
  host: Pick<CliPipelineHost, 'start' | 'resume'>,
  terminal: CliTerminal,
  command: CliRunCommand,
): Promise<CliRunResult> {
  let result = await host.start(command.pipelineName, command.prompt);

  while (result.status === 'paused') {
    const pause = result.pause;
    if (!command.json) {
      terminal.write(formatPause(pause));
    }

    if (pause.type === 'question') {
      const answer = await askForAnswer(terminal);
      result = await host.resume(result.runId, {
        pauseId: pause.id,
        ...(answer === '/done'
          ? { kind: 'complete-interview' as const }
          : { kind: 'answer' as const, value: answer }),
      });
      continue;
    }

    const approved = pause.type === 'approval' && command.yes
      ? true
      : await terminal.confirm(
        pause.type === 'promotion' ? 'Approve pipeline promotion?' : 'Approve pipeline pause?',
        pause.type === 'promotion'
          ? 'This decision may apply isolated workspace changes.'
          : undefined,
      );

    result = await host.resume(result.runId, approved
      ? { pauseId: pause.id, kind: 'approve', value: pause.content }
      : { pauseId: pause.id, kind: 'reject' });
  }

  const final = normalizeResult(result);
  if (command.json) {
    terminal.write(JSON.stringify(final, null, 2));
  } else if (final.status === 'completed') {
    const output = stringifyArtifact(final.artifact);
    if (output) {
      terminal.write(output);
    }
  } else if (final.status === 'failed') {
    terminal.writeError(formatFailure(final.error));
  } else {
    terminal.writeError('Pipeline cancelled.');
  }
  return final;
}

export function formatPipelineList(entries: CliPipelineListEntry[], json: boolean): string {
  if (json) {
    return JSON.stringify(entries, null, 2);
  }
  if (entries.length === 0) {
    return 'No valid ACP version 3 pipelines found in .acp/pipelines.';
  }
  return entries.map(entry => `- ${entry.id} — ${entry.title} (${entry.nodeCount} nodes)`).join('\n');
}

function normalizeResult(result: PipelineRuntimeResult): CliRunResult {
  if (result.status === 'completed') {
    return { status: 'completed', runId: result.runId, artifact: result.artifact };
  }
  if (result.status === 'failed') {
    return {
      status: 'failed',
      runId: result.runId,
      error: {
        code: result.error.code,
        message: result.error.message,
        nodeId: result.error.nodeId,
        attempt: result.error.attempt,
      },
    };
  }
  return { status: 'cancelled', runId: result.runId };
}

function formatFailure(error: CliRunResult['error']): string {
  const code = error?.code ?? 'unknown';
  const location = error?.nodeId ? ` at node "${error.nodeId}"` : '';
  const attempt = error?.attempt !== undefined ? ` attempt ${error.attempt}` : '';
  const message = error?.message ?? 'Unknown error';
  return `Pipeline failed [${code}]${location}${attempt}: ${message}`;
}

function formatPause(pause: PipelinePauseSnapshot): string {
  const title = pause.type === 'question'
    ? 'Pipeline question'
    : pause.type === 'promotion'
      ? 'Pipeline promotion'
      : 'Pipeline approval';
  const recommendation = pause.type === 'question' && pause.recommendation
    ? `\n\nRecommended answer\n\n${pause.recommendation}`
    : '';
  return `\n## ${title}\n\n${pause.content}${recommendation}\n`;
}

async function askForAnswer(terminal: CliTerminal): Promise<string> {
  while (true) {
    const answer = await terminal.ask('Answer [/done to finish]:');
    if (answer) {
      return answer;
    }
    terminal.writeError('An answer is required to resume this pipeline question.');
  }
}

function stringifyArtifact(artifact: PipelineArtifact | undefined): string {
  if (!artifact || artifact.value === undefined || artifact.value === null) {
    return '';
  }
  if (typeof artifact.value === 'string') {
    return artifact.value;
  }
  return JSON.stringify(artifact.value, null, 2);
}
