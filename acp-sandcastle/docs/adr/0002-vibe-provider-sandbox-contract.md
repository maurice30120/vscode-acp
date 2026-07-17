# ADR-0002 : Vibe provider sandbox contract

**Status**: Accepted

## Context

Vibe is used as a Sandcastle provider for implementation work. In non-interactive mode it is launched inside the sandbox and streams JSON events. Some Vibe runs emit assistant output in `reasoning_content` while leaving `content` empty.

Without a shared provider contract, consumers can disagree on whether a run produced assistant output. That creates pipeline failures where the agent worked and ran tools but the pipeline receives an empty step result.

## Decision

Sandcastle treats Vibe as a supported sandbox provider.

The provider contract is:

- Vibe runs with `vibe -p --output streaming --trust`.
- `VIBE_ACTIVE_MODEL` carries the configured model.
- `VIBE_HOME` inside the sandbox is `/home/agent/.vibe`.
- The host Vibe home is mounted or prepared as writable sandbox state.
- A Vibe assistant event emits text from `content` when present.
- If `content` is empty, `reasoning_content` is used as assistant text.
- Session identifiers emitted by Vibe are preserved as provider session metadata when available.

## Consequences

### Positive

- Vibe Sandcastle can be used consistently by VS Code and Pi.
- Pipelines do not treat reasoning-only Vibe responses as silent runs.
- Authentication and provider state are kept outside the repository tree while still being available inside the sandbox.

### Negative

- Consumers must keep their stream parsing aligned with this contract.
- Sandcastle images must include a working `vibe` executable for this provider to work.

### Neutral

- This does not require Vibe to be the only Sandcastle implementer.
- Consumers may still choose Codex, Cursor, or Pi providers for other workflows.
