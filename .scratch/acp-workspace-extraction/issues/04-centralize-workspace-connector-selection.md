# 04 — Centralize workspace connector selection

**What to build:** Workspace ACP owns the Sélection de connecteur workspace so a configured agent resolves to the same native ACP or Sandcastle connector on every surface hôte.

**Blocked by:** 03 — Publish Workspace ACP catalogues.

**Status:** resolved

- [x] `acp-workspace` resolves representative native ACP agent configurations to the native connector path.
- [x] `acp-workspace` resolves representative Sandcastle agent configurations to the Sandcastle connector path.
- [x] Sandcastle bridge, provider, environment, promotion, worktree, log and connector primitives remain owned by `acp-sandcastle`.
- [x] Host packages do not need local Sandcastle selection branches to choose an effective connector.
- [x] Selection tests prove native ACP and Sandcastle resolution from representative Configuration workspace fixtures through the `acp-workspace` public seam.

