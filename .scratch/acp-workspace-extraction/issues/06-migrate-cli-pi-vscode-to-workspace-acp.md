# 06 — Migrate CLI, Pi and VS Code to Workspace ACP

**What to build:** `pipeline-cli`, `plugin-pi` and `plugin-vscode` all consume `acp-workspace` for workspace loading, catalogues, runtime composition and connector selection while keeping their own interface adapters.

**Blocked by:** 05 — Extract WorkspaceRuntime composition.

**Status:** resolved

- [x] `pipeline-cli` loads agents, pipelines, skills and runtime composition through `acp-workspace`.
- [x] `plugin-pi` loads agents, pipelines, skills and runtime composition through `acp-workspace`.
- [x] `plugin-vscode` loads agents, pipelines, skills and runtime composition through `acp-workspace`.
- [x] VS Code agent configuration writes use `acp-workspace` for write, upsert and remove behavior.
- [x] CLI terminal prompts, VS Code commands and webviews, Pi commands, permission presentation and telemetry remain in their host adapters.
- [x] Package-level tests for CLI, Pi and VS Code pass with the migrated seams.

