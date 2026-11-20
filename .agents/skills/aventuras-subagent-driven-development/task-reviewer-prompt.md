# Task Reviewer Dispatch Template

Use this template when dispatching the task review of a `review`-tier task. The reviewer reads the task's diff once and returns two verdicts: spec compliance and task quality. The role (not trusting the report, the report-field audits, the mutation check, calibration, the output format) is the `aventuras-task-reviewer` agent's definition, `.claude/agents/aventuras-task-reviewer.md` (Opus, effort `xhigh`); this template is the per-task part.

**Purpose:** Verify one task's implementation matches its requirements (nothing more, nothing less) and is well-built (clean, tested, maintainable)

```
Dispatch the aventuras-task-reviewer agent with:
  description: "Review Task N (spec + quality)"
  prompt: |
    ## What Was Requested

    [FULL TEXT of the task from the plan]

    [Every answer that changed the task, quoted with its label]

    [The plan's Global Constraints section, verbatim; omit when the plan has none]

    ## What the Implementer Claims They Built

    Read the implementer's report first: [absolute path of <plan-stem>.task-N.report.md]

    ## Git Range to Review

    **Base:** [BASE_SHA]
    **Head:** [HEAD_SHA]

    Work from: [directory]
```

**Placeholders:**

- `[BASE_SHA]` — the commit the ledger's `dispatched` line recorded before the implementer started. Never `HEAD~1`, which silently drops all but the last commit of a multi-commit task.
- `[HEAD_SHA]` — current commit

Nothing else goes in the prompt: no direction on what to flag, how severe a finding is, or what to check beyond the task (SKILL.md → The task review).

**Reviewer returns:** Spec Compliance (✅ / ❌ with issues / ⚠️ cannot verify from this task's code), Strengths, Issues (Critical / Important / Minor), Outside this change, Task quality (Approved | Needs fixes)
