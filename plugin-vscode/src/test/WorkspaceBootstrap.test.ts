import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { syncWorkspaceStarterCore } from '../workspace/WorkspaceBootstrapCore';
import { listSelectableAgentNames } from '../config/VirtualAgentCatalog';
import { repoRoot } from './repoRoot';

suite('WorkspaceBootstrap', () => {
  let workspaceRoot: string;
  let starterRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bootstrap-'));
    starterRoot = path.join(repoRoot(), 'resources', 'workspace-starter');
  });

  teardown(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test('starter kit is present after sync', () => {
    assert.ok(fs.existsSync(path.join(starterRoot, 'MANIFEST.json')));
    assert.ok(fs.existsSync(path.join(starterRoot, '.acp', '.gitignore')));
    assert.ok(fs.existsSync(path.join(starterRoot, '.acp', 'acp-agents.json')));
    assert.ok(fs.existsSync(path.join(starterRoot, '.acp', 'agents', '.gitignore')));
    assert.ok(fs.existsSync(path.join(starterRoot, '.acp', 'pipelines', '.gitignore')));
    assert.ok(fs.existsSync(path.join(starterRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml')));
    assert.ok(!fs.existsSync(path.join(starterRoot, '.acp', 'teams')));
    assert.ok(!fs.existsSync(path.join(starterRoot, '.sandcastle', '.env')));

    const manifest = JSON.parse(fs.readFileSync(path.join(starterRoot, 'MANIFEST.json'), 'utf8')) as { version: string };
    assert.strictEqual(typeof manifest.version, 'string');
  });

  test('seeds an empty workspace with templates', async () => {
    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    assert.ok(result.created.length > 0);
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', '.gitignore')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'acp-agents.json')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'agents', '.gitignore')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'pipelines', '.gitignore')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml')));
    assert.ok(!fs.existsSync(path.join(workspaceRoot, '.acp', 'teams')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.agents', 'skills', 'tdd', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.sandcastle', 'Dockerfile')));
    assert.ok(!fs.existsSync(path.join(workspaceRoot, '.sandcastle', '.env')));
  });

  test('bootstrapped workspace exposes only the canonical Plan Execute Verify workflow', async () => {
    await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    const agentNames = listSelectableAgentNames(workspaceRoot, {
      'Cursor CLI': { command: 'cursor-agent' },
      'Pi Sandcastle': { transport: 'sandcastle', provider: 'pi', model: 'opencode-go/kimi-k2.6' },
      Vibe: { command: 'vibe' },
    } as any);

    assert.ok(agentNames.includes('Plan Execute Verify'));
    assert.ok(!agentNames.includes('Feature Team'));
  });

  test('second run creates nothing and leaves files byte-identical', async () => {
    const first = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });
    assert.ok(first.created.length > 0);

    const snapshot = new Map<string, Buffer>();
    const collect = (dir: string, prefix = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(abs, rel);
        } else if (entry.isFile()) {
          snapshot.set(rel, fs.readFileSync(abs));
        }
      }
    };
    collect(workspaceRoot);

    const second = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });
    assert.strictEqual(second.created.length, 0);
    assert.ok(second.skipped.length > 0);

    for (const [rel, bytes] of snapshot) {
      assert.deepStrictEqual(fs.readFileSync(path.join(workspaceRoot, rel)), bytes, rel);
    }
  });

  test('does not overwrite an existing file with different content', async () => {
    const existingPipelinePath = path.join(workspaceRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml');
    fs.mkdirSync(path.dirname(existingPipelinePath), { recursive: true });
    fs.writeFileSync(existingPipelinePath, 'version: 2\nid: custom\n', 'utf8');

    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    assert.strictEqual(fs.readFileSync(existingPipelinePath, 'utf8'), 'version: 2\nid: custom\n');
    assert.ok(result.skipped.includes('.acp/pipelines/plan-execute-verify.yaml'));
  });

  test('excludes pipeline archive by default', async () => {
    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, {
      starterRoot,
      includePipelineArchive: false,
    });

    assert.ok(result.created.length > 0);
    assert.ok(!fs.existsSync(path.join(workspaceRoot, '.acp', 'pipelines', 'save')));
  });

  test('includes pipeline archive when requested', async () => {
    const archiveStarter = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-bootstrap-archive-'));
    try {
      fs.cpSync(starterRoot, archiveStarter, { recursive: true });
      const saveDir = path.join(repoRoot(), '.acp', 'pipelines', 'save');
      if (fs.existsSync(saveDir)) {
        fs.cpSync(saveDir, path.join(archiveStarter, '.acp', 'pipelines', 'save'), { recursive: true });
      }

      const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, {
        starterRoot: archiveStarter,
        includePipelineArchive: true,
      });

      const saveTarget = path.join(workspaceRoot, '.acp', 'pipelines', 'save');
      if (fs.existsSync(path.join(archiveStarter, '.acp', 'pipelines', 'save'))) {
        assert.ok(fs.existsSync(saveTarget));
        const yamlFiles = fs.readdirSync(saveTarget).filter(name => name.endsWith('.yaml'));
        assert.ok(yamlFiles.length > 0);
        assert.ok(result.created.some(rel => rel.startsWith('.acp/pipelines/save/')));
      }
    } finally {
      fs.rmSync(archiveStarter, { recursive: true, force: true });
    }
  });

  test('creates .cursor/skills symlink after seeding .agents/skills', async () => {
    await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    const linkPath = path.join(workspaceRoot, '.cursor', 'skills');
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink());
    assert.strictEqual(
      fs.realpathSync(linkPath),
      fs.realpathSync(path.join(workspaceRoot, '.agents', 'skills')),
    );
  });

  test('adds missing .acp gitignore files to an already bootstrapped workspace', async () => {
    fs.mkdirSync(path.join(workspaceRoot, '.acp', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, '.acp', 'pipelines'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, '.acp', '.bootstrap-version'), '1\n', 'utf8');
    fs.writeFileSync(path.join(workspaceRoot, '.acp', 'agents', 'planner.md'), 'custom planner\n', 'utf8');

    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    assert.ok(result.created.includes('.acp/.gitignore'));
    assert.ok(result.created.includes('.acp/agents/.gitignore'));
    assert.ok(result.created.includes('.acp/pipelines/.gitignore'));
    assert.strictEqual(
      fs.readFileSync(path.join(workspaceRoot, '.acp', 'agents', 'planner.md'), 'utf8'),
      'custom planner\n',
    );
  });

  test('writes .acp/.bootstrap-version when absent', async () => {
    await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    const versionPath = path.join(workspaceRoot, '.acp', '.bootstrap-version');
    assert.ok(fs.existsSync(versionPath));
    const manifest = JSON.parse(fs.readFileSync(path.join(starterRoot, 'MANIFEST.json'), 'utf8')) as { version: string };
    assert.strictEqual(fs.readFileSync(versionPath, 'utf8').trim(), manifest.version);
  });
});
