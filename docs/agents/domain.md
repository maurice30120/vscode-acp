# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/architecture/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions are resolved.

## File structure

This is a single-context repo:

```text
/
├── CONTEXT.md
└── docs/
    └── architecture/
        └── adr/
```

The npm workspaces are surfaces and shared packages within the same ACP Orchestration context, not separate domain contexts.

## Use the glossary's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis or test name, use the term defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If a needed concept isn't in the glossary, reconsider whether the codebase uses that language or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface the contradiction explicitly rather than silently overriding it.
