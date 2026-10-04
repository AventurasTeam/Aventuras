# Plan Writer Dispatch Template

Use this template when dispatching a plan writer for one batch (SKILL.md → Batched writing). The role (what to read, the interface rule, the self-review, the report) is the `aventuras-plan-writer` agent's definition, `.claude/agents/aventuras-plan-writer.md` (Opus, effort `xhigh`); this template is the per-batch part.

```
Dispatch the aventuras-plan-writer agent with:
  description: "Write plan Tasks [a]-[b]"
  prompt: |
    Plan: [absolute path to the plan file, holding the approved skeleton]
    Write: Tasks [a]-[b] ([their titles])
    To: [absolute path of <plan-stem>.batch-<K>.md, next to the plan]
    Files this batch shares with other batches: [from the Writer batches line, or "none"]
    Repository: [absolute path], at [HEAD_SHA]
```
