import * as vscode from 'vscode';
import * as path from 'path';
import { PipelineParser } from './PipelineParser';

/**
 * Hover provider for ACP pipeline YAML files
 * Shows contextual information when hovering over YAML fields
 */
export class PipelineHoverProvider implements vscode.HoverProvider {
  private readonly fieldDescriptions: Record<string, {
    description: string;
    type: string;
    required?: boolean;
    enumValues?: string[];
    example?: string;
  }>;

  constructor() {
    this.fieldDescriptions = PipelineParser.getAllFieldDescriptions();
  }

  /**
   * Provide hover information for a position in a YAML file
   */
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.Hover> {
    // Check if this is a pipeline YAML file
    if (!this.isPipelineYamlFile(document)) {
      return null;
    }

    // Get the word at the position
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
      return null;
    }

    const word = document.getText(range);
    const lineText = document.lineAt(position.line).text;

    // Extract field name from YAML structure
    const fieldName = this.extractFieldName(lineText, position.character);
    if (!fieldName) {
      return null;
    }

    // Get field information
    const fieldInfo = this.fieldDescriptions[fieldName];
    if (!fieldInfo) {
      // Try to find agent-specific information
      if (fieldName === 'agent' && word) {
        return this.createAgentHover(word);
      }
      return null;
    }

    // Create markdown hover content
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${fieldName}**\n\n`);
    markdown.appendMarkdown(`${fieldInfo.description}\n\n`);
    markdown.appendMarkdown(`*Type:* ${fieldInfo.type}\n`);
    
    if (fieldInfo.required) {
      markdown.appendMarkdown(`*Required:* Yes\n`);
    }
    
    if (fieldInfo.enumValues && fieldInfo.enumValues.length > 0) {
      markdown.appendMarkdown(`*Values:* ${fieldInfo.enumValues.join(', ')}\n`);
    }
    
    if (fieldInfo.example) {
      markdown.appendMarkdown(`*Example:* \`${fieldInfo.example}\`\n`);
    }

    return new vscode.Hover(markdown);
  }

  /**
   * Check if the document is a pipeline YAML file
   */
  private isPipelineYamlFile(document: vscode.TextDocument): boolean {
    const filePath = document.fileName;
    
    // Check if file is in .acp/pipelines directory
    if (filePath.includes(path.sep + '.acp' + path.sep + 'pipelines' + path.sep)) {
      return true;
    }
    
    // Check if file name matches pipeline patterns
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
      const dir = path.dirname(filePath);
      if (dir.includes(path.sep + '.acp' + path.sep + 'pipelines') || 
          dir.includes('.acp/pipelines')) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Extract field name from YAML line
   */
  private extractFieldName(lineText: string, character: number): string | null {
    // Remove leading whitespace
    const trimmedLine = lineText.trim();
    
    // Skip comments
    if (trimmedLine.startsWith('#')) {
      return null;
    }

    // Match YAML field pattern: field: or field:
    const fieldMatch = lineText.match(/^(\s*)(\w+):/);
    if (fieldMatch) {
      const fieldStart = fieldMatch.index! + fieldMatch[1].length;
      const fieldEnd = fieldStart + fieldMatch[2].length;
      
      // Check if the hover position is over the field name
      if (character >= fieldStart && character <= fieldEnd) {
        return fieldMatch[2];
      }
    }

    // Check for nested fields (e.g., primitives.agent)
    const nestedMatch = lineText.match(/^(\s*)(\w+)\.(\w+):/);
    if (nestedMatch) {
      const fieldStart = nestedMatch.index! + nestedMatch[1].length;
      const fullField = `${nestedMatch[2]}.${nestedMatch[3]}`;
      const fieldEnd = fieldStart + fullField.length;
      
      if (character >= fieldStart && character <= fieldEnd) {
        return fullField;
      }
      
      // Check if hovering over parent or child
      const parentStart = fieldStart;
      const parentEnd = parentStart + nestedMatch[2].length;
      if (character >= parentStart && character <= parentEnd) {
        return nestedMatch[2];
      }
      
      const childStart = parentEnd + 1; // +1 for the dot
      const childEnd = childStart + nestedMatch[3].length;
      if (character >= childStart && character <= childEnd) {
        return nestedMatch[3];
      }
    }

    // Check for step definitions
    const stepMatch = lineText.match(/^(\s*)-\s*(\w+):/);
    if (stepMatch) {
      const dashPos = stepMatch.index! + stepMatch[1].length;
      const fieldStart = dashPos + 2; // - and space
      const fieldEnd = fieldStart + stepMatch[2].length;
      
      if (character >= fieldStart && character <= fieldEnd) {
        return stepMatch[2];
      }
    }

    return null;
  }

  /**
   * Create hover for agent field with specific agent information
   */
  private createAgentHover(agentName: string): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    
    // Agent-specific descriptions
    const agentDescriptions: Record<string, { role: string; description: string }> = {
      'Vibe': {
        role: 'Orchestrateur de tâches ACP',
        description: 'Mistral AI agent capable of code generation, analysis, and task orchestration.',
      },
      'Codex CLI': {
        role: 'Agent CLI de Codex',
        description: 'OpenAI Codex command-line agent for code generation and manipulation.',
      },
      'Pi Sandcastle': {
        role: 'Agent Sandcastle de Pi',
        description: 'Inflection Pi agent with Sandcastle integration for safe code execution.',
      },
      'Cursor Sandcastle': {
        role: 'Agent Sandcastle de Cursor',
        description: 'Cursor AI agent with Sandcastle for isolated workspace operations.',
      },
      'Codex Sandcastle': {
        role: 'Agent Sandcastle de Codex',
        description: 'Codex agent with Sandcastle for secure code execution environments.',
      },
    };

    const agentInfo = agentDescriptions[agentName] || {
      role: 'AI Agent',
      description: 'Generic ACP-compatible AI agent.',
    };

    markdown.appendMarkdown(`**Agent: ${agentName}**\n\n`);
    markdown.appendMarkdown(`*Role:* ${agentInfo.role}\n\n`);
    markdown.appendMarkdown(`${agentInfo.description}\n`);
    
    if (agentName === 'Vibe') {
      markdown.appendMarkdown(`\n[Documentation](https://mistral.ai)`);
    }

    return new vscode.Hover(markdown);
  }

  /**
   * Dispose the provider
   */
  dispose(): void {
    // Nothing to dispose
  }
}
