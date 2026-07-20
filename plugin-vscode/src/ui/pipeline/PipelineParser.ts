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
      enumValues: ['3'],
      example: '3',
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
      description: 'AI agent to execute this node',
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
    'nodes': {
      description: 'Pipeline nodes',
      type: 'array',
      required: true,
    },
    'needs': {
      description: 'Node dependencies',
      type: 'array',
      required: false,
      example: '[plan]',
    },
    'type': {
      description: 'Node type',
      type: 'string',
      required: false,
      enumValues: ['agent', 'pause'],
      example: 'pause',
    },
    'pause': {
      description: 'Pause type',
      type: 'string',
      required: false,
      enumValues: ['approval', 'question', 'promotion'],
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

      const steps: PipelineStep[] = [];
      const rawNodes = Array.isArray(doc.nodes) ? doc.nodes : [];

      for (const nodeDef of rawNodes) {
        if (!nodeDef || typeof nodeDef !== 'object') {
          continue;
        }

        const output = typeof nodeDef.output === 'object' && nodeDef.output !== null
          ? nodeDef.output.name
          : nodeDef.output;
        const step: PipelineStep = {
          id: nodeDef.id || `node-${steps.length}`,
          type: nodeDef.type || 'agent',
          status: 'pending',
          agent: nodeDef.agent,
          output,
        };

        steps.push(step);
      }

      const firstAgentNode = rawNodes.find(node => node && typeof node === 'object' && typeof node.agent === 'string');

      return {
        id,
        title,
        version,
        filePath,
        status: 'idle',
        agent: firstAgentNode?.agent,
        steps,
      };
    } catch (error) {
      console.error('Error parsing pipeline file:', filePath, error);
      return null;
    }
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
