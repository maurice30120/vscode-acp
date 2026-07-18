# Grill → Skeleton → TDD

Start the workflow from Pi:

```text
/pipeline run grill-skeleton-tdd <request>
```

The planner asks one question at a time. Answer each question with:

```text
/pipeline answer <response>
```

When the planner returns a decision-complete plan, review it and continue with:

```text
/pipeline approve
```

After approval, the pipeline creates a compilable structural skeleton without business logic, then writes focused unit tests that should fail because the behavior is intentionally unimplemented.
