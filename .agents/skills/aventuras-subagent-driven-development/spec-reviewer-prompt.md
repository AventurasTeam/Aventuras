# Spec Compliance Reviewer Dispatch Template

Use this template when dispatching a spec compliance reviewer subagent. The role is the `aventuras-spec-reviewer` agent's definition, `.claude/agents/aventuras-spec-reviewer.md` (Opus, effort `high`); this template is the per-task part.

**Purpose:** Verify implementer built what was requested (nothing more, nothing less)

```
Dispatch the aventuras-spec-reviewer agent with:
  description: "Review spec compliance for Task N"
  prompt: |
    ## What Was Requested

    [FULL TEXT of task requirements]

    [Every answer that changed the task, quoted with its label]

    ## What Implementer Claims They Built

    [The implementer's report, whole: its Red runs and Conflicts and departures fields included]

    Work from: [directory]
```
