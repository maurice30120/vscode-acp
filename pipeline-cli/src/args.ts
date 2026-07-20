import * as path from 'node:path';

export interface CommonCliOptions {
  cwd: string;
  json: boolean;
  verbose: boolean;
}

export type CliCommand =
  | { kind: 'help' }
  | ({ kind: 'list' } & CommonCliOptions)
  | ({
      kind: 'run';
      pipelineName: string;
      prompt: string;
      yes: boolean;
    } & CommonCliOptions);

export function parseCliArgs(argv: string[], defaultCwd = process.cwd()): CliCommand {
  const [commandName, ...rest] = argv;
  if (!commandName || commandName === 'help' || commandName === '--help' || commandName === '-h') {
    return { kind: 'help' };
  }
  if (commandName !== 'list' && commandName !== 'run') {
    throw new Error(`Unknown command "${commandName}".`);
  }

  let cwd = defaultCwd;
  let json = false;
  let verbose = false;
  let yes = false;
  let readOptions = true;
  const positional: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (readOptions && argument === '--') {
      readOptions = false;
      continue;
    }
    if (readOptions && argument === '--cwd') {
      const value = rest[index + 1];
      if (!value) {
        throw new Error('--cwd requires a path.');
      }
      cwd = path.resolve(defaultCwd, value);
      index += 1;
      continue;
    }
    if (readOptions && argument === '--json') {
      json = true;
      continue;
    }
    if (readOptions && argument === '--verbose') {
      verbose = true;
      continue;
    }
    if (readOptions && (argument === '--yes' || argument === '-y')) {
      yes = true;
      continue;
    }
    if (readOptions && argument.startsWith('-')) {
      throw new Error(`Unknown option "${argument}".`);
    }
    positional.push(argument);
  }

  if (commandName === 'list') {
    if (positional.length > 0) {
      throw new Error('The list command does not accept positional arguments.');
    }
    return { kind: 'list', cwd, json, verbose };
  }

  if (positional.length < 2) {
    throw new Error('Usage: acp-pipeline run <pipeline> <prompt...>');
  }
  const [pipelineName, ...promptParts] = positional;
  const prompt = promptParts.join(' ').trim();
  if (!prompt) {
    throw new Error('Pipeline prompt is required.');
  }
  return { kind: 'run', pipelineName, prompt, cwd, json, verbose, yes };
}

export function formatHelp(): string {
  return [
    'ACP Pipeline CLI',
    '',
    'Usage:',
    '  acp-pipeline list [--cwd <path>] [--json]',
    '  acp-pipeline run <pipeline> <prompt...> [--cwd <path>] [--yes] [--verbose]',
    '',
    'Commands:',
    '  list  List packaged ACP pipelines.',
    '  run   Run one pipeline, including grill-me questions and plan approval.',
    '',
    'Options:',
    '  --cwd <path>  Workspace used by agents. Defaults to the current directory.',
    '  --yes, -y     Approve a decision-complete plan without a confirmation prompt.',
    '  --verbose     Stream agent updates and detailed runtime status to stderr.',
    '  --json        Emit machine-readable output for list and final run results.',
  ].join('\n');
}
