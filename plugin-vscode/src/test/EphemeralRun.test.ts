import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  buildEphemeralRunPrompt,
  handleEphemeralSessionUpdate,
  runEphemeralRun,
  type EphemeralRunCollectionState,
} from '../core/EphemeralRun';
import { isRunAbortedError, RunAbortedError } from '../core/RunAbortedError';
import { clearSkillsCatalogCache } from '../skills/SkillsCatalog';

suite('RunAbortedError', () => {
  test('isRunAbortedError identifies RunAbortedError instances', () => {
    assert.strictEqual(isRunAbortedError(new RunAbortedError()), true);
    assert.strictEqual(isRunAbortedError(new Error('Run aborted.')), false);
  });
});

suite('EphemeralRun abort', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function() {
      return {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'agents') {
            return { Codex: { command: 'echo' } };
          }
          return defaultValue;
        },
      } as any;
    };
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('runEphemeralRun throws RunAbortedError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => runEphemeralRun({
        workspaceCwd: '/repo',
        agentName: 'Codex',
        promptText: 'hello',
        signal: controller.signal,
      }),
      (error: unknown) => isRunAbortedError(error),
    );
  });
});

suite('EphemeralRun session updates', () => {
  test('forwards sandcastle_status without collecting assistant text', () => {
    const state: EphemeralRunCollectionState = { collectedText: '' };
    const forwarded: any[] = [];

    handleEphemeralSessionUpdate(
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'sandcastle_status',
          status: 'running',
          provider: 'pi',
          elapsedMs: 1_000,
        } as any,
      },
      'session-1',
      state,
      update => forwarded.push(update),
    );
    handleEphemeralSessionUpdate(
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'provider text' },
        },
      } as any,
      'session-1',
      state,
      update => forwarded.push(update),
    );

    assert.strictEqual(state.collectedText, 'provider text');
    assert.deepStrictEqual(forwarded.map(update => update.update.sessionUpdate), [
      'sandcastle_status',
      'agent_message_chunk',
    ]);
  });

  test('ignores updates from another ephemeral session', () => {
    const state: EphemeralRunCollectionState = { collectedText: '' };
    const forwarded: any[] = [];

    handleEphemeralSessionUpdate(
      {
        sessionId: 'other-session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'ignored' },
        },
      } as any,
      'session-1',
      state,
      update => forwarded.push(update),
    );

    assert.strictEqual(state.collectedText, '');
    assert.deepStrictEqual(forwarded, []);
  });
});

suite('EphemeralRun prompt preparation', () => {
  let root: string;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function(section?: string) {
      if (section === 'acp.skills') {
        return {
          get<T>(key: string, defaultValue?: T): T {
            const values: Record<string, unknown> = {
              enabled: true,
              directory: '.agents/skills',
              maxCatalogBytes: 65536,
              agents: ['Vibe Sandcastle'],
            };
            return (values[key] ?? defaultValue) as T;
          },
        } as vscode.WorkspaceConfiguration;
      }
      if (section === 'acp') {
        return {
          get: (key: string, defaultValue?: unknown) => {
            if (key === 'agents') {
              return { 'Vibe Sandcastle': { command: 'echo' } };
            }
            return defaultValue;
          },
        } as any;
      }
      return originalGetConfiguration(section);
    };

    clearSkillsCatalogCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ephemeral-prompt-'));
    const skillDir = path.join(root, '.agents', 'skills', 'implement');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: implement\ndescription: Implement work.\ndisable-model-invocation: true\n---\n\n# Implement\n\nWrite files.\n',
      'utf8',
    );
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    clearSkillsCatalogCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('injects explicit pipeline skills into ephemeral prompts', () => {
    const prompt = buildEphemeralRunPrompt({
      workspaceCwd: root,
      agentName: 'Vibe Sandcastle',
      promptText: 'Implement the ticket',
      skills: ['implement'],
    });

    assert.match(prompt, /<skill name="implement">/);
    assert.match(prompt, /Write files/);
    assert.match(prompt, /Implement the ticket/);
    assert.doesNotMatch(prompt, /<available_skills>/);
  });
});
