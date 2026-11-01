# Slice Writer Dispatch Template

Use this template when dispatching a slice writer (SKILL.md → Stage 7). The role (what to read, the contract rule, the self-review, the report) is the `aventuras-slice-writer` agent's definition, `.claude/agents/aventuras-slice-writer.md` (Opus, effort `xhigh`); this template is the per-slice part.

```
Dispatch the aventuras-slice-writer agent with:
  description: "Write slice <M>.<N>"
  prompt: |
    Milestone doc: [absolute path]
    Skeleton entry: Slice <M>.<N> in [absolute path of slices.md]
    Working directory: [absolute path, holding the research digests]
    Implementation notes placeholder: _Populated at finish: notable deviations from the plan and resolved developer decisions._
    Write to: [absolute path of the slice doc]
    Repository: [absolute path], at [HEAD_SHA]
```
