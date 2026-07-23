# 05 — Extract WorkspaceRuntime composition

**What to build:** Workspace ACP composes a workspace-level runtime from `workspaceCwd` and an Adapter hôte contract, while `acp-runtime` receives low-level execution dependencies by injection.

**Blocked by:** 04 — Centralize workspace connector selection.

**Status:** resolved

- [x] `acp-workspace` exposes a WorkspaceRuntime composition API that takes workspace location and host-provided dependencies.
- [x] The host contract covers permission context, logging, Sandcastle promotion decisions and required callbacks without taking ownership of terminal, editor or Pi UI.
- [x] `acp-runtime` no longer needs to read `.acp`, know the workspace path, load pipelines or skills, or select Sandcastle to execute ACP work.
- [x] Low-level ACP runtime tests prove execution works with injected dependencies.
- [x] WorkspaceRuntime composition tests use doubles for the Adapter hôte contract, permission context, logger and Sandcastle promotion callbacks.

