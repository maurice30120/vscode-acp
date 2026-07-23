# 08 — Lock host parity release state

**What to build:** The final integrated state proves Parité hôte for a representative Configuration workspace across CLI, Pi and VS Code, and verifies there is no supported partial migration state.

**Blocked by:** 06 — Migrate CLI, Pi and VS Code to Workspace ACP; 07 — Remove runtime workspace exports and guard imports.

**Status:** resolved

- [x] A shared representative Configuration workspace fixture exercises native ACP agents, Sandcastle agents, Pipeline V3 definitions and skills across the three host surfaces.
- [x] Host parity tests assert the same observable workspace behavior for CLI, Pi and VS Code while ignoring UI-specific presentation.
- [x] Full workspace tests include `acp-workspace`, `acp-runtime`, `acp-pipeline`, `acp-sandcastle`, `pipeline-cli`, `plugin-pi` and `plugin-vscode`.
- [x] Documentation or release notes for this feature point maintainers to `acp-workspace` as the public composition root and do not describe a partial migration path.
- [x] The final validation command proves all affected package tests pass together.

