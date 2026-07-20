---
name: skeleton-first-development
description: Build and review a compilable structural skeleton before implementing business logic.
---

# Skeleton-First Development

Create only the structural shape approved in the plan.

## Allowed work

- directories and files
- modules and exports
- interfaces, types, enums, and schemas
- classes, constructors, and dependency boundaries
- public functions and method signatures
- dependency injection wiring
- explicit TODOs or `NotImplemented` failures
- minimal build fixes required for type-checking or compilation

## Forbidden work

- business logic
- hidden fallback behavior
- speculative abstractions not present in the approved plan
- production behavior added only to make future tests pass
- unit, integration, or end-to-end tests

## Quality bar

- Respect existing project conventions and ADRs.
- Keep public seams small and explicit.
- Prefer dependency boundaries that can be tested without private access.
- Do not leave syntax, import, or type errors when a validation command exists.
- Report every created public seam and every intentionally unimplemented body.

The result should make architecture review possible before implementation begins.
