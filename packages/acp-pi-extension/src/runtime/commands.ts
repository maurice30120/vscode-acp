import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

import type { PipelineController } from './pipelineController.js';

export function registerPipelineCommand(pi: ExtensionAPI, controller: PipelineController): void {
  pi.registerCommand('pipeline', {
    description: 'List, run, approve, reject, or cancel ACP pipelines',
    getArgumentCompletions: (prefix) => {
      const words = ['list', 'run', 'approve', 'reject', 'cancel'];
      const matches = words.filter(word => word.startsWith(prefix.trim()));
      return matches.map(value => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      await handlePipelineCommand(args, ctx, controller);
    },
  });
}

export async function handlePipelineCommand(
  args: string,
  ctx: ExtensionCommandContext,
  controller: PipelineController,
): Promise<void> {
  const trimmed = args.trim();
  const [command, rest] = splitFirstWord(trimmed);

  switch (command) {
    case '':
    case 'list': {
      const list = controller.formatPipelineList();
      ctx.ui.notify(list, 'info');
      return;
    }
    case 'run': {
      const parsed = parseRunArgs(rest, controller.listPipelines().map(definition => definition.title));
      if (!parsed) {
        ctx.ui.notify('Usage: /pipeline run <pipelineName> <prompt>', 'warning');
        return;
      }
      const result = await controller.runPipeline(parsed.pipelineName, parsed.prompt, ctx);
      if (result.awaitingApproval) {
        ctx.ui.notify('Pipeline plan ready. Use /pipeline approve or /pipeline reject.', 'info');
      } else {
        ctx.ui.notify('Pipeline completed.', 'info');
      }
      return;
    }
    case 'approve': {
      await controller.approve(ctx, rest);
      ctx.ui.notify('Pipeline plan approved.', 'info');
      return;
    }
    case 'reject': {
      controller.reject();
      ctx.ui.notify('Pipeline plan rejected.', 'info');
      return;
    }
    case 'cancel': {
      controller.cancel();
      ctx.ui.notify('Pipeline cancelled.', 'info');
      return;
    }
    default:
      ctx.ui.notify('Usage: /pipeline list|run|approve|reject|cancel', 'warning');
  }
}

export function parseRunArgs(
  args: string,
  pipelineTitles: string[],
): { pipelineName: string; prompt: string } | null {
  const trimmed = args.trim();
  if (!trimmed) {
    return null;
  }

  const title = [...pipelineTitles]
    .sort((left, right) => right.length - left.length)
    .find(candidate => trimmed === candidate || trimmed.startsWith(`${candidate} `));

  if (title) {
    const prompt = trimmed.slice(title.length).trim();
    return prompt ? { pipelineName: title, prompt } : null;
  }

  const [pipelineName, prompt] = splitFirstWord(trimmed);
  return pipelineName && prompt ? { pipelineName, prompt } : null;
}

function splitFirstWord(input: string): [string, string] {
  const trimmed = input.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace < 0) {
    return [trimmed, ''];
  }
  return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace + 1).trim()];
}
