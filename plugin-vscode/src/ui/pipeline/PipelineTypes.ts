import * as vscode from 'vscode';

/**
 * Pipeline status types
 */
export type PipelineStatus = 'idle' | 'running' | 'failed' | 'completed' | 'pending';

/**
 * Step status types
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Pipeline metadata extracted from YAML files
 */
export interface PipelineMetadata {
  id: string;
  title: string;
  version: number;
  filePath: string;
  status: PipelineStatus;
  agent?: string;
  steps: PipelineStep[];
  lastRun?: Date;
  errorMessage?: string;
}

/**
 * Individual step in a pipeline
 */
export interface PipelineStep {
  id: string;
  type: string;
  use?: string;
  status: StepStatus;
  output?: string;
  agent?: string;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

/**
 * Tree item for pipeline view
 */
export class PipelineTreeItem extends vscode.TreeItem {
  constructor(
    public readonly pipeline: PipelineMetadata,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(pipeline.title || pipeline.id, collapsibleState);
    this.description = pipeline.id;
    this.tooltip = this.getTooltip();
    this.iconPath = this.getIconPath();
    this.command = {
      command: 'acp.pipeline.run',
      title: 'Open Pipeline Chat',
      arguments: [pipeline.id],
    };
  }

  private getTooltip(): string | vscode.MarkdownString {
    const statusIcon = this.getStatusIcon();
    const statusText = this.pipeline.status.charAt(0).toUpperCase() + this.pipeline.status.slice(1);
    
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${this.pipeline.title || this.pipeline.id}**\n`);
    markdown.appendMarkdown(`*Version: ${this.pipeline.version}*\n\n`);
    markdown.appendMarkdown(`**Status:** ${statusIcon} ${statusText}\n`);
    markdown.appendMarkdown(`**Agent:** ${this.pipeline.agent || 'N/A'}\n`);
    markdown.appendMarkdown(`**Steps:** ${this.pipeline.steps.length}\n`);
    markdown.appendMarkdown(`**File:** ${this.pipeline.filePath}\n`);
    
    if (this.pipeline.errorMessage) {
      markdown.appendMarkdown(`\n---\n`);
      markdown.appendMarkdown(`*Error: ${this.pipeline.errorMessage}*`);
    }
    
    return markdown;
  }

  private getIconPath(): vscode.ThemeIcon {
    switch (this.pipeline.status) {
      case 'running':
        return new vscode.ThemeIcon('loading~spin');
      case 'failed':
        return new vscode.ThemeIcon('error');
      case 'completed':
        return new vscode.ThemeIcon('check');
      case 'idle':
      default:
        return new vscode.ThemeIcon('gear');
    }
  }

  private getStatusIcon(): string {
    switch (this.pipeline.status) {
      case 'running':
        return '$(loading~spin)';
      case 'failed':
        return '$(error)';
      case 'completed':
        return '$(check)';
      case 'pending':
        return '$(clock)';
      case 'idle':
      default:
        return '$(gear)';
    }
  }

  contextValue = 'pipeline';
}

/**
 * YAML field information for tooltips
 */
export interface YamlFieldInfo {
  field: string;
  description: string;
  type: string;
  required?: boolean;
  enumValues?: string[];
  example?: string;
}

/**
 * Pipeline run information
 */
export interface PipelineRunInfo {
  pipelineId: string;
  startedAt: Date;
  completedAt?: Date;
  status: PipelineStatus;
  stepResults: Map<string, {
    status: StepStatus;
    output?: string;
    error?: string;
    durationMs?: number;
  }>;
  totalDurationMs?: number;
}
