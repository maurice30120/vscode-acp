import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PipelineArtifact, PipelineRuntimeResult } from '@acp-client/pipeline';

import type { CliRunCommand } from './args.js';
import type { CliPipelineHost } from './host.js';
import type { CliTerminal } from './terminal.js';

export const SEQUENTIAL_DELIVERY_ARTIFACT_TYPE = 'acp.sequential-delivery/v1';

const SCRATCH_REFERENCE = /`((?:\.\/)?\.scratch\/[^`\r\n]+)`/g;

export interface SequentialDeliveryPlan {
  specificationPath: string;
  issuesDirectory: string;
  ticketPaths: string[];
}

export function prepareSequentialDelivery(
  workspaceCwd: string,
  artifact: PipelineArtifact,
): SequentialDeliveryPlan {
  if (artifact.type !== SEQUENTIAL_DELIVERY_ARTIFACT_TYPE) {
    throw new Error(`Expected ${SEQUENTIAL_DELIVERY_ARTIFACT_TYPE}, received ${artifact.type}.`);
  }
  if (typeof artifact.value !== 'string') {
    throw new Error('Sequential delivery artifact must contain a Markdown handoff string.');
  }

  const references = [...artifact.value.matchAll(SCRATCH_REFERENCE)]
    .map(match => normalizeWorkspacePath(match[1]));
  const specificationPaths = [...new Set(references.filter(reference => /\/spec\.md$/.test(reference)))];
  const issuesDirectories = [...new Set(references.filter(reference => /\/issues$/.test(reference)))];

  if (specificationPaths.length !== 1) {
    throw new Error(`Sequential delivery requires exactly one specification path, found ${specificationPaths.length}.`);
  }
  if (issuesDirectories.length !== 1) {
    throw new Error(`Sequential delivery requires exactly one issues directory, found ${issuesDirectories.length}.`);
  }

  const specificationPath = specificationPaths[0];
  const issuesDirectory = issuesDirectories[0];
  const specificationRoot = featureRoot(specificationPath);
  const issuesRoot = featureRoot(`${issuesDirectory}/placeholder.md`);
  if (!specificationRoot || !issuesRoot || specificationRoot !== issuesRoot) {
    throw new Error('Sequential delivery specification and issues directory must share one feature root.');
  }

  const specificationAbsolutePath = resolveScratchPath(workspaceCwd, specificationPath);
  const issuesAbsolutePath = resolveScratchPath(workspaceCwd, issuesDirectory);
  if (!fs.statSync(specificationAbsolutePath).isFile()) {
    throw new Error(`Sequential delivery specification is not a file: ${specificationPath}`);
  }
  if (!fs.statSync(issuesAbsolutePath).isDirectory()) {
    throw new Error(`Sequential delivery issues path is not a directory: ${issuesDirectory}`);
  }

  const ticketNames = fs.readdirSync(issuesAbsolutePath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (ticketNames.length === 0) {
    throw new Error(`Sequential delivery issues directory contains no Markdown tickets: ${issuesDirectory}`);
  }

  for (const [index, ticketName] of ticketNames.entries()) {
    const expectedNumber = index + 1;
    const match = /^(\d{2})-.+\.md$/.exec(ticketName);
    if (!match || Number.parseInt(match[1], 10) !== expectedNumber) {
      throw new Error(
        `Sequential delivery tickets must be contiguous from 01; expected ${String(expectedNumber).padStart(2, '0')}-*.md but found ${ticketName}.`,
      );
    }
  }

  return {
    specificationPath,
    issuesDirectory,
    ticketPaths: ticketNames.map(ticketName => `${issuesDirectory}/${ticketName}`),
  };
}

export async function runSequentialDelivery(
  host: Pick<CliPipelineHost, 'start'>,
  terminal: CliTerminal,
  command: CliRunCommand,
  plan: SequentialDeliveryPlan,
): Promise<PipelineRuntimeResult> {
  for (const [index, ticketPath] of plan.ticketPaths.entries()) {
    terminal.writeError(
      `[acp-cli] Starting ticket ${index + 1}/${plan.ticketPaths.length}: ${ticketPath}`,
    );
    const result = await host.start('implement-ticket', [
      'User request:',
      command.prompt,
      '',
      `Specification: \`${plan.specificationPath}\``,
      `Ticket: \`${ticketPath}\``,
    ].join('\n'));

    if (result.status === 'paused') {
      throw new Error(`implement-ticket paused unexpectedly at node "${result.pause.nodeId}".`);
    }
    if (result.status !== 'completed') {
      return result;
    }
  }

  terminal.writeError(`[acp-cli] Completed ${plan.ticketPaths.length} ticket pipeline(s); starting review.`);
  const review = await host.start('review-delivery', [
    'User request:',
    command.prompt,
    '',
    'Approved delivery files:',
    `- \`${plan.specificationPath}\``,
    `- \`${plan.issuesDirectory}/\``,
  ].join('\n'));
  if (review.status === 'paused') {
    throw new Error(`review-delivery paused unexpectedly at node "${review.pause.nodeId}".`);
  }
  return review;
}

function normalizeWorkspacePath(reference: string): string {
  return reference.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
}

function featureRoot(reference: string): string | undefined {
  const match = /^(\.scratch\/[^/]+)\/.+$/.exec(reference);
  return match?.[1];
}

function resolveScratchPath(workspaceCwd: string, workspacePath: string): string {
  const scratchRoot = path.resolve(workspaceCwd, '.scratch');
  const absolutePath = path.resolve(workspaceCwd, workspacePath);
  const relative = path.relative(scratchRoot, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Sequential delivery path escapes .scratch: ${workspacePath}`);
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Sequential delivery path does not exist: ${workspacePath}`);
  }
  return absolutePath;
}
