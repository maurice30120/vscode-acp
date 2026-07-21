#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';

const workspaceCwd = process.cwd();
const [specArgument, issuesArgument] = process.argv.slice(2);

if (!specArgument || !issuesArgument) {
  fail('Usage: run-ticket-sequence.mjs <spec-path> <issues-directory>');
}

const spec = resolveDeliveryPath(specArgument, 'specification');
const issues = resolveDeliveryPath(issuesArgument, 'issues directory');
const specMatch = /^\.scratch\/([^/]+)\/spec\.md$/.exec(spec.workspacePath);
const issuesMatch = /^\.scratch\/([^/]+)\/issues$/.exec(issues.workspacePath);

if (!specMatch) {
  fail(`Specification path must match .scratch/<feature-slug>/spec.md: ${specArgument}`);
}
if (!issuesMatch) {
  fail(`Issues path must match .scratch/<feature-slug>/issues/: ${issuesArgument}`);
}
if (specMatch[1] !== issuesMatch[1]) {
  fail('Specification and issues directory must share the same feature root.');
}
if (!fs.statSync(spec.absolutePath).isFile()) {
  fail(`Specification path is not a file: ${spec.workspacePath}`);
}
if (!fs.statSync(issues.absolutePath).isDirectory()) {
  fail(`Issues path is not a directory: ${issues.workspacePath}`);
}

const ticketNames = fs.readdirSync(issues.absolutePath, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
  .map(entry => entry.name)
  .sort((left, right) => left.localeCompare(right));

if (ticketNames.length === 0) {
  fail(`Issues directory contains no Markdown tickets: ${issues.workspacePath}`);
}

for (const [index, ticketName] of ticketNames.entries()) {
  const match = /^(\d{2})-.+\.md$/.exec(ticketName);
  const expectedNumber = index + 1;
  if (!match || Number.parseInt(match[1], 10) !== expectedNumber) {
    fail(`Tickets must be contiguous and numbered from 01; expected ${String(expectedNumber).padStart(2, '0')}-*.md but found ${ticketName}.`);
  }
}

const cliPath = path.join(workspaceCwd, 'pipeline-cli', 'dist', 'src', 'cli.js');
if (!fs.existsSync(cliPath)) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npmCommand, ['--prefix', 'pipeline-cli', 'run', 'build'], {
    cwd: workspaceCwd,
    stdio: 'inherit',
  });
  if (build.status !== 0) {
    fail(`Unable to build pipeline-cli before ticket execution (exit ${String(build.status)}).`);
  }
}

for (const [index, ticketName] of ticketNames.entries()) {
  const ticketPath = `${issues.workspacePath}/${ticketName}`;
  const prompt = `Specification: \`${spec.workspacePath}\`\nTicket: \`${ticketPath}\``;
  process.stdout.write(`\n[acp-cli] Implementing ticket ${index + 1}/${ticketNames.length}: ${ticketPath}\n`);

  const child = spawnSync(process.execPath, [
    cliPath,
    'run',
    'implement-ticket',
    prompt,
    '--cwd',
    workspaceCwd,
    '--yes',
  ], {
    cwd: workspaceCwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ACP_NESTED_PIPELINE: '1',
    },
  });

  if (child.status !== 0) {
    fail(`Ticket pipeline failed for ${ticketPath} (exit ${String(child.status)}).`);
  }
}

process.stdout.write(`\n[acp-cli] Completed ${ticketNames.length} ticket pipeline(s) in order.\n`);

function resolveDeliveryPath(argument, label) {
  const workspacePath = argument.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!workspacePath.startsWith('.scratch/')) {
    fail(`${label} must stay under .scratch/: ${argument}`);
  }

  const scratchRoot = path.resolve(workspaceCwd, '.scratch');
  const absolutePath = path.resolve(workspaceCwd, workspacePath);
  const relative = path.relative(scratchRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes .scratch/: ${argument}`);
  }
  if (!fs.existsSync(absolutePath)) {
    fail(`${label} does not exist: ${workspacePath}`);
  }
  return { workspacePath, absolutePath };
}

function fail(message) {
  process.stderr.write(`[acp-cli] ${message}\n`);
  process.exit(1);
}
