import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acp-pi-extension-'));
}

export function writeFile(workspace: string, relativePath: string, content: string): void {
  const filePath = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

export function writeDefaultConfig(workspace: string): void {
  writeFile(workspace, '.pi/acp-agents.json', JSON.stringify({
    agents: {
      'Codex CLI': {
        command: 'codex',
        args: [],
        env: {},
      },
      'Pi Agent': {
        command: 'pi-acp',
        args: [],
        env: {},
      },
    },
    pipeline: {
      enabled: true,
      instructionsMaxBytes: 262144,
    },
  }, null, 2));
}

export function writeDemoPipeline(workspace: string): void {
  writeFile(workspace, '.acp/pipelines/demo.yaml', [
    'version: 2',
    'id: demo',
    'title: Demo Pipeline',
    'primitives:',
    '  planner:',
    '    agent: Codex CLI',
    '    prompt: |',
    '      Plan this request:',
    '      {{userPrompt}}',
    '    output: proposed_plan',
    '    sideEffects: none',
    '  implementer:',
    '    agent: Pi Agent',
    '    prompt: |',
    '      Implement:',
    '      {{steps.approval.output}}',
    '    output: markdown',
    '    sideEffects: workspace',
    'steps:',
    '  - id: planner',
    '    use: planner',
    '  - id: approval',
    '    type: approval',
    '    input: "{{steps.planner.output}}"',
    '  - id: implementer',
    '    use: implementer',
    '',
  ].join('\n'));
}

export function writeDemoTeam(workspace: string): void {
  writeFile(workspace, '.acp/teams/planner.md', 'Plan carefully.');
  writeFile(workspace, '.acp/teams/implementer.md', 'Implement the approved plan.');
  writeFile(workspace, '.acp/teams/reviewer.md', 'Review the implementation.');
  writeFile(workspace, '.acp/teams/feature-team.yaml', [
    'version: 1',
    'id: feature',
    'title: Feature Team',
    'roles:',
    '  planner:',
    '    agent: Codex CLI',
    '    instructions: planner.md',
    '  implementer:',
    '    agent: Pi Agent',
    '    instructions: implementer.md',
    '  reviewer:',
    '    agent: Codex CLI',
    '    instructions: reviewer.md',
    '',
  ].join('\n'));
}
