import * as vscode from 'vscode';
import { PipelineMetadata, PipelineTreeItem } from './PipelineTypes';
import { PipelineParser } from './PipelineParser';

/**
 * Tree data provider for the ACP Pipeline View
 */
export class PipelineTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | null | undefined> = new vscode.EventEmitter();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | null | undefined> = this._onDidChangeTreeData.event;

  private pipelines: PipelineMetadata[] = [];
  private workspaceUri: string;
  private isLoading: boolean = false;
  private readonly watcher: vscode.FileSystemWatcher;

  constructor(workspaceUri: string) {
    this.workspaceUri = workspaceUri;
    this.loadPipelines();

    // Watch for changes in pipeline files
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceUri, '.acp/pipelines/**/*.{yaml,yml}'),
    );

    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.refresh());
  }

  /**
   * Load pipelines from the workspace
   */
  async loadPipelines(): Promise<void> {
    this.isLoading = true;
    try {
      this.pipelines = await PipelineParser.parseAllPipelines(this.workspaceUri);
      this._onDidChangeTreeData.fire(null);
    } catch (error) {
      console.error('Error loading pipelines:', error);
      vscode.window.showErrorMessage(`Failed to load pipelines: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this.loadPipelines();
  }

  /**
   * Get tree items for a given element
   */
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for a given element or root
   */
  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (this.isLoading) {
      return Promise.resolve([new vscode.TreeItem('Loading pipelines...')]);
    }

    if (!element) {
      // Root level: return all pipelines
      if (this.pipelines.length === 0) {
        const noPipelinesItem = new vscode.TreeItem('No pipelines found');
        noPipelinesItem.description = 'Add pipeline files to .acp/pipelines/';
        noPipelinesItem.iconPath = new vscode.ThemeIcon('alert');
        return Promise.resolve([noPipelinesItem]);
      }

      return Promise.resolve(
        this.pipelines.map(pipeline => 
          new PipelineTreeItem(pipeline, vscode.TreeItemCollapsibleState.None)
        )
      );
    }

    return Promise.resolve([]);
  }

  /**
   * Get parent of an element (not used for flat tree)
   */
  getParent?(_element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
    return null;
  }

  /**
   * Resolve tree item (for lazy loading)
   */
  resolveTreeItem?(
    _item: vscode.TreeItem,
    _element: vscode.TreeItem,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.TreeItem> {
    return null;
  }

  /**
   * Get pipelines list
   */
  getPipelines(): PipelineMetadata[] {
    return [...this.pipelines];
  }

  /**
   * Get pipeline by ID
   */
  getPipelineById(id: string): PipelineMetadata | undefined {
    return this.pipelines.find(p => p.id === id);
  }

  /**
   * Show pipeline selector
   */
  async showPipelineSelector(): Promise<string | undefined> {
    const pipelines = this.getPipelines();
    
    if (pipelines.length === 0) {
      vscode.window.showInformationMessage('No pipelines found to run');
      return undefined;
    }

    const items = pipelines.map(pipeline => ({
      label: pipeline.title || pipeline.id,
      description: pipeline.filePath,
      pipelineId: pipeline.id,
    }));

    const result = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select pipeline to run',
      title: 'Run ACP Pipeline',
    });

    return result?.pipelineId;
  }

  /**
   * Dispose the provider
   */
  dispose(): void {
    this.watcher.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
