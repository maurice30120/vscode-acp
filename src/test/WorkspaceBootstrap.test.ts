import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { syncWorkspaceStarterCore } from '../workspace/WorkspaceBootstrapCore';
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
    assert.ok(fs.existsSync(path.join(starterRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml')));
    assert.ok(!fs.existsSync(path.join(starterRoot, '.sandcastle', '.env')));

    const manifest = JSON.parse(fs.readFileSync(path.join(starterRoot, 'MANIFEST.json'), 'utf8')) as { version: string };
    assert.strictEqual(typeof manifest.version, 'string');
  });

  test('seeds an empty workspace with templates', async () => {
    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    assert.ok(result.created.length > 0);
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.agents', 'skills', 'tdd', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.sandcastle', 'Dockerfile')));
    assert.ok(!fs.existsSync(path.join(workspaceRoot, '.sandcastle', '.env')));
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
    const existingTeamPath = path.join(workspaceRoot, '.acp', 'teams', 'feature-team.yaml');
    fs.mkdirSync(path.dirname(existingTeamPath), { recursive: true });
    fs.writeFileSync(existingTeamPath, 'version: 1\nid: custom-team\n', 'utf8');

    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    assert.strictEqual(fs.readFileSync(existingTeamPath, 'utf8'), 'version: 1\nid: custom-team\n');
    assert.ok(result.skipped.includes('.acp/teams/feature-team.yaml'));
    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'pipelines', 'plan-execute-verify.yaml')));
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

  test('adds missing team file inside an existing empty teams directory', async () => {
    fs.mkdirSync(path.join(workspaceRoot, '.acp', 'teams'), { recursive: true });

    const result = await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    assert.ok(fs.existsSync(path.join(workspaceRoot, '.acp', 'teams', 'feature-team.yaml')));
    assert.ok(result.created.includes('.acp/teams/feature-team.yaml'));
  });

  test('writes .acp/.bootstrap-version when absent', async () => {
    await syncWorkspaceStarterCore(repoRoot(), workspaceRoot, { starterRoot });

    const versionPath = path.join(workspaceRoot, '.acp', '.bootstrap-version');
    assert.ok(fs.existsSync(versionPath));
    const manifest = JSON.parse(fs.readFileSync(path.join(starterRoot, 'MANIFEST.json'), 'utf8')) as { version: string };
    assert.strictEqual(fs.readFileSync(versionPath, 'utf8').trim(), manifest.version);
  });
});
