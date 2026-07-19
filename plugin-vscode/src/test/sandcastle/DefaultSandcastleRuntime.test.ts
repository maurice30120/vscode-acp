import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareCodexHome, buildSandboxMounts } from '@acp-client/sandcastle';
import { createVibeProvider } from '../../sandcastle/VibeProvider';

suite('DefaultSandcastleRuntime', () => {
  let repo: string;

  setup(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sandcastle-codex-home-'));
  });

  teardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('prepareCodexHome creates a writable sandbox-local directory', () => {
    const codexHome = prepareCodexHome(repo);
    assert.strictEqual(codexHome, path.join(repo, '.sandcastle', 'codex-home'));
    assert.ok(fs.existsSync(codexHome));
    fs.writeFileSync(path.join(codexHome, 'runtime.txt'), 'ok', 'utf8');
    assert.strictEqual(fs.readFileSync(path.join(codexHome, 'runtime.txt'), 'utf8'), 'ok');
  });

  test('buildSandboxMounts includes .agents and codex auth mounts', () => {
    const agentsDir = path.join(repo, '.agents', 'skills');
    fs.mkdirSync(agentsDir, { recursive: true });

    const mounts = buildSandboxMounts({ provider: 'codex', model: 'gpt-5.4', imageName: 'img' }, repo);

    assert.ok(mounts.some(mount => mount.sandboxPath === '.agents'));
    assert.ok(mounts.some(mount => mount.sandboxPath === '/home/agent/.codex'));
  });

  test('buildSandboxMounts mounts Vibe home for vibe provider', () => {
    const mounts = buildSandboxMounts({ provider: 'vibe', model: 'test', imageName: 'img' }, repo);

    const vibeHome = mounts.find(mount => mount.sandboxPath === '/home/agent/.vibe');
    assert.ok(vibeHome);
    assert.strictEqual(vibeHome.readonly, false);
    assert.strictEqual(vibeHome.hostPath, path.join(repo, '.sandcastle', 'vibe-home'));
  });

  test('createVibeProvider creates the configured provider without loading Sandcastle runtime code', () => {
    const provider = createVibeProvider('mistral-large-latest', {
      env: { FOO: 'bar' },
    });

    assert.strictEqual(provider.name, 'vibe');
    assert.strictEqual(provider.env.VIBE_ACTIVE_MODEL, 'mistral-large-latest');
    assert.strictEqual(provider.env.VIBE_HOME, '/home/agent/.vibe');
    assert.strictEqual(provider.env.FOO, 'bar');
    assert.deepStrictEqual(provider.buildPrintCommand({
      prompt: 'hello',
      dangerouslySkipPermissions: true,
    }), {
      command: "vibe --prompt 'hello' --output streaming --trust",
    });
    assert.deepStrictEqual(provider.buildPrintCommand({
      prompt: "don't lose quotes",
      dangerouslySkipPermissions: true,
    }), {
      command: "vibe --prompt 'don'\\''t lose quotes' --output streaming --trust",
    });
    assert.deepStrictEqual(provider.parseStreamLine(JSON.stringify({
      role: 'assistant',
      content: '',
      reasoning_content: "I'll inspect the pipeline UI.",
    })), [
      { type: 'text', text: "I'll inspect the pipeline UI." },
    ]);
  });
});
