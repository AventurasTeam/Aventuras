---
name: aventuras-slice-review
description: Claude Code only. Use when a slice's PRs are open and green with CodeRabbit's comments handled, and the slice needs its closing review before the developer reviews and merges it, whether the slice is one PR or a stack.
---

# Slice review

**Harness-specific:** Claude Code. It uses the built-in `/code-review` skill, the pr-review-toolkit plugin's agents and code-simplifier, and worktree-isolated subagents. It doesn't port to other harnesses. Every agent inherits your model and effort.

## Overview

A fresh reviewer reviews the whole slice at once, after its PRs exist. A later PR often fixes something an earlier one got wrong, so findings are correlated across the slice before anything is fixed. What's clear gets fixed on the top PR, deferrals get filed, and the developer gets only the decisions, in plain language, plus what wasn't fixed and where it went.

**Core principle:** every finding ends in exactly one place: a fix commit, a decision item, a filed deferral, or a dismissal with a citation.

## When to use

- At the end of every slice: all its PRs are open, every check passes, and CodeRabbit's comments are fixed or declined. A single PR is a stack of one.
- Not per PR as they open, and not before CodeRabbit is handled: its declined threads are an input.
- Dispatched: the coordinator starts you in the slice's worktree (see Dispatched worker). Attended: the developer asks for it.

## Inputs

- The slice's PRs, bottom to top, with the top branch checked out. The range is `origin/main...<head>`, where `<head>` is the top branch's head when you start.
- The things to judge findings against:
  - the plan's Decisions;
  - the slice doc;
  - the worker ledger (what was decided, deferred or triaged);
  - the canon docs, including their known-limitation lists;
  - every CodeRabbit thread on every PR of the slice;
  - [`docs/code-conventions.md → Type design`](../../../docs/code-conventions.md#type-design).
- Your ledger: `<plan-stem>.review.md` next to the plan. Write every step to it before acting on it, and resume from it after compaction.

## Step 1 — Scope and budget

1. Run `git fetch origin`, and record `<head>` and the range in your ledger.
2. **Budget the file cap before scoping fixes.** CodeRabbit path-filters `docs/**`, so docs neither count toward its 100-file cap nor get its review. Count non-docs files per PR with `gh pr diff <n> --name-only | grep -vc '^docs/'`. Fixes go on the top PR. If it already has more than about 70 non-docs files, put the fixes on a new PR on top of the stack instead, and link it into the stack right after opening it.
3. **The digest:** the plan's Decisions, the worker ledger's decisions and deferrals, the triage entries the slice raised, and the declined CodeRabbit threads. Every review agent gets it, with the rule "re-raise these only with new evidence".
4. **Re-check the budget after Step 3:** add the files the fixes will touch outside the top PR's diff. If the total would pass about 90 non-docs files, move the fixes to a new PR before Step 4. CodeRabbit rounds need headroom.
5. **The chunks:** split the non-docs part of `git diff --stat <range>` into chunks of related files, a module with its tests, each up to about 2.5k added lines.

## Step 2 — Review

No edits in your worktree. Every review agent is a fresh subagent with worktree isolation, because verification probes and mutation checks touch files. Each agent starts like this:

1. `git checkout --detach <head>`, then `git rev-parse HEAD`, which must print `<head>`. The isolated worktree may start from another ref.
2. Re-read `CLAUDE.md`. The copy in the agent's context may come from that other ref.
3. `pnpm install --frozen-lockfile`, only if it will run tests.
4. Mutation checks use `pnpm vitest run --project unit <file>`, never E2E, never a bare `vitest run`. Restore the file from a copy with `cp`, never with `git stash` or `git checkout --`.
5. `pnpm lint:docs` refuses files under `.claude/`, so docs checks run in your worktree later.

| Source | Scope |
| --- | --- |
| `/code-review xhigh` | One subagent per chunk |
| pr-review-toolkit `comment-analyzer` | Whole range |
| pr-review-toolkit `pr-test-analyzer` | Whole range |
| pr-review-toolkit `silent-failure-hunter` | Whole range |
| pr-review-toolkit `type-design-analyzer` | Whole range, pointed at `code-conventions.md → Type design` |
| A docs reviewer | The range's `docs/**`: changed docs against the code, canon cross-references, `.claude/rules/docs.md` |

- **Each `/code-review` agent** invokes `/code-review xhigh <range> -- <chunk paths>`, never with `--fix` or `--comment`. It then waits, and neither reviews nor touches files until the skill's result is back: the skill runs as a child in the same worktree. After that it verifies every candidate by reading the code, probing it or mutating it, and returns each one as verified or rejected, with the evidence.
- **Don't run** pr-review-toolkit's `code-reviewer`, which `/code-review` covers. Don't run its simplify aspect either: code-simplifier runs in Step 5, on the final code.
- **Every agent's prompt** gets the range, its paths, the digest, and the format: `file:line@<head> · claim · evidence`.
- **Log every finding** in your ledger as it arrives. A candidate an agent rejected with evidence needs no class: record the count, not the item.

If the top branch moves on origin while agents run, for example because the developer pushed:
- keep the running agents on `<head>`;
- add one `/code-review xhigh <head>..<new head>` agent;
- fast-forward before Step 4 (`--ff-only`; if that fails, ask);
- re-check findings in files the new commits touched.

## Step 3 — Correlate

Deduplicate across sources. Split a finding whose parts belong in different classes: each part ends in one place. A finding whose trigger is wrong but whose defect is real by another route stays one finding, restated. Whatever you find yourself while correlating is logged as a finding of your own. For each finding:

- For a behaviour finding, name the concrete trigger: a UI surface, or a non-UI writer (piggyback, classifier, chapter close, undo/redo, rollback/regenerate). If dismissing it relies on a UI guard, name the guard.
- Check whether canon requires the guarantee at that layer. Search canon's known-limitation lists, not only the plan. A canon doc the range changed is under review too: judge against its text at the merge base, and against the slice's change to it only where a recorded decision backs the change.
- Re-run an agent's probe or mutant only if the file has changed since the agent ran, or the agent didn't confirm its worktree was at `<head>`. Otherwise, confirming the file is unchanged and reading the code is enough. Load-bearing items are the exception: see below.
- When a claim is unclear, message the agent that made it while it's still reachable. Otherwise settle it from the code.

| Class | Test | Outcome |
| --- | --- | --- |
| Settled | A clear, evidence-backed fix, including cleanup with one obvious fix (dead exports, a misplaced file) | Fixed in Step 4 |
| Reversible | A fix with a real alternative, cheap to change later: wording, a format, a choice canon allows either way, or an implementer's choice | Fixed provisionally; the alternative is recorded |
| Load-bearing | Schema; a contract that canon or another slice defines; behaviour canon is silent or conflicting on, where the options differ in what gets stored, sent or kept; or overturning a recorded decision | Recorded for the developer: not asked, not fixed, not filed |
| Deferred | Real, but the slice's changes didn't cause it, or its fix belongs to another slice's scope | Filed in Step 4; the report says where |
| Dissolved | Not a defect, already decided, or already tracked | Cite the code fact (`file:line`), the decision, the canon line, or the tracking entry |

- **A recorded decision** is one of the plan's Decisions or a developer's answer. An implementer's choice in the plan or the worker ledger isn't one, and neither is a ledger note that a reviewer skipped something.
- **Dissolved needs a citation.** "Benign", "later", "a follow-up on main" and "below threshold" aren't reasons. Something real but later is Deferred, and gets filed.
- **"Already tracked" means searched.** Search triage, `followups.md`, `parked.md`, the roadmap's routed items and the Open questions of later slices before filing anything, so nothing gets filed twice. An entry that already states this case dissolves it. If you'd add to the entry, the case or the evidence that it reproduces, the finding is Deferred and the addition is the filing.
- **A defect the slice caused is in scope,** even when its fix touches files the range didn't change. A new route to an older defect counts as caused.
- **A test gap is settled** when a unit or component test can pin it. When only an E2E could, `docs/testing.md` decides whether the slice warrants one: cite it either way.
- **A declined CodeRabbit thread stays declined** unless you have new evidence. If you do, it's load-bearing.
- **Type-design findings follow `code-conventions.md → Type design`.** If the rule applies, the finding is settled, or reversible when it has a real alternative, even though every caller is correct today and even when the type crosses modules. A tightening that changes a shape canon pins is still settled: update the doc with it. If the rule doesn't apply, dismiss the finding with the rule's reason.
- **Re-derive every load-bearing item from the code yourself,** whatever the agent's evidence. Don't copy the failure sequence from an agent's summary.
  - Probe it with a scratch test, deleted afterwards, through the actions the screens call. Check each step of the sequence, and whether the example you'll give can actually happen.
  - A step that leans on a mechanism (a cancel, an abort, a reversal, which action CTRL-Z picks) is checked against canon's section on that mechanism and the code's own comments where it happens. A step that contradicts them is wrong until a probe shows otherwise.
  - A route you couldn't probe that way isn't a step. List it under "not verified", apart from the sequence.
  - The screens themselves needn't be driven: that they offer the actions in that order goes under what you assumed. UI behaviour may be probed in the unit project with stand-in children, also named there.
  - Mark what you verified, what you assumed, and what you couldn't verify.
- **Two canon docs that disagree are a finding of their own.** If the history shows the newer, more specific contract replaced the older one, it wins, and fixing the stale doc is settled. Otherwise it's load-bearing.
- **Duplicate code without a defect** goes to the simplifier in Step 5, not into a class.

## Step 4 — Fix and file

1. `git worktree list` must show no leftover isolated worktrees. Worktrees whose HEAD moved are never auto-cleaned. Remove the clean ones with `git worktree remove` and delete their `worktree-agent-*` branches.
2. **Fix settled and reversible findings.** Use fresh fix subagents, not the review agents: each isolated, each on its own branch off the head, each on files no other fix agent touches.
   - Behaviour changes are test-first, and every new assertion is mutation-checked.
   - Follow `.claude/rules/code.md`.
   - Cherry-pick each fix branch onto the top branch in your worktree. Delete the fix branches once `git cherry` shows nothing unapplied.
   - Never let two agents commit in one worktree.
3. **File each deferred finding where it belongs,** per `.claude/rules/docs.md`:
   - the Open questions of the slice that will own it;
   - a roadmap milestone's routed items;
   - `docs/followups.md`, if the current milestone needs it;
   - `docs/parked.md`, with its revisit signal;
   - `docs/implementation/triage.md` when no home is clear yet.
4. When a fix changes what a canon doc says, update that doc on the same branch.

## Step 5 — Close out

In your worktree, in this order:

1. **code-simplifier** (pr-review-toolkit) over the whole slice range. Apply what's simpler and behaviour-preserving, and record what it skipped and why. A skip for later work ("needs a new home", "touches files on main") is a Deferred finding: file it as in Step 4.
2. **aventuras-comment-audit** over your own commits, `<head>..HEAD`.
3. **Gates:** the plan's full local gate list, plus `pnpm lint:docs` over the docs the isolated agents edited.
4. **Push once.** Never force-push, never rebase, never commit to a lower PR's branch.
5. **The review loop,** per aventuras-finishing-a-development-branch → Dispatched worker, step 4. CodeRabbit's check passes on `Review paused` and `Review rate limited` too, so read its description:
   - **Paused:** fix batches exceed its 5-commit auto-pause. Comment `@coderabbitai review`.
   - **"No files to review"** on a docs-only push is expected.

   Fix a round's comments, then push once for the round.

## Step 6 — Report

Write the report once. It goes to three places:
- one comment on the PR that carries the fixes;
- a "Slice review" section in that PR's description, holding the fixed and provisional items and one checkbox per decision;
- your completion report, or the session when attended.

Write it for a reader who doesn't have the internals in their head. Give one line of background before each problem and a concrete example. Explain any internal term (delta, payload, closure, sweep) or leave it out.

1. **Decisions needed.** For each one:
   - what the feature does;
   - what goes wrong, as numbered steps;
   - how likely it is and how bad;
   - the options, with their trade-offs;
   - your recommendation and what it gives up;
   - what you verified, what you assumed, and what you couldn't verify.
2. **Provisional fixes:** each choice and its alternative.
3. **Fixed:** one line per fix, with its commit, grouped by the PR where the defect came in.
4. **Not taken:** every finding that wasn't fixed, deferred (where it's filed) or dissolved (the citation). Collapse this part in the PR comment.
5. **Counts,** in one line: findings per class, candidates the agents rejected, and what the simplifier took.

## Dispatched worker

The coordinator started you, and nobody answers a prompt.
- Record decisions; don't ask about them.
- The `ask` channel is for blockers only.
- Never merge, never push to main.
- The plan, slice doc and worker ledger are read-only.
- Your completion report carries the comment URL, the count per class, and the report itself.

## Attended

After Step 6, go through the decisions with the developer one at a time: what's true, the options, your recommendation, then their call. Record each answer as a `DEVELOPER:` line under its checkbox, then apply the answers with aventuras-receiving-code-review.

## Red Flags

- A `/code-review` agent reviewing or touching files before the skill's result is back
- Dismissing with "benign", "later", "a follow-up on main" or "below threshold"
- Dismissing a type-design finding because every caller is correct today
- A decision's failure sequence copied from an agent's summary, not re-derived, or an example in it that hasn't been probed
- A step in a failure sequence that you read but couldn't probe, written as if it happens
- Filing a deferral without first searching the roadmap and later slices for it
- Counting docs toward CodeRabbit's cap, or reading "Review completed" on a docs-only push as a review of the docs
- Pushing per fix, or per fix agent
- Running pr-review-toolkit's `code-reviewer`, or review-pr's simplify aspect
- Two agents committing in one worktree
