# 07 — Remove runtime workspace exports and guard imports

**What to build:** Moved workspace APIs disappear from `@acp-client/runtime` with no deprecated compatibility layer, and regression checks prevent host packages or `acp-runtime` from reintroducing the old ownership boundary.

**Blocked by:** 06 — Migrate CLI, Pi and VS Code to Workspace ACP.

**Status:** resolved

- [x] Workspace loaders, catalogues and write APIs moved to `acp-workspace` are no longer exported by `@acp-client/runtime`.
- [x] No deprecated compatibility exports remain in `@acp-client/runtime` for moved Workspace ACP behavior.
- [x] Static checks or tests fail if `pipeline-cli`, `plugin-pi` or `plugin-vscode` import moved workspace loaders or catalogues from `@acp-client/runtime`.
- [x] Static checks or tests fail if `acp-runtime` imports workspace catalogues, pipeline catalogues, skill catalogues or Sandcastle selection logic.
- [x] Runtime package tests still cover low-level ACP behavior after the workspace exports are removed.

