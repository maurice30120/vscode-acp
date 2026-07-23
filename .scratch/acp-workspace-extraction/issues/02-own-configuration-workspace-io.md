# 02 — Move Configuration workspace I/O into Workspace ACP

**What to build:** Workspace ACP becomes the shared public seam for reading, parsing, writing, upserting and removing agent configuration entries while preserving the existing native ACP and Sandcastle file formats.

**Blocked by:** 01 — Create the public Workspace ACP package.

**Status:** resolved

- [x] `acp-workspace` reads native ACP agent configuration from the existing `.acp/acp-agents.json` format.
- [x] `acp-workspace` reads Sandcastle agent configuration from the existing `.acp/.sandcastle/config.json` format.
- [x] `writeAgentConfigs`, `upsertAgentConfig` and `removeAgentConfig` behavior is available through `acp-workspace`.
- [x] Writes preserve native and Sandcastle configuration separation and do not introduce a new Configuration workspace format.
- [x] Configuration workspace tests cover read, parse, write, upsert and remove behavior through the `acp-workspace` public exports.

