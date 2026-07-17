import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PipelineMetadata, PipelineStep } from './PipelineTypes';

/**
 * Parses pipeline YAML files and extracts metadata
 */
export class PipelineParser {
  private static readonly PIPELINES_GLOB = '.acp/pipelines/**/*.yaml';
  private static readonly PIPELINES_DIRECTORY = '.acp/pipelines';

  /**
   * Field descriptions for YAML tooltips
   */
  private static readonly FIELD_INFO: Record<string, {
    description: string;
    type: string;
    required?: boolean;
    enumValues?: string[];
    example?: string;
  }> = {
    'version': {
      description: 'Pipeline schema version',
      type: 'number',
      required: true,
      enumValues: ['2'],
      example: '2',
    },
    'id': {
      description: 'Unique identifier for the pipeline',
      type: 'string',
      required: true,
      example: 'plan-execute-verify',
    },
    'title': {
      description: 'Human-readable title for the pipeline',
      type: 'string',
      required: false,
      example: 'Plan Execute Verify',
    },
    'agent': {
      description: 'AI agent to execute this step/primitive',
      type: 'string',
      required: false,
      example: 'Vibe',
    },
    'output': {
      description: 'Output variable name for the step result',
      type: 'string',
      required: false,
      example: 'proposed_plan',
    },
    'sideEffects': {
      description: 'Type of side effects allowed',
      type: 'string',
      required: false,
      enumValues: ['none', 'workspace', 'read', 'write'],
      example: 'workspace',
    },
    'permissions': {
      description: 'Permission level for the agent',
      type: 'string',
      required: false,
      enumValues: ['ask', 'allowAll', 'deny'],
      example: 'allowAll',
    },
    'promptFile': {
      description: 'Path to the prompt file for the agent',
      type: 'string',
      required: false,
      example: '../agents/planner.md',
    },
    'prompt': {
      description: 'Inline prompt for the agent',
      type: 'string',
      required: false,
      example: 'Create a detailed plan for the task',
    },
    'primitives': {
      description: 'Reusable agent configurations',
      type: 'object',
      required: false,
    },
    'steps': {
      description: 'Ordered list of pipeline steps',
      type: 'array',
      required: true,
    },
    'use': {
      description: 'Reference to a primitive by ID',
      type: 'string',
      required: false,
      example: 'planner',
    },
    'type': {
      description: 'Step type (primitive, approval, etc.)',
      type: 'string',
      required: false,
      enumValues: ['primitive', 'approval'],
      example: 'approval',
    },
  };

  /**
   * Get field information for YAML tooltips
   */
  static getFieldInfo(fieldName: string): {
    description: string;
    type: string;
    required?: boolean;
    enumValues?: string[];
    example?: string;
  } | undefined {
    return this.FIELD_INFO[fieldName];
  }

  /**
   * Discover all pipeline files in the workspace
   */
  static async discoverPipelineFiles(workspaceUri: string): Promise<string[]> {
    const pipelinesDir = path.join(workspaceUri, this.PIPELINES_DIRECTORY);
    
    try {
      const files: string[] = [];
      
      // Check if pipelines directory exists
      try {
        const stats = await fs.stat(pipelinesDir);
        if (!stats.isDirectory()) {
          return [];
        }
      } catch {
        return [];
      }

      // Recursively find all YAML files
      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            // Skip common non-pipeline directories
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'save') {
              continue;
            }
            await walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.yaml' || ext === '.yml') {
              files.push(fullPath);
            }
          }
        }
      };

      await walk(pipelinesDir);
      return files;
    } catch (error) {
      console.error('Error discovering pipeline files:', error);
      return [];
    }
  }

  /**
   * Parse a single pipeline YAML file
   */
  static async parsePipelineFile(filePath: string): Promise<PipelineMetadata | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const doc = yaml.load(content) as Record<string, any>;
      
      if (!doc || typeof doc !== 'object') {
        return null;
      }

      // Extract basic metadata
      const id = doc.id || path.basename(filePath, path.extname(filePath));
      const title = doc.title || id;
      const version = doc.version || 1;

      // Extract primitives
      const primitives: Record<string, any> = doc.primitives || {};

      // Extract and process steps
      const steps: PipelineStep[] = [];
      const rawSteps = doc.steps || [];

      for (const stepDef of rawSteps) {
        if (!stepDef || typeof stepDef !== 'object') {
          continue;
        }

        const step: PipelineStep = {
          id: stepDef.id || `step-${steps.length}`,
          type: stepDef.type || 'primitive',
          use: stepDef.use,
          status: 'pending',
          agent: this.resolveAgent(stepDef, primitives),
          output: stepDef.output,
        };

        steps.push(step);
      }

      // Try to find the primary agent from primitives
      let agent: string | undefined;
      if (Object.keys(primitives).length > 0) {
        const firstPrimitive = primitives[Object.keys(primitives)[0]];
        agent = firstPrimitive?.agent;
      }

      return {
        id,
        title,
        version,
        filePath,
        status: 'idle',
        agent,
        steps,
      };
    } catch (error) {
      console.error('Error parsing pipeline file:', filePath, error);
      return null;
    }
  }

  /**
   * Resolve agent for a step (either directly on step or from referenced primitive)
   */
  private static resolveAgent(stepDef: Record<string, any>, primitives: Record<string, any>): string | undefined {
    // Direct agent on step
    if (stepDef.agent) {
      return stepDef.agent;
    }

    // Agent from referenced primitive
    if (stepDef.use) {
      const primitive = primitives[stepDef.use];
      if (primitive?.agent) {
        return primitive.agent;
      }
    }

    return undefined;
  }

  /**
   * Parse all pipeline files in the workspace
   */
  static async parseAllPipelines(workspaceUri: string): Promise<PipelineMetadata[]> {
    const filePaths = await this.discoverPipelineFiles(workspaceUri);
    const pipelines: PipelineMetadata[] = [];

    for (const filePath of filePaths) {
      const pipeline = await this.parsePipelineFile(filePath);
      if (pipeline) {
        pipelines.push(pipeline);
      }
    }

    return pipelines;
  }

  /**
   * Get all YAML field descriptions
   */
  static getAllFieldDescriptions(): Record<string, {
    description: string;
    type: string;
    required?: boolean;
    enumValues?: string[];
    example?: string;
  }> {
    return { ...this.FIELD_INFO };
  }
}
