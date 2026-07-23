# 01 — Create the public Workspace ACP package

**What to build:** `acp-workspace` exists as a public monorepo package with build, test and export conventions aligned with the existing ACP packages, so consumers can import the Workspace ACP API through normal workspace dependency resolution.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `acp-workspace` is listed in the root workspace configuration and can be installed, built and tested like the other root ACP packages.
- [x] The package exposes a minimal public entry point for Workspace ACP contracts without moving host UI responsibilities into the package.
- [x] Package metadata and TypeScript configuration follow the local conventions used by `acp-runtime`, `acp-pipeline` and `acp-sandcastle`.
- [x] A package-level smoke test proves the public entry point can be imported.

