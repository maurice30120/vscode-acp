import * as assert from 'assert';
import * as vscode from 'vscode';

import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import { PermissionHandler } from '../handlers/PermissionHandler';

type PermissionSelection = vscode.QuickPickItem & { optionId: string };

suite('PermissionHandler', () => {
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    (vscode.window as any).showQuickPick = originalShowQuickPick;
    (vscode.workspace as any).getConfiguration = originalGetConfiguration;
  });

  test('queues concurrent permission prompts so they run serially', async () => {
    stubConfiguration('ask');

    const titles: string[] = [];
    const releases: Array<() => void> = [];
    let callCount = 0;

    (vscode.window as any).showQuickPick = (
      items: readonly PermissionSelection[],
      options?: vscode.QuickPickOptions,
    ) => {
      callCount += 1;
      titles.push(options?.placeHolder ?? '');
      return new Promise<PermissionSelection | undefined>(resolve => {
        releases.push(() => resolve(items[0]));
      });
    };

    const handler = new PermissionHandler();
    const firstPromise = handler.requestPermission(createRequest('First prompt'));
    const secondPromise = handler.requestPermission(createRequest('Second prompt'));

    await flushPromises();
    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(titles, ['First prompt']);

    releases[0]();
    const firstResponse = await firstPromise;
    await waitFor(() => callCount === 2);
    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(titles, ['First prompt', 'Second prompt']);

    releases[1]();
    const secondResponse = await secondPromise;

    assert.deepStrictEqual(firstResponse, {
      outcome: {
        outcome: 'selected',
        optionId: 'allow-once',
      },
    });
    assert.deepStrictEqual(secondResponse, {
      outcome: {
        outcome: 'selected',
        optionId: 'allow-once',
      },
    });
  });

  test('returns cancelled when showQuickPick throws', async () => {
    stubConfiguration('ask');

    (vscode.window as any).showQuickPick = async () => {
      throw new Error('boom');
    };

    const handler = new PermissionHandler();
    const response = await handler.requestPermission(createRequest('Exploding prompt'));

    assert.deepStrictEqual(response, {
      outcome: { outcome: 'cancelled' },
    });
  });

  test('continues processing later requests after a prompt error', async () => {
    stubConfiguration('ask');

    let callCount = 0;
    (vscode.window as any).showQuickPick = async (items: readonly PermissionSelection[]) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('first prompt failed');
      }
      return items[0];
    };

    const handler = new PermissionHandler();
    const firstResponse = await handler.requestPermission(createRequest('First prompt'));
    const secondResponse = await handler.requestPermission(createRequest('Second prompt'));

    assert.deepStrictEqual(firstResponse, {
      outcome: { outcome: 'cancelled' },
    });
    assert.deepStrictEqual(secondResponse, {
      outcome: {
        outcome: 'selected',
        optionId: 'allow-once',
      },
    });
    assert.strictEqual(callCount, 2);
  });

  test('auto-approves allowAll without showing a prompt', async () => {
    stubConfiguration('allowAll');

    let quickPickCalls = 0;
    (vscode.window as any).showQuickPick = async () => {
      quickPickCalls += 1;
      return undefined;
    };

    const handler = new PermissionHandler();
    const response = await handler.requestPermission(createRequest('Auto approved prompt'));

    assert.deepStrictEqual(response, {
      outcome: {
        outcome: 'selected',
        optionId: 'allow-once',
      },
    });
    assert.strictEqual(quickPickCalls, 0);
  });
});

function createRequest(title: string): RequestPermissionRequest {
  return {
    sessionId: 'session-1',
    toolCall: { title } as any,
    options: [
      {
        optionId: 'allow-once',
        name: 'Allow once',
        kind: 'allow_once',
      },
      {
        optionId: 'reject-once',
        name: 'Reject once',
        kind: 'reject_once',
      },
    ],
  };
}

function stubConfiguration(autoApprove: string): void {
  (vscode.workspace as any).getConfiguration = () =>
    ({
      get: (_section: string, defaultValue?: string) => autoApprove ?? defaultValue,
    }) as vscode.WorkspaceConfiguration;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }
    await flushPromises();
  }

  assert.fail('Timed out waiting for expected condition');
}
