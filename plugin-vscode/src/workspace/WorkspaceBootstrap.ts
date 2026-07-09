import * as path from 'node:path';

import * as vscode from 'vscode';

import { normalizeWorkspaceKey, resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { log, logError } from '../utils/Logger';
import {
  readWorkspaceStarterManifest,
  resolveWorkspaceStarterRoot,
  syncWorkspaceStarterCore,
  type WorkspaceBootstrapOptions,
  type WorkspaceBootstrapResult,
} from './WorkspaceBootstrapCore';

export type { WorkspaceBootstrapOptions, WorkspaceBootstrapResult } from './WorkspaceBootstrapCore';

const GLOBAL_STATE_PREFIX = 'acp.workspaceBootstrap.v1::';

function extensionRootPath(extensionRoot: string | vscode.Uri): string {
  return typeof extensionRoot === 'string' ? path.resolve(extensionRoot) : extensionRoot.fsPath;
}

export async function syncWorkspaceStarter(
  extensionRoot: string | vscode.Uri,
  workspaceCwd: string,
  options?: WorkspaceBootstrapOptions,
): Promise<WorkspaceBootstrapResult> {
  const result = await syncWorkspaceStarterCore(extensionRootPath(extensionRoot), workspaceCwd, options);
  for (const warning of result.warnings) {
    if (warning.startsWith('Failed to copy')) {
      logError(warning);
    } else {
      log(warning);
    }
  }
  if (result.created.length > 0) {
    log(`Workspace bootstrap created ${result.created.length} file(s) in ${workspaceCwd}`);
  }
  return result;
}

export function collectBootstrapWorkspaceCwds(): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const cwds = folders.map(folder => folder.uri.fsPath);
  if (cwds.length === 0) {
    cwds.push(resolveWorkspaceIdentity().cwd);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const cwd of cwds) {
    const key = normalizeWorkspaceKey(cwd);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(path.resolve(cwd));
  }
  return unique;
}

function getBootstrapSettings(): {
  enabled: boolean;
  autoOnActivation: boolean;
  includePipelineArchive: boolean;
} {
  const config = vscode.workspace.getConfiguration('acp');
  return {
    enabled: config.get<boolean>('workspaceBootstrap.enabled', true),
    autoOnActivation: config.get<boolean>('workspaceBootstrap.autoOnActivation', true),
    includePipelineArchive: config.get<boolean>('workspaceBootstrap.includePipelineArchive', false),
  };
}

export async function bootstrapWorkspaceFolders(
  context: vscode.ExtensionContext,
  options?: WorkspaceBootstrapOptions,
): Promise<WorkspaceBootstrapResult[]> {
  const settings = getBootstrapSettings();
  if (!settings.enabled) {
    return [];
  }

  const includePipelineArchive = options?.includePipelineArchive ?? settings.includePipelineArchive;
  const results: WorkspaceBootstrapResult[] = [];
  const starterRoot = resolveWorkspaceStarterRoot(context.extensionUri.fsPath);
  const manifest = starterRoot ? readWorkspaceStarterManifest(starterRoot) : undefined;

  for (const cwd of collectBootstrapWorkspaceCwds()) {
    const result = await syncWorkspaceStarter(context.extensionUri, cwd, {
      ...options,
      includePipelineArchive,
    });
    results.push(result);

    if (manifest?.version) {
      await context.globalState.update(`${GLOBAL_STATE_PREFIX}${result.workspaceKey}`, manifest.version);
    }
  }

  return results;
}

function summarizeBootstrapResults(results: WorkspaceBootstrapResult[]): {
  created: number;
  warnings: string[];
} {
  let created = 0;
  const warnings: string[] = [];
  for (const result of results) {
    created += result.created.length;
    warnings.push(...result.warnings);
  }
  return { created, warnings };
}

export async function runWorkspaceBootstrapIfNeeded(context: vscode.ExtensionContext): Promise<void> {
  const settings = getBootstrapSettings();
  if (!settings.enabled || !settings.autoOnActivation) {
    return;
  }

  const results = await bootstrapWorkspaceFolders(context);
  const { created, warnings } = summarizeBootstrapResults(results);
  for (const warning of warnings) {
    log(warning);
  }

  if (created > 0) {
    const choice = await vscode.window.showInformationMessage(
      `ACP initialized ${created} workspace template file(s).`,
      'Show Log',
    );
    if (choice === 'Show Log') {
      await vscode.commands.executeCommand('acp.showLog');
    }
  }
}

export async function runWorkspaceBootstrapCommand(context: vscode.ExtensionContext): Promise<void> {
  const settings = getBootstrapSettings();
  if (!settings.enabled) {
    void vscode.window.showInformationMessage(
      'Workspace bootstrap is disabled. Enable acp.workspaceBootstrap.enabled to initialize templates.',
    );
    return;
  }

  const results = await bootstrapWorkspaceFolders(context);
  const { created, warnings } = summarizeBootstrapResults(results);
  const skipped = results.reduce((sum, result) => sum + result.skipped.length, 0);

  for (const warning of warnings) {
    log(warning);
  }

  if (created > 0) {
    const choice = await vscode.window.showInformationMessage(
      `ACP initialized ${created} workspace template file(s) (${skipped} already present).`,
      'Show Log',
    );
    if (choice === 'Show Log') {
      await vscode.commands.executeCommand('acp.showLog');
    }
  } else {
    void vscode.window.showInformationMessage(
      `Workspace templates are up to date (${skipped} file(s) already present).`,
    );
  }
}
