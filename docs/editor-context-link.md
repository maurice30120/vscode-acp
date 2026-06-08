# Editor Context Link

## Summary

Editor Context Link lets users include the current VS Code editor context in ACP chat prompts.

When enabled, the extension captures the context at send time and prefixes the user prompt with:

- the active file path;
- the cursor position;
- the selected text, when there is a selection;
- otherwise, the current line;
- the list of open file tabs.

Only paths are listed for open editors. Their contents are not sent.

## User Experience

The Chat view title bar shows a `$(link)` icon next to the existing `$(attach)` file attachment icon.

- Disabled by default.
- Clicking the icon toggles editor context linking on or off.
- The state is persisted in VS Code workspace state.
- Context is injected only when a prompt is sent.

The chat input stays unchanged. Users type a normal message; the extension enriches the prompt before sending it to the ACP agent.

## Prompt Format

### With Selected Text

````text
VS Code context:
File: /absolute/path/to/src/example.ts
Cursor: 42:7
Selection: 40:1-43:12

```ts
const value = computeTotal(items);
return value;
```

Open editors:
- /absolute/path/to/src/example.ts
- /absolute/path/to/src/other.ts
- /absolute/path/to/package.json

User prompt:
Explain this code.
````

### Without Selected Text

````text
VS Code context:
File: /absolute/path/to/src/example.ts
Cursor: 42:7
Line: 42

```ts
const value = computeTotal(items);
```

Open editors:
- /absolute/path/to/src/example.ts
- /absolute/path/to/src/other.ts
- /absolute/path/to/package.json

User prompt:
Explain this line.
````

### No Active Editor

If linking is enabled but there is no active text editor, the prompt is sent unchanged and the chat shows a non-blocking error:

```text
No active VS Code editor context.
```

## Implementation

`src/ui/EditorContext.ts` contains the context logic:

- `captureEditorContext(editor, openEditors)` captures the active editor context;
- `captureOpenEditorPaths(tabGroups)` extracts local file paths from open VS Code tabs;
- `normalizeOpenEditorPaths(paths)` removes duplicates while preserving order;
- `buildEditorContextSection(context)` formats the context block;
- `buildPromptWithEditorContext(prompt, context)` prefixes the user prompt.

`src/ui/ChatWebviewProvider.ts` sends the final prompt. It receives a `getEditorContext` callback from `extension.ts`, so the webview provider does not directly read VS Code global editor state.

`src/extension.ts` owns the toggle command:

- command: `acp.toggleEditorContextLink`;
- state key: `acp.editorContextLinked`;
- storage: `context.workspaceState`;
- toolbar placement: `view/title` for `acp-chat`.

## Tests

`src/test/EditorContext.test.ts` covers:

- formatting selected text context;
- formatting current-line context;
- formatting the `Open editors` section;
- deduplicating open editor paths while preserving order;
- leaving prompts unchanged when context is null;
- using the file extension, such as `.ts`, as the Markdown code block language.
