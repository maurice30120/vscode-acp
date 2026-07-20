Status: ready-for-agent

# Pipeline Agent Reflection Activity

## Problem Statement

When a Pipeline V3 runs through the VS Code surface hôte, users can see the broad pipeline timeline and final role outputs, but the UI does not clearly show that a non-planner agent is currently reflecting before producing output. The available `agent_thought_chunk` stream is either treated like ordinary chat thought content or ignored for the pipeline projection, which makes the workflow feel stalled while an implementer, reviewer, tester, or other role is actively working.

The user does not want a CLI visualization or a verbose trace. They want the UI to follow agent reflections cleanly with minimal information. The content of agent thoughts must not be exposed. Reflection activity is only a transient UI signal, not durable orchestration state.

## Solution

Add a compact, local-only activity indicator to the VS Code webview pipeline UI. When a non-planner pipeline role emits an `agent_thought_chunk`, the webview shows a short activity line identifying the role and, when available, the agent name. The line does not include the thought text. As soon as that role starts emitting `agent_message_chunk`, the activity indicator disappears because concrete output is now visible.

The CLI remains unchanged. The runtime partagé and durable OrchestrationState remain the source of truth for pipeline status, plans, and role outputs; reflection activity stays inside the current webview state and is not restored after reload or synchronized to other webviews.

## User Stories

1. As a VS Code user, I want to see that the current pipeline agent is reflecting, so that I know the pipeline is still progressing.
2. As a VS Code user, I want the reflection signal to be minimal, so that the pipeline UI does not become noisy.
3. As a VS Code user, I want the UI to show which pipeline role is active, so that I can understand where the workflow is.
4. As a VS Code user, I want the UI to show the agent name when available, so that I can distinguish between configured agents for the same role.
5. As a VS Code user, I want reflection text to stay hidden, so that internal agent reasoning is not exposed in the pipeline UI.
6. As a VS Code user, I want the indicator to disappear when output starts, so that stale activity does not compete with real results.
7. As a VS Code user, I want reloads to avoid restoring old reflection activity, so that the UI does not claim an agent is still thinking after the fact.
8. As a VS Code user, I want other webviews to avoid receiving ephemeral reflection state, so that orchestration state remains stable and meaningful.
9. As a pipeline user, I want planner behavior to remain unchanged, so that existing planning draft and thought handling keeps working.
10. As a pipeline user, I want approvals and role outputs to keep their current behavior, so that the activity indicator does not affect control flow.
11. As a pipeline user, I want no new CLI flags, so that the command-line contract remains simple and scriptable.
12. As a maintainer, I want reflection activity mapped at the existing session update seam, so that we do not add a parallel event system.
13. As a maintainer, I want durable OrchestrationState to exclude transient activity, so that persisted state only contains restorable orchestration facts.
14. As a maintainer, I want tests around external behavior, so that implementation details can change without breaking the contract.
15. As a maintainer, I want the current staged prototype reconciled with the locked plan, so that the final implementation does not accidentally persist activity.

## Implementation Decisions

- Use the existing session update mapping seam as the primary integration point. Pipeline session updates already carry role, phase, agent name, and agent id metadata into the webview.
- Treat `agent_thought_chunk` for non-planner pipeline phases as an activity signal only. Do not copy the thought text into pipeline activity state.
- Keep planner thought behavior unchanged. Planner updates may continue to feed the existing planning and thought UI because planning has separate behavior in the current webview model.
- Introduce local webview state for pipeline activity. This state should live in the in-memory AppState shape and must not be included in the persisted shared state or persisted orchestration state.
- Clear local pipeline activity when a non-planner pipeline `agent_message_chunk` arrives, because visible output replaces the need for a thinking signal.
- Keep OrchestrationState focused on durable pipeline projection: timeline, active role, active agent, pending plan, and completed role outputs. Do not add reflection activity to this shared state.
- Render the activity as a single compact line near the pipeline timeline. The line should identify the role and agent name when known, using fixed text such as “thinking” or “réfléchit”, not the thought content.
- Do not change the CLI run, list, JSON, verbose, or approval behavior.
- The staged prototype should be revised before completion: remove the persisted `activity` field from OrchestrationState and avoid using thought text as the displayed activity text.

## Testing Decisions

- Test the highest existing seam: host message routing from a normalized `sessionUpdate` into webview actions. This validates the behavior users depend on without binding tests to component internals.
- Add or update tests showing that a non-planner pipeline `agent_thought_chunk` maps to a local activity action with role and agent identity but without the original thought text.
- Add or update tests showing that a non-planner pipeline `agent_message_chunk` maps to normal assistant output and clears pipeline activity.
- Add or update tests showing that planner thought chunks continue to use the existing thought handling behavior.
- Add or update state serialization tests showing that pipeline activity is not present in persisted shared state or OrchestrationState snapshots.
- Prior art exists in the webview host message router tests for mapping `sessionUpdate` messages into app actions, and in webview app state tests for hydration and persistence behavior.
- Good tests should assert user-visible contracts: activity appears, does not leak thought text, clears on output, and is not restored. They should not assert reducer internals beyond the public action/state seam already used by the webview tests.

## Out of Scope

- Adding a CLI visualization mode.
- Adding or changing Pipeline V3 runtime events.
- Persisting reflection activity in workspace, shared webview state, or OrchestrationState.
- Showing raw thought content, summaries of thought content, or markdown-rendered thought content in the pipeline activity line.
- Reworking the pipeline timeline, approval UI, role output blocks, or planner draft behavior.
- Creating a full event log, trace viewer, or debug panel for pipeline execution.

## Further Notes

The current worktree already contains a staged prototype that points in the right UI direction but does not match the locked plan in two important ways: it adds activity to persisted OrchestrationState, and it displays compacted thought text. The implementation should reuse any useful component or routing structure from that prototype only after changing those behaviors to match this spec.

