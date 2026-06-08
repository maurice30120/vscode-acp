import * as path from 'path';
import * as vscode from 'vscode';

export type EditorSelectionContext = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
};

export type EditorLineContext = {
  line: number;
  text: string;
};

export type EditorContext = {
  filePath: string;
  cursorLine: number;
  cursorCharacter: number;
  language: string;
  selection: EditorSelectionContext | null;
  currentLine: EditorLineContext | null;
  openEditors: string[];
};

export function captureEditorContext(
  editor: vscode.TextEditor | undefined,
  openEditors: string[] = [],
): EditorContext | null {
  if (!editor?.document?.uri) {
    return null;
  }

  const { document, selection } = editor;

  return {
    filePath: document.uri.fsPath,
    cursorLine: selection.active.line + 1,
    cursorCharacter: selection.active.character + 1,
    language: getMarkdownLanguage(document.uri.fsPath, document.languageId),
    selection: selection.isEmpty
      ? null
      : {
          startLine: selection.start.line + 1,
          startCharacter: selection.start.character + 1,
          endLine: selection.end.line + 1,
          endCharacter: selection.end.character + 1,
          text: document.getText(selection),
        },
    currentLine: selection.isEmpty
      ? {
          line: selection.active.line + 1,
          text: document.lineAt(selection.active.line).text,
        }
      : null,
    openEditors: normalizeOpenEditorPaths(openEditors),
  };
}

export function captureOpenEditorPaths(tabGroups: readonly vscode.TabGroup[]): string[] {
  const paths: string[] = [];

  for (const group of tabGroups) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file') {
        paths.push(tab.input.uri.fsPath);
      }
    }
  }

  return normalizeOpenEditorPaths(paths);
}

export function normalizeOpenEditorPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const filePath of paths) {
    if (!filePath || seen.has(filePath)) {
      continue;
    }

    seen.add(filePath);
    normalized.push(filePath);
  }

  return normalized;
}

export function buildEditorContextSection(context: EditorContext | null): string {
  if (!context) {
    return '';
  }

  const locationLine = context.selection
    ? `Selection: ${context.selection.startLine}:${context.selection.startCharacter}-${context.selection.endLine}:${context.selection.endCharacter}`
    : `Line: ${context.currentLine?.line ?? context.cursorLine}`;
  const contextText = context.selection?.text ?? context.currentLine?.text ?? '';

  const lines = [
    'VS Code context:',
    `File: ${context.filePath}`,
    `Cursor: ${context.cursorLine}:${context.cursorCharacter}`,
    locationLine,
    '',
    `\`\`\`${context.language}`,
    contextText,
    '```',
  ];

  if (context.openEditors.length > 0) {
    lines.push('', 'Open editors:', ...context.openEditors.map(filePath => `- ${filePath}`));
  }

  return lines.join('\n');
}

export function buildPromptWithEditorContext(prompt: string, context: EditorContext | null): string {
  const contextSection = buildEditorContextSection(context);
  if (!contextSection) {
    return prompt;
  }

  return `${contextSection}\n\nUser prompt:\n${prompt}`;
}

function getMarkdownLanguage(filePath: string, languageId: string): string {
  const extension = path.extname(filePath).replace(/^\./, '');
  return extension || languageId || '';
}
