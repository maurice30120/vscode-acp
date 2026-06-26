#!/usr/bin/env node
/**
 * Copies curated workspace dotfolders into resources/workspace-starter/ for VSIX packaging.
 * Run after changing .acp/, .agents/skills/, or .sandcastle/ scaffold templates.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const destRoot = path.join(repoRoot, 'resources', 'workspace-starter');

const includePipelineArchive = process.argv.includes('--include-pipeline-archive');

/** @param {string} relPath POSIX-style relative path */
function shouldSkip(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  if (!includePipelineArchive && normalized.startsWith('.acp/pipelines/save/')) {
    return true;
  }
  if (normalized.startsWith('.cursor/') || normalized.startsWith('.codex/') || normalized.startsWith('.agent/')) {
    return true;
  }
  if (normalized.startsWith('.sandcastle/logs/')) return true;
  if (normalized === '.sandcastle/.env') return true;
  if (normalized.startsWith('.sandcastle/patches/')) return true;
  if (normalized.startsWith('.sandcastle/worktrees/')) return true;
  return false;
}

/** @param {string} src @param {string} destRel */
function copyFileFiltered(src, destRel) {
  if (shouldSkip(destRel)) return;
  const dest = path.join(destRoot, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** @param {string} srcDir @param {string} destRelPrefix */
function copyTree(srcDir, destRelPrefix) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`skip missing source: ${srcDir}`);
    return;
  }
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = destRelPrefix ? `${destRelPrefix}/${entry.name}` : entry.name;
    const srcPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkip(rel)) {
        copyTree(srcPath, rel);
      }
    } else if (entry.isFile()) {
      copyFileFiltered(srcPath, rel);
    }
  }
}

function copyAcpPipelines() {
  const pipelinesDir = path.join(repoRoot, '.acp', 'pipelines');
  if (!fs.existsSync(pipelinesDir)) return;
  for (const entry of fs.readdirSync(pipelinesDir, { withFileTypes: true })) {
    const rel = `.acp/pipelines/${entry.name}`;
    const srcPath = path.join(pipelinesDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'save' && !includePipelineArchive) continue;
      copyTree(srcPath, rel);
    } else if (entry.isFile()) {
      copyFileFiltered(srcPath, rel);
    }
  }
}

function rmDest() {
  if (fs.existsSync(destRoot)) {
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(destRoot, { recursive: true });
}

function writeManifest() {
  let sourceCommit;
  try {
    sourceCommit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    sourceCommit = undefined;
  }
  const manifest = {
    version: '1',
    generatedAt: new Date().toISOString(),
    ...(sourceCommit ? { sourceCommit } : {}),
  };
  fs.writeFileSync(
    path.join(destRoot, 'MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function copySandcastleScaffold() {
  const sandcastleDir = path.join(repoRoot, '.sandcastle');
  for (const name of ['Dockerfile', '.env.example', '.gitignore']) {
    const src = path.join(sandcastleDir, name);
    if (fs.existsSync(src)) {
      copyFileFiltered(src, `.sandcastle/${name}`);
    }
  }
}

rmDest();
copyAcpPipelines();
copyTree(path.join(repoRoot, '.acp', 'teams'), '.acp/teams');
copyTree(path.join(repoRoot, '.acp', 'agents'), '.acp/agents');
copyTree(path.join(repoRoot, '.agents'), '.agents');
copySandcastleScaffold();
writeManifest();

console.log(`Synced workspace starter to ${destRoot}`);
