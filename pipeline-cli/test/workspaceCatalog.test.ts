import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { loadWorkspaceAgentCatalog } from '../src/workspaceCatalog.js';

function createWorkspace(config: unknown): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-cli-catalog-'));
  fs.mkdirSync(path.join(cwd, '.acp'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.acp', 'acp-agents.json'),
    JSON.stringify(config, null, 2),
  );
  return cwd;
}

test('loads the flat workspace agent configuration', () => {
  const cwd = createWorkspace({
    'Codex CLI': {
      command: 'npx',
      args: ['@zed-industries/codex-acp@latest'],
      env: {},
    },
    'Vibe Sandcastle': {
      transport: 'sandcastle',
      provider: 'vibe',
      model: 'mistral-large-latest',
      effort: 'high',
      env: {},
    },
  });

  try {
    const catalog = loadWorkspaceAgentCatalog(cwd);
    assert.deepEqual(catalog.errors, []);
    assert.equal(catalog.agents['Codex CLI']?.transport, undefined);
    assert.equal(catalog.agents['Vibe Sandcastle']?.transport, 'sandcastle');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('rejects the obsolete embedded Pi catalog shape', () => {
  const cwd = createWorkspace({
    agents: {
      Planner: { command: 'planner-acp' },
    },
    pipeline: { enabled: true },
  });

  try {
    const catalog = loadWorkspaceAgentCatalog(cwd);
    assert.deepEqual(catalog.agents, {});
    assert.match(catalog.errors.join('\n'), /obsolete embedded catalog shape/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
