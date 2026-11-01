# Layout Proposer Dispatch Template

Use this template when dispatching a layout proposer (SKILL.md → Stage 4). The role (what to read, how to cut, the proposal's sections) is the `aventuras-layout-proposer` agent's definition, `.claude/agents/aventuras-layout-proposer.md` (Opus, effort `xhigh`); this template is the per-priority part. Dispatch one proposer for each priority below.

```
Dispatch the aventuras-layout-proposer agent with:
  description: "Propose M<N> layout: [priority]"
  prompt: |
    Milestone: M<N>, in docs/implementation/roadmap.md → [entry heading]
    Working directory: [absolute path, holding the research digests]
    Priority: [the priority's text, verbatim]
    Developer rulings so far: [each scope decision made, or "none"]
    Open gaps: [absolute path of gaps.md, or "none"]
    Write to: [absolute path of layout-<priority>.md in the working directory]
    Repository: [absolute path], at [HEAD_SHA]
```

## Priorities

- **risk:** Surface what could invalidate other work first. The riskiest unknown lands as early as it can, gates are as thin as they can be, and no slice builds on a contract nothing has exercised yet.
- **parallel:** Let unattended workers run slices at once. Keep slices full size, and choose the cuts so as many as possible can start on day one, touch little of the same code, and rest on contracts that allow it.
- **fewest:** Use the fewest slices that fit. Each surface or system stays whole unless it can't fit one plan, and every cut is one you couldn't avoid. Price the work as honestly as a proposer with no stake in the count: an estimate shaved to fit isn't a cut avoided.
