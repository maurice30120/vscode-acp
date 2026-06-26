const Module = require('module');

const originalRequire = Module.prototype.require;

Module.prototype.require = function mockVscodeRequire(id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key, defaultValue) => defaultValue,
        }),
        workspaceFolders: undefined,
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => {},
        }),
        showInformationMessage: async () => undefined,
      },
      commands: {
        executeCommand: async () => undefined,
      },
      Uri: {
        file: (fsPath) => ({ fsPath }),
      },
      extensions: {
        getExtension: () => undefined,
      },
    };
  }
  return originalRequire.apply(this, arguments);
};
