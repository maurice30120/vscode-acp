import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';
import {
  validatePipelineDefinition,
  type PipelineDefinition,
  type PipelineValidationResult,
} from '@acp-client/pipeline';

import { loadPiAcpConfig } from './config.js';
import { getValidTeamPipelines } from './teamCatalog.js';
import type { Logger, NativeAcpAgentConfig } from '../types.js';

const PIPELINE_DIR = path.join('.acp', 'pipelines');

export function getPipelineDefinitions(
  workspaceCwd: string,
  logger?: Logger,
): PipelineDefinition[] {
  const config = loadPiAcpConfig(workspaceCwd);
  if (!config.pipeline.enabled) {
    return [];
  }

  for (const error of config.errors) {
    logger?.error(error);
  }

  return mergePipelineDefinitions(
    loadWorkspacePipelineDefinitions(workspaceCwd, config.agents, logger),
    getValidTeamPipelines(workspaceCwd, config.agents, config.pipeline.instructionsMaxBytes, logger),
    logger,
  );
}

export function getPipelineDefinitionForAgent(
  workspaceCwd: string,
  agentName: string,
  logger?: Logger,
): PipelineDefinition | null {
  return getPipelineDefinitions(workspaceCwd, logger)
    .find(definition => definition.title === agentName) ?? null;
}

export function loadWorkspacePipelineDefinitions(
  workspaceCwd: string,
  agentConfigs: Record<string, NativeAcpAgentConfig>,
  logger?: Logger,
): PipelineDefinition[] {
  const dir = path.join(workspaceCwd, PIPELINE_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e: unknown) {
    logger?.error(`Failed to read ACP pipeline directory ${dir}`, e);
    return [];
  }

  const definitions: PipelineDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const result = parsePipelineYaml(text, filePath, agentConfigs);
      if (result.definition) {
        definitions.push(result.definition);
      } else {
        logger?.error(`Ignoring invalid ACP pipeline ${filePath}: ${result.errors.join('; ')}`);
      }
    } catch (e: unknown) {
      logger?.error(`Ignoring unreadable ACP pipeline ${filePath}`, e);
    }
  }
  return definitions;
}

export function parsePipelineYaml(
  text: string,
  filePath: string,
  agentConfigs: Record<string, NativeAcpAgentConfig>,
): PipelineValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (e: unknown) {
    const message = e instanceof Error && e.message ? e.message : String(e);
    return { errors: [`YAML parse error: ${message}`] };
  }

  return validatePipelineDefinition(parsed, filePath, agentConfigs);
}

function mergePipelineDefinitions(
  filePipelines: PipelineDefinition[],
  teamPipelines: PipelineDefinition[],
  logger?: Logger,
): PipelineDefinition[] {
  const byTitle = new Map<string, PipelineDefinition>();

  for (const pipeline of filePipelines) {
    if (byTitle.has(pipeline.title)) {
      logger?.error(`Duplicate pipeline title "${pipeline.title}"; keeping first definition.`);
      continue;
    }
    byTitle.set(pipeline.title, pipeline);
  }

  for (const pipeline of teamPipelines) {
    if (byTitle.has(pipeline.title)) {
      logger?.error(`Team "${pipeline.title}" conflicts with an existing pipeline title; team definition ignored.`);
      continue;
    }
    byTitle.set(pipeline.title, pipeline);
  }

  return [...byTitle.values()];
}
