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
  error?: { code: string; message: string };
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
        kind: 'answer',
        value: answer,
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
    terminal.writeError(`Pipeline failed [${final.error?.code ?? 'unknown'}]: ${final.error?.message ?? 'Unknown error'}`);
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
      error: { code: result.error.code, message: result.error.message },
    };
  }
  return { status: 'cancelled', runId: result.runId };
}

function formatPause(pause: PipelinePauseSnapshot): string {
  const title = pause.type === 'question'
    ? 'Pipeline question'
    : pause.type === 'promotion'
      ? 'Pipeline promotion'
      : 'Pipeline approval';
  return `\n## ${title}\n\n${pause.content}\n`;
}

async function askForAnswer(terminal: CliTerminal): Promise<string> {
  while (true) {
    const answer = await terminal.ask('Answer:');
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
