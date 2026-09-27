---
name: aventuras-finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
---

<!-- Adapted from Superpowers (https://github.com/obra/superpowers), MIT-licensed. See .agents/skills/NOTICE-superpowers.md. -->

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Detect environment → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## The Process

### Step 1: Verify Tests

**Before presenting options, verify tests pass:**

```bash
# Run project's test suite
pnpm test:run / cargo test / pytest / go test ./...
```

**If tests fail:**

```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue.

### Step 1.5: Reconcile the slice doc (Aventuras slice branches)

If this branch implemented a slice (it has a doc under
`docs/implementation/milestones/**/slices/NN-*.md`), reconcile that doc with what actually shipped **before** presenting options, so the reconciliation rides along in the merge or PR. The execution plan in `.impl-plans/` is git-ignored and about to be lost — mine it now.

- **Implementation notes** — record the notable deviations from the slice's plan and the resolved developer decisions. Sources: the plan's Decisions section in `.impl-plans/`, and the branch's commit history (`fix` / `chore` / `refactor` commits are usually deviations or review fixes). Keep it sparing, per the slice-doc structure in `docs/implementation/conventions.md` — why a notable route was chosen, what constrains a future slice, what a later author must remember. If the section is missing, add it.
- **Open questions** — migrate any question that turned into a decision into Implementation notes; leave the genuinely-open ones.
- **Carried-forward follow-ups** — a deferral this slice surfaced that a _specific downstream slice_ will own (a decision that slice's own work forces, not a free-floating TODO) belongs in **that slice's Open questions**, framed as the downstream slice's own question. The `aventuras-plan-slice` gate then forces its resolution before that slice is planned, so it can't be silently dropped — a stronger guarantee than burying it in this slice's Implementation notes or the global ledger. Leave a one-line pointer from this slice's Implementation notes; don't duplicate the detail. A cross-cutting deferral with no single downstream owner goes to the implementation triage inbox (`docs/implementation/triage.md`) instead — a queue to route from later, not the root `followups.md` / `parked.md` ledgers.
- **Scope / acceptance** — if shipped reality diverged from the brief, correct the brief so the doc isn't misleading.

Commit this reconciliation on the branch. Skip the step entirely for non-slice branches (hotfixes, chores, tooling).

### Step 1.6: Offer the comment audit (optional)

Comment bloat is the most common convention violation on AI-implemented
branches, and it is cheapest to fix before review rather than after. Offer it
here so the cleanup rides along in the merge or PR, exactly like Step 1.5.

**Never run it unprompted.** Get the numbers first, then let the user decide:

```bash
node .agents/skills/aventuras-comment-audit/find-comment-blocks.mjs <base>...HEAD
```

If `candidateBlocks` is 0, say nothing and continue to Step 2. Otherwise
present the real counts — a decision prompt with numbers in it beats a vague
offer:

```
This branch added <K> comment lines across <B> blocks in <M> files.
Run the comment audit before finishing? (~<N> subagents)

1. Yes — audit and commit the cleanup on this branch
2. No — finish as-is

Which option?
```

On **yes**: invoke `aventuras-comment-audit` with the same range, let it run to
its own verification gate, then commit the result on the branch as a separate
`chore:` commit so the comment churn stays reviewable apart from the feature
diff. Tests do not need re-running — the audit's verification proves the diff
is comment-only.

On **no**: continue to Step 2. Don't re-offer.

Skip the step entirely when the branch is a doc-only or config-only change.

### Step 2: Detect Environment

**Determine workspace state before presenting options:**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
```

This determines which menu to show and how cleanup works:

| State                                  | Menu                         | Cleanup                         |
| -------------------------------------- | ---------------------------- | ------------------------------- |
| `GIT_DIR == GIT_COMMON` (normal repo)  | Standard 3 options           | No worktree to clean up         |
| `GIT_DIR != GIT_COMMON`, named branch  | Standard 3 options           | Provenance-based (see Step 6)   |
| `GIT_DIR != GIT_COMMON`, detached HEAD | Reduced 2 options (no merge) | No cleanup (externally managed) |

### Step 3: Determine Base Branch

```bash
# Try common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main - is that correct?"

The base is `main`, the v2 trunk. GitHub's default branch is `master` (legacy v1), so every `gh pr create` below passes `--base <base-branch>` explicitly; without it the PR targets `master`, where CI never runs.

### Step 4: Present Options

**Normal repo and named-branch worktree — present exactly these 3 options:**

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)

Which option?
```

**Detached HEAD — present exactly these 2 options:**

```
Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as new branch and create a Pull Request
2. Keep as-is (I'll handle it later)

Which option?
```

**Don't add explanation** - keep options concise.

### Step 5: Execute Choice

#### Option 1: Merge Locally

```bash
# Get main repo root for CWD safety
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# Merge first — verify success before removing anything
git checkout <base-branch>
git pull
git merge <feature-branch>

# Verify tests on merged result
<test command>

# Only after merge succeeds: cleanup worktree (Step 6), then delete branch
```

Then: Cleanup worktree (Step 6), then delete branch:

```bash
git branch -d <feature-branch>
```

#### Option 2: Push and Create PR

```bash
# Push branch
git push -u origin <feature-branch>

# Create PR
gh pr create --base <base-branch> --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Test Plan
- [ ] <verification steps>
EOF
)"
```

**Do NOT clean up worktree** — user needs it alive to iterate on PR feedback.

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

### Step 6: Cleanup Workspace

**Only runs for Option 1.** Options 2 and 3 always preserve the worktree.

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

**If `GIT_DIR == GIT_COMMON`:** Normal repo, no worktree to clean up. Done.

**If worktree path is under `.worktrees/`, `worktrees/`, or `~/.config/superpowers/worktrees/`:** Superpowers created this worktree — we own cleanup.

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
git worktree remove "$WORKTREE_PATH"
git worktree prune  # Self-healing: clean up any stale registrations
```

**Otherwise:** The host environment (harness) owns this workspace. Do NOT remove it. If your platform provides a workspace-exit tool, use it. Otherwise, leave the workspace in place.

## Dispatched worker

When your task prompt makes you a dispatched worker (aventuras-subagent-driven-development → Dispatched worker), nobody answers a prompt. Steps 1–3 run as written; the base is `main`, so don't ask about it. Run `git fetch origin` first and use `origin/main` wherever a step names the base: a stale local `main` pulls other slices' commits into every range. Then:

1. **Step 1.5 draws on your worker ledger too.** Every `DEVELOPER:` answer goes into Implementation notes; every `PROVISIONAL:` answer goes in marked provisional. An answer that changes what a canon doc says (`docs/data-model.md`, a contract) also updates that doc on this branch.
2. **Comment audit: run it whenever the finder reports candidate blocks.** Don't offer it; commit it as Step 1.6 says.
3. **The PR is the only option.** Never merge, never keep. Before pushing, merge `origin/main` in with a new commit if the branch conflicts with it, and if `git diff --name-only origin/main...HEAD | wc -l` is over 100 (CodeRabbit's cap), ask through the channel about splitting. Then push and create the PR (Option 2). Its body adds, after Summary, one section per non-empty label from the ledger:

   ```
   ## Decisions pending
   - [ ] <question> → <provisional choice> (alternative: <…>)

   ## Decided during the run
   - <question> → <developer's decision>
   ```

   Record the PR URL in the ledger.

4. **Review loop.** Wait until every check has finished, CodeRabbit's included (`gh pr checks <n> --watch`, in the background: the E2E suite outlasts a foreground command). Then handle every CodeRabbit comment — inline threads and those in its review body (`gh pr view <n> --json reviews`) — with aventuras-receiving-code-review, which has its own Dispatched worker section. A failed check is a bug: fix it with aventuras-systematic-debugging. Fixes are new commits, never amend or force-push; each push restarts this step. CodeRabbit answers your replies: reply again only where it raises something new.
5. **Done** when all checks pass and every review comment has your reply: in its thread, or, for comments in the review body, in your PR comment. Then report completion once, through the channel your prompt names, with the PR URL. Never clean up the worktree: fixes from the developer's review land in it later.

## Quick Reference

| Option           | Merge | Push | Keep Worktree | Cleanup Branch |
| ---------------- | ----- | ---- | ------------- | -------------- |
| 1. Merge locally | yes   | -    | -             | yes            |
| 2. Create PR     | -     | yes  | yes           | -              |
| 3. Keep as-is    | -     | -    | yes           | -              |

## Common Mistakes

**Skipping test verification**

- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" is ambiguous
- **Fix:** Present exactly 3 structured options (or 2 for detached HEAD)

**Cleaning up worktree for Option 2**

- **Problem:** Remove worktree user needs for PR iteration
- **Fix:** Only cleanup for Option 1

**Deleting branch before removing worktree**

- **Problem:** `git branch -d` fails because worktree still references the branch
- **Fix:** Merge first, remove worktree, then delete branch

**Running git worktree remove from inside the worktree**

- **Problem:** Command fails silently when CWD is inside the worktree being removed
- **Fix:** Always `cd` to main repo root before `git worktree remove`

**Cleaning up harness-owned worktrees**

- **Problem:** Removing a worktree the harness created causes phantom state
- **Fix:** Only clean up worktrees under `.worktrees/`, `worktrees/`, or `~/.config/superpowers/worktrees/`

## Red Flags

**Never:**

- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Remove a worktree before confirming merge success
- Clean up worktrees you didn't create (provenance check)
- Run `git worktree remove` from inside the worktree

**Always:**

- Verify tests before offering options
- Detect environment before presenting menu
- Present exactly 3 options (or 2 for detached HEAD)
- Pass `--base` to `gh pr create`
- Clean up worktree for Option 1 only
- `cd` to main repo root before worktree removal
- Run `git worktree prune` after removal
