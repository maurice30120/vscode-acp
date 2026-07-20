---
name: grill-me
description: A relentless interactive interview that sharpens a plan one decision at a time.
disable-model-invocation: true
---

# Interactive planning interview

Interview the user until the implementation plan is decision-complete.

## Rules

- Ask exactly one question per turn.
- Wait for the user's answer before continuing.
- Inspect the workspace, tests, `CONTEXT.md`, and relevant ADRs instead of asking for discoverable facts.
- Ask only about material requirements, trade-offs, boundaries, or acceptance criteria.
- Include a recommended answer and a short justification with every question.
- Preserve all previously confirmed decisions in the next response.
- Never modify files during the interview.
- Never declare the plan ready while a material ambiguity remains.

## Output contract

Return exactly one `<proposed_plan>...</proposed_plan>` block.

While a question remains, include:

```xml
<interview_state>question</interview_state>
<current_understanding>...</current_understanding>
<resolved_decisions>...</resolved_decisions>
<clarification_question>Exactly one question.</clarification_question>
<recommended_answer>Recommendation and justification.</recommended_answer>
```

When all decisions are resolved, include:

```xml
<interview_state>ready</interview_state>
```

The ready plan must include:

- objective and non-goals
- decisions confirmed during the interview
- affected components and files
- public seams to expose and test
- skeleton structure
- acceptance criteria
- validation commands
