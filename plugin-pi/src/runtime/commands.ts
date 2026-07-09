import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

import type { PipelineController } from './pipelineController.js';

export function registerPipelineCommand(pi: ExtensionAPI, controller: PipelineController): void {
  pi.registerCommand('pipeline', {
    description: 'List, run, approve, reject, or cancel ACP pipelines',
    getArgumentCompletions: (prefix) => {
      const words = ['list', 'run', 'approve', 'reject', 'cancel', 'verbose', 'on', 'off', 'status'];
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
      const parsed = parseRunArgs(
        rest,
        controller.listPipelines().flatMap(definition => [definition.id, definition.title]),
      );
      if (!parsed) {
        ctx.ui.notify('Usage: /pipeline run <pipeline> <prompt>', 'warning');
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
    case 'verbose': {
      switch (rest) {
        case 'on':
          controller.setVerbose(true);
          ctx.ui.notify('Pipeline verbose mode enabled.', 'info');
          return;
        case 'off':
          controller.setVerbose(false);
          ctx.ui.notify('Pipeline verbose mode disabled.', 'info');
          return;
        case '':
        case 'status':
          ctx.ui.notify(
            `Pipeline verbose mode is ${controller.isVerbose() ? 'enabled' : 'disabled'}.`,
            'info',
          );
          return;
        default:
          ctx.ui.notify('Usage: /pipeline verbose on|off|status', 'warning');
          return;
      }
    }
    default:
      ctx.ui.notify('Usage: /pipeline list|run|approve|reject|cancel|verbose', 'warning');
  }
}

export function parseRunArgs(
  args: string,
  pipelineNames: string[],
): { pipelineName: string; prompt: string } | null {
  const trimmed = args.trim();
  if (!trimmed) {
    return null;
  }

  const name = [...pipelineNames]
    .sort((left, right) => right.length - left.length)
    .find(candidate => trimmed === candidate || trimmed.startsWith(`${candidate} `));

  if (name) {
    const prompt = trimmed.slice(name.length).trim();
    return prompt ? { pipelineName: name, prompt } : null;
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
