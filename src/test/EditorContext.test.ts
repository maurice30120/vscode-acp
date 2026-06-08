import * as assert from 'assert';

import {
  buildEditorContextSection,
  buildPromptWithEditorContext,
  captureEditorContext,
  normalizeOpenEditorPaths,
  type EditorContext,
} from '../ui/EditorContext';

suite('EditorContext', () => {
  test('formats selection context with file section', () => {
    const context: EditorContext = {
      filePath: '/workspace/src/example.ts',
      cursorLine: 42,
      cursorCharacter: 7,
      language: 'ts',
      selection: {
        startLine: 40,
        startCharacter: 1,
        endLine: 43,
        endCharacter: 12,
        text: 'const value = 1;',
      },
      currentLine: null,
      openEditors: [],
    };

    assert.strictEqual(
      buildEditorContextSection(context),
      [
        'VS Code context:',
        'File: /workspace/src/example.ts',
        'Cursor: 42:7',
        'Selection: 40:1-43:12',
        '',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n'),
    );
  });

  test('formats current line context when there is no selection', () => {
    const context: EditorContext = {
      filePath: '/workspace/src/example.ts',
      cursorLine: 42,
      cursorCharacter: 7,
      language: 'ts',
      selection: null,
      currentLine: {
        line: 42,
        text: 'return value;',
      },
      openEditors: [],
    };

    assert.strictEqual(
      buildEditorContextSection(context),
      [
        'VS Code context:',
        'File: /workspace/src/example.ts',
        'Cursor: 42:7',
        'Line: 42',
        '',
        '```ts',
        'return value;',
        '```',
      ].join('\n'),
    );
  });

  test('does not prefix a prompt when context is null', () => {
    assert.strictEqual(buildPromptWithEditorContext('hello', null), 'hello');
  });

  test('formats open editors after active editor context', () => {
    const context: EditorContext = {
      filePath: '/workspace/src/foo.ts',
      cursorLine: 42,
      cursorCharacter: 7,
      language: 'ts',
      selection: null,
      currentLine: {
        line: 42,
        text: 'const value = computeTotal(items);',
      },
      openEditors: [
        '/workspace/src/foo.ts',
        '/workspace/src/bar.ts',
        '/workspace/package.json',
      ],
    };

    assert.strictEqual(
      buildEditorContextSection(context),
      [
        'VS Code context:',
        'File: /workspace/src/foo.ts',
        'Cursor: 42:7',
        'Line: 42',
        '',
        '```ts',
        'const value = computeTotal(items);',
        '```',
        '',
        'Open editors:',
        '- /workspace/src/foo.ts',
        '- /workspace/src/bar.ts',
        '- /workspace/package.json',
      ].join('\n'),
    );
  });

  test('deduplicates open editor paths while preserving order', () => {
    assert.deepStrictEqual(
      normalizeOpenEditorPaths([
        '/workspace/src/foo.ts',
        '/workspace/src/bar.ts',
        '/workspace/src/foo.ts',
        '',
        '/workspace/package.json',
        '/workspace/src/bar.ts',
      ]),
      [
        '/workspace/src/foo.ts',
        '/workspace/src/bar.ts',
        '/workspace/package.json',
      ],
    );
  });

  test('uses file extension as markdown language when capturing context', () => {
    const editor = {
      document: {
        uri: { fsPath: '/workspace/src/example.ts' },
        languageId: 'typescript',
        lineAt: () => ({ text: 'type Example = string;' }),
      },
      selection: {
        active: { line: 0, character: 0 },
        isEmpty: true,
      },
    };

    const context = captureEditorContext(editor as any);

    assert.ok(context);
    assert.strictEqual(context.language, 'ts');
    assert.deepStrictEqual(context.openEditors, []);
    assert.ok(buildEditorContextSection(context).includes('```ts\n'));
  });
});
