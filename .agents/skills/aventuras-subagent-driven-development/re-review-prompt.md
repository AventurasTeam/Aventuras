# Scoped Re-Review Dispatch Template

Use this template when dispatching a re-review after a fix round (`references/fix-loop.md`), and once after the final review's fix (`references/final-review.md`). The re-reviewer verifies the findings were addressed and checks the fix diff for new breakage. It is not a fresh review — the full review already happened.

It dispatches the `aventuras-task-reviewer` agent, whose definition describes a full task review. The prompt below narrows that job, and its output contract replaces the definition's.

**Purpose:** Verify each finding from the previous review was addressed, and that the fix itself broke nothing.

```
Dispatch the aventuras-task-reviewer agent with:
  description: "Re-review Task N fix round R"
  prompt: |
    You are re-reviewing one task's fix round, not reviewing the task. A
    previous review produced findings; an implementer has attempted to fix
    them. Your job is to verdict each finding and inspect the fix diff —
    nothing else. This prompt's Scope and Output Format replace your
    definition's Part 1, Part 2 and Output Format; its rules on the report,
    hygiene, the mutation check and calibration apply to the fix diff.

    ## The Task

    [FULL TEXT of the task from the plan; for the final review's fix, the
    plan's Review Focus section]

    [Every answer that changed the task, quoted with its label]

    [The plan's Global Constraints section, verbatim; omit when the plan has none]

    [The plan's Decisions section, verbatim: a departure from canon a Decision records is not an issue]

    ## The Findings Under Verification

    [FINDINGS]

    ## The Fix

    Read the implementer's report (fix reports are appended at the end):
    [REPORT_FILE]

    **Fix base:** [FIX_BASE_SHA] (the head the previous review saw)
    **Head:** [HEAD_SHA]

    Read `git diff --stat [FIX_BASE_SHA]..[HEAD_SHA]`, then
    `git diff [FIX_BASE_SHA]..[HEAD_SHA]`.

    ## Scope

    Your scope is the findings list and the fix diff. Verdict every finding.
    Inspect the fix diff for new problems the fix itself introduced. Do NOT
    re-review code the fix did not touch: if you notice an issue entirely
    outside the fix diff, report it under Out-of-Scope Observations — it
    does not block this task and does not extend the loop. A broad
    whole-branch review happens after all tasks are complete.

    ## Tests

    The implementer re-ran the tests covering the amended code and appended
    the results to the report file. Treat the report as unverified claims:
    confirm the fix report names the covering tests and shows their output,
    and verify the claims against the diff. Run the mutation check on every
    assertion the fix adds or alters.

    ## Output Format

    Your final message is the report itself: begin directly with the first
    finding's verdict. Every line is a verdict, a finding with file:line,
    or a check you ran — no preamble, no process narration.

    ### Finding Verdicts

    For each finding in The Findings Under Verification, in order:
    - **[finding one-liner]** — ADDRESSED | NOT ADDRESSED, with file:line
      evidence. "Attempted" is not addressed: the specific defect must no
      longer exist.

    ### New Breakage in the Fix Diff

    Anything the fix itself broke or introduced, with severity
    (Critical/Important/Minor) and file:line. "None" if clean.

    ### Out-of-Scope Observations

    Issues you noticed entirely outside the fix diff, one line each with
    file:line; mark one `pre-existing` when code this branch didn't write
    holds it. Non-blocking; the controller ledgers these for the final
    review. "None" if none.

    ### Verdict

    **Fix round:** [All findings addressed, no new Critical/Important
    breakage | Findings remain open] — list the open ones.

    Work from: [directory]
```

**Placeholders:**

- `[FINDINGS]` — every finding open in the loop, copied verbatim, one per bullet: spec ❌ items, ⚠️ items you confirmed as gaps, Critical and Important findings, and Critical or Important breakage from the previous re-review. Never drop one to end the loop (SKILL.md → The task review).
- `[REPORT_FILE]` — absolute path of the implementer's report file (fix reports appended)
- `[FIX_BASE_SHA]` — the head the previous review saw
- `[HEAD_SHA]` — current commit

**Re-reviewer returns:** per-finding verdicts (ADDRESSED / NOT ADDRESSED), new breakage in the fix diff, out-of-scope observations, and a round verdict.
