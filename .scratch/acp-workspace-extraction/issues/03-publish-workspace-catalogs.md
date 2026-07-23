# 03 — Publish Workspace ACP catalogues

**What to build:** Workspace ACP exposes shared catalogues for configured agents, virtual agents, Pipeline V3 definitions and skills, so host surfaces stop owning divergent discovery behavior.

**Blocked by:** 02 — Move Configuration workspace I/O into Workspace ACP.

**Status:** resolved

- [x] Native ACP and Sandcastle agents are discovered through one `acp-workspace` public catalogue seam.
- [x] Pipeline V3 definitions are discovered through `acp-workspace` without changing the pipeline language.
- [x] Skills are discovered through `acp-workspace` without changing the existing `.acp/agents/` format.
- [x] Virtual agents are exposed through `acp-workspace` using the same effective Configuration workspace model as configured agents.
- [x] Catalogue tests cover native agents, Sandcastle agents, pipelines, skills, virtual agents and duplicate or ambiguous agent declarations through public exports.

