
declare module 'typebox' {
  export const Type: {
    Object(properties: Record<string, unknown>, options?: Record<string, unknown>): unknown;
    Optional(schema: unknown): unknown;
    String(options?: Record<string, unknown>): unknown;
  };
}

declare module '@earendil-works/pi-coding-agent' {
  export interface AutocompleteItem {
    value: string;
    label?: string;
  }

  export interface ExtensionUIDialogOptions {
    signal?: AbortSignal;
    timeout?: number;
  }

  export interface ExtensionUIContext {
    select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
    confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean>;
    input(title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined>;
    notify(message: string, type?: 'info' | 'warning' | 'error'): void;
  }

  export interface ExtensionContext {
    cwd: string;
    hasUI: boolean;
    ui: ExtensionUIContext;
  }

  export interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;
  }

  export interface ExtensionAPI {
    on(
      event: 'session_start',
      handler: (event: { type: 'session_start' }, ctx: ExtensionContext) => void | Promise<void>,
    ): void;
    on(
      event: 'session_shutdown',
      handler: (event: { type: 'session_shutdown' }, ctx: ExtensionContext) => void | Promise<void>,
    ): void;
    registerCommand(
      name: string,
      options: {
        description?: string;
        getArgumentCompletions?: (argumentPrefix: string) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ): void;
    registerTool(tool: {
      name: string;
      label: string;
      description: string;
      promptSnippet?: string;
      parameters: unknown;
      execute(
        toolCallId: string,
        params: any,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: ExtensionContext,
      ): Promise<{ content: Array<{ type: 'text'; text: string }>; details?: unknown }>;
    }): void;
    sendMessage(
      message: {
        customType: string;
        content: string | Array<unknown>;
        display: boolean;
        details?: unknown;
      },
      options?: unknown,
    ): void;
  }
}
