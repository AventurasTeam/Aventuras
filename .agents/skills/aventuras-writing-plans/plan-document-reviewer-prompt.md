# Plan reviewer brief

The brief for the independent plan review (SKILL.md → Independent review). Fill in the bracketed paths and hand it over whole: the reviewer gets no other context from the planning session.

````markdown
You are reviewing an implementation plan before anyone executes it. You have none of the context of the session that wrote it, which is the point: find what that session couldn't see.

**Read-only.** Don't edit the plan, the slice doc or any tracked file. Write only your review file.

**Inputs** (absolute paths):
- Plan: [PLAN_PATH]
- Slice doc: [SLICE_DOC_PATH]
- Milestone doc: [MILESTONE_DOC_PATH]
- Repository root: [REPO_ROOT]. Start with `CLAUDE.md` (also `AGENTS.md`), then `docs/code-conventions.md`, `docs/testing.md` and the canon docs the plan and the slice doc cite. The code is at [HEAD_SHA]; check the plan against it, not against memory.

**Check, in this order:**

1. **Slice coverage.** Every item in the slice doc's Goal, Scope: in and Acceptance criteria has a task that delivers it and an Evidence Matrix row that proves it. Nothing in Scope: out is built. Every Open question the slice doc lists is answered in the plan's Decisions.
2. **The plan against the code.** Every file, export, function, type, column and command the plan relies on either exists at [HEAD_SHA] or is created by an earlier task. Open the files. A plan that calls a helper by the wrong name, passes the wrong arguments or edits a file that moved is the most common defect this catches; cite `file:line`.
3. **Contracts.** Where the plan touches something the milestone's contracts pin, or a module another slice builds on, it matches the contract. Where the plan and the slice doc or canon disagree, canon and the slice doc win unless a Decision records a developer decision on the point.
4. **Task order.** No task uses what a later task creates. Each task leaves the code building and the tests passing.
5. **Tests.** Each behaviour change has a test that would fail without it, at the layer `docs/testing.md` names. No expectation is derived from the constant under test. A test named but not written out is a gap.
6. **Conventions.** `docs/code-conventions.md` (module structure, state placement, action layer, type design) and `.claude/rules/code.md`.
7. **Placeholders and tiers.** No "TBD", "similar to Task N" or "add error handling" without the code. Each task's Model and Verification tier fits it: an `automated` task names commands that fully cover it.

**Calibration.** Report only what would make the implementer build the wrong thing, get stuck, or ship a defect. Wording and style are not findings. If the plan is sound, say so; an empty list is a valid result.

**Write your review to [REVIEW_PATH]**, in this form:

    # Plan review: [SLICE]
    Reviewer: <agent and model>. Code at: [HEAD_SHA].
    Verdict: ready | ready after fixes | not ready

    ## Findings
    ### F1 · blocking | should-fix | minor · Task N, Step M
    - Claim: <what's wrong, one or two sentences>
    - Evidence: <file:line, or the doc and section>
    - Fix: <the concrete change>

    ## Checked and fine
    <one line per check above that found nothing>

Then report that the review is written, with the verdict and the number of findings per severity.
````
