---
name: aventuras-orca-coordinator
description: Orca + Claude Code only. Use when running as the standing coordinator that dispatches unattended slice workers from plan files, relays their questions and reports their PRs, on a machine where Orca manages the worktrees and Claude Code has PushNotification and Remote Control.
---

# Orca coordinator

**Harness-specific:** Orca (orchestration CLI) plus Claude Code (background Bash, PushNotification, Remote Control). Unlike the other `aventuras-*` skills, it doesn't port to other harnesses.

## Overview

You run in the repository's main checkout, start one supervised Orca worker per slice plan, answer or relay the workers' questions, and tell the developer when PRs are ready. You never write code. You are long-lived and unattended: context compaction will happen, and the developer is often away, reaching you from the Claude app through Remote Control.

**Core principles:** only the developer decides load-bearing questions, and you never go blind to the other workers while one waits.

**REQUIRED BACKGROUND:** the Orca orchestration guide (`orca skills get orchestration`). This skill overrides it on acknowledgement timing and wait length.

## Start and recovery

Runs at start and after every compaction, before anything else:

1. The developer started you with `claude --remote-control` in the main checkout. If Remote Control isn't active, ask them to run `/remote-control`.
2. **Read the ledger,** `.impl-plans/coordinator.md` in the main checkout. It is your memory; your context isn't. Create it if missing.
3. Reuse the ledger's Run. Only with none: `orca orchestration run-create --objective "slice workers" --json`, and record its ID. Every restart gives you a new terminal handle: when `$ORCA_TERMINAL_HANDLE` differs from the one in the ledger, run `orca orchestration run-use --id <run>` before anything else (without it `worker-start` is refused `consumer_fenced`), and record the new handle.
4. Reconcile: `orca orchestration worker-list --run <run> --include-remote --json` against the ledger.
   - A restart marks a live worker's Dispatch `failed` (`terminal_missing`) and puts its Task back to `ready`. Restart it with `worker-start --task <id> --worktree id:<repo-id>::<worktree-path>` (`--retry-of` is refused); the new worker resumes from its ledger.
   - Orca also restores old agent sessions, finished workers' included, as idle terminals in their worktrees. Before starting any worker in a worktree, run `orca terminal list --worktree <sel>`. An agent terminal that isn't a live Dispatch's is a restored or retained session: send nothing to it, and tell the developer which ones to close, since typing into one puts a second agent in the worktree.
5. Re-post every question still waiting on the developer into the session, and push the ones whose push never went out.
6. Start the wait, with `--ack` if the ledger shows a handled delivery not yet acknowledged. A replayed message whose ID the ledger already marks handled gets no second reply, release or push.

## The ledger

You are its only writer. Update it before acting and before every acknowledgement:

- the Run ID, the repo ID (`orca repo list --json`) and your terminal handle (`$ORCA_TERMINAL_HANDLE`)
- per slice: plan path, task and dispatch IDs, worktree, branch (for a stack, every branch with its head SHA as last seen, updated at each worker_done and before each worker start), whether it changes the schema, state (queued / running / reviewing / waiting on the developer / PR #n ready / merged / failed)
- per question: `Q<n>`, slice, message ID, text, class, reply and its label, state, whether the push went out
- per delivery: its ID, the message IDs it held, and whether each is handled and the delivery acknowledged

## Waiting

Keep exactly one consuming wait, always in the background (`run_in_background`), then end your turn. You wake on a worker message or on a developer message.

```bash
orca orchestration check --run <run> [--ack <delivery_id>] --wait --types "worker_done,escalation,question" --timeout-ms 3300000 --json
```

Never wait in the foreground; you would miss the developer. Read the output with `grep -v _keepalive`: Orca writes a keepalive line every 15 s. Heartbeats arrive despite `--types`, batched up to 50: a delivery of heartbeats alone gets acknowledged with the next wait, and a backlog is paged through with non-waiting `check --ack <id> --json` calls, a ledger line before each. A wait that ends within seconds with an error is a failure to read and fix, not a timeout; don't restart it blindly.

**A timeout is a checkpoint.** Run `orca orchestration worker-list --run <run> --include-remote --json` and act on what needs attention, as the guide says. Read each live worker's screen too: a permission dialog or a stopped worker whose escalation failed to send shows only there. Check every `PR #n ready` slice with `gh pr view <n> --json state`; a merged one is `merged` in the ledger, and a slice queued behind it, or whose Execution gate now holds, starts now. If another unmerged slice also changes the schema, mark it `needs its migration regenerated` in the ledger: a follow-up worker in its worktree (Review follow-ups) merges `origin/main` in and regenerates the migration with drizzle-kit. Start that follow-up only once the slice's own worker has reported done and been released; two agents in one worktree commit over each other. Then restart the wait.

## Dispatching a slice

On "Dispatch slice `<milestone>/<stem>`: plan at `<path>`":

1. Read the plan at that absolute path: its slice doc link, which must match the dispatch line (ask the developer if not), its Execution gate, including whether it splits the slice into stacked PRs, and whether any task touches `lib/db/schema.ts` or `lib/db/migrations/`.
2. If the gate isn't `none` and its condition doesn't hold yet, queue the slice, record the gate, and tell the developer. It starts at the checkpoint where the condition holds.
3. If it changes the schema while another unmerged slice does too, queue it, record that, and tell the developer; it starts when that slice's PR merges.
4. `git fetch origin` (worktrees branch from `origin/main`).
5. Start the worker:

   ```bash
   orca orchestration worker-start --run <run> --worktree new-top-level --repo id:<repo-id> --name <milestone>-<stem> --setup run --agent claude --model opus --effort xhigh --task-title "<milestone>/<stem>" --spec "<spec>" --json
   ```

   Every worker you start, whether implementer, slice reviewer, follow-up or restart, gets `--agent claude --model opus --effort xhigh`. Without them it launches with whatever model and effort the Orca UI last had, so a change there would reach the workers.

   The spec, filled in:

   > **Target:** the plan at `<path>`, executed in your new worktree. **Change:** execute it with aventuras-subagent-driven-development as a dispatched worker (see its Dispatched worker section) and finish with aventuras-finishing-a-development-branch. **Constraints:** the plan is read-only; your ledger is `<plan-stem>.worker.md` next to it; your escalation channel is the `ask` command in your preamble, with `--timeout-ms` at most 540000 (your shell tool stops a command at 600000, which would lose the message ID a timeout prints); replying in the review threads of your own PR is part of the task, not contacting a human; never merge, never push to main. **Ownership:** your worktree and your ledger file. **Acceptance:** an open PR against main with every check passing and every review comment replied to; your worker_done carries the PR URL.

   For a plan split into stacked PRs, the Ownership adds "the branches you create for the upper PRs", and the Acceptance reads: "the plan's `<n>` PRs, stacked as aventuras-finishing-a-development-branch → Stacked PRs describes, each with every check passing and every review comment replied to; one worker_done after the last PR, carrying every PR URL."

6. Record the IDs. Tell the developer the worktree name.

**While a stack is open,** its lower branches can change under a worker. Before starting any worker on a stack, compare each branch's head on origin (`git ls-remote origin <branch>`, not a possibly stale `origin/*` ref) with the ledger, and name a head that moved in the new worker's spec. When `main` moves, tell the developer to leave GitHub's stack rebase alone while a worker builds on the stack, or to tell you first: it force-pushes every branch of the stack.

## Questions

Record the question in the ledger as `Q<n>`, then classify it:

| Class        | Test                                                                                                                 | Reply                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Settled      | The plan, slice doc or canon docs answer it; quote them                                                              | `ANSWER: <answer> (<doc> → <section>)`         |
| Reversible   | Local and cheap to change later; nothing later work builds on                                                        | `PROVISIONAL: <choice>. Alternative: <other>.` |
| Load-bearing | Schema, contracts between modules, product behaviour, anything later tasks build on, overturning a recorded decision | Nothing yet: the developer decides             |

When the plan and the docs disagree, the slice doc and canon win, unless the plan's Decisions section records a developer decision on the point. Between reversible and load-bearing, choose load-bearing. Reply with `orca orchestration reply --id <message_id> --body "<reply>" --json`.

**A load-bearing question, in this order:**

1. Ledger: `Q<n>` waiting on the developer.
2. Acknowledge its delivery now, with the next wait (`--ack`). The question stays open, and you reply to it by message ID later; holding the acknowledgement would replay it and blind you to every other worker.
3. Write it into the session: `Q<n> [<slice>]: <question> Options: <…>. Reply "Q<n>: <answer>".`
4. `PushNotification` with `Q<n> <slice>: <question>` (under 200 characters). If it comes back not sent, start a background `sleep 150`, and when it ends push once more unless the developer has answered.

That worker waits; the others carry on.

**The developer's answer** is a message in this session. Match it to its `Q<n>` (ask if it's ambiguous), then reply to the worker: `DEVELOPER: <the chosen option, normalised>. Developer's words: "<verbatim>"`. Update the ledger. If the answer makes the slice change the schema while another unmerged slice does too, mark it in the ledger and tell the developer now: both keep running, and whichever merges second gets its migration regenerated (see the timeout checkpoint).

## Worker messages

- **worker_done, succeeded:** `gh pr view <url> --json baseRefName,state,body` and `gh pr checks <n> --json name,state,description` (the view's `statusCheckRollup` carries no descriptions). Check that it's open, with every check passed and CodeRabbit's description `Review completed`: its check also passes when it skipped the review for its rate limit. `No files to review` also counts when everything pushed since its last `Review completed` is under `docs/**`, which CodeRabbit path-filters. A single PR with the wrong base: `gh pr edit <n> --base main`. For a stack, check every PR: PR 1's base is `main`, PR k's is PR k−1's branch, and `gh api repos/AventurasTeam/Aventuras/pulls/<n> --jq .stack` gives the same stack number on each, with positions 1 to n. Never retarget an upper PR to `main`: that takes it out of the stack. Every `PROVISIONAL:` and `DEVELOPER:` reply in your ledger for that slice must appear in the body; add any missing ones with `gh pr edit <n> --body`. Then `worker-release --dispatch <id>`; it closes the worker's terminal and keeps its worktree. When it comes back `retained` / `user_takeover`, which has happened on every release so far for reasons on Orca's side, the terminal stays open: tell the developer which one, and don't close it yourself, since a takeover may mean they're in it. If a check failed or is still pending, CodeRabbit didn't review, or the ledger says the slice needs its migration regenerated, start a follow-up worker in that worktree (Review follow-ups) for it, and push nothing yet. Otherwise the slice's implementation is done: start its slice review (Slice review), and push nothing yet.
- **Escalation `permission-prompt`:** the worker hook (the Desktop's managed settings, from `~/claude-worker-setup/`) sends it when a worker or one of its subagents hits a permission dialog; a subagent's never times out. Read the screen (`orca terminal read --terminal <handle>`). A command that only touches the session scratchpad or the worker's own scratch copies: answer it yourself with `orca terminal send --terminal <handle> --text 1`. Anything else is load-bearing (Questions); type the developer's answer into the dialog the same way.
- **Escalation `worker-stopped`:** the worker ended its turn without worker_done, again after the hook nudged it once. Read the screen. A question written in prose goes through Questions, and the reply is typed with `orca terminal send`. A usage-limit notice needs nothing: Claude Code resumes after the reset. Otherwise send `Continue with the next task in your ledger; if you're blocked, use ask.`
- **worker_done, failed, or any other escalation:** ledger it and push `<slice> failed: <reason>`. Keep the worktree.
- **Silence:** a worker inside a long subagent run can't heartbeat. Act only on Orca's liveness verdicts, as the guide describes.

## Slice review

Once every PR of a slice has validated, `worker-release` the slice worker. Then start a fresh worker in the same worktree, with `--worktree id:<repo-id>::<worktree-path>`, and set the ledger state to `reviewing`. The spec, filled in:

> **Target:** slice `<milestone>/<stem>`, PRs <#a → #b …> from bottom to top, with the top branch `<branch>` checked out in your worktree. **Change:** review the slice with aventuras-slice-review as a dispatched worker. **Constraints:** the plan, slice doc and worker ledger are read-only; your ledger is `<plan-stem>.review.md` next to the plan; your escalation channel is the `ask` command in your preamble, with `--timeout-ms 540000`, for blockers only; never merge, never push to main, never force-push. **Ownership:** your worktree, the top PR's branch (and a new top PR if the budget calls for one), that PR's description and comments, and your ledger. **Acceptance:** the report is posted as a PR comment and in that PR's description, and the pushed PR passes every check with CodeRabbit's description read; your worker_done carries the comment URL, the count per class, and the report.

**When its worker_done arrives,** validate the PR it pushed as for any worker_done. A new top PR must also be in the stack. Then:

1. **Check each decision against the code before relaying it.** Re-derive its failure sequence, and correct the report where it's wrong. Read the not-taken list critically, and name any dismissal you'd reopen: something real dismissed without a citation, or a deferral left unfiled.
2. **Write the decisions into the session** as `R<n> [<slice>]`, in the report's plain-language form, followed by the not-taken list. Push `<slice> reviewed: <n> decisions`. Each `R<n>` waits on the developer like a load-bearing question, and the ledger records it the same way.
3. **On the developer's answers,** add a `DEVELOPER:` line under each decision's checkbox in the PR body (`gh pr edit --body-file`, after diffing a fresh copy of the body). Then start a follow-up worker (Review follow-ups) whose spec carries each decision, normalised, with the developer's words. Its questions go through Questions.
4. **When that follow-up's worker_done validates,** or at once if the review had no decisions, ledger `PR #n ready` and push `<slice> PR #<n> ready for review`.

## Review follow-ups

On "address review on PR #n", start a fresh worker in that slice's existing worktree, `--worktree id:<repo-id>::<worktree-path>`. Its spec: address the developer's review comments on PR #n with aventuras-receiving-code-review as a dispatched worker, then report as before.

## Red Flags

- Answering a load-bearing question yourself, even with "reply to overrule"
- Holding an acknowledgement until the developer answers
- A foreground wait, or two waits at once
- Relaying the developer's words without the normalised option
- Relaying a slice review's decisions without checking them against the code
- Starting a second schema-changing slice
- Acting on what you remember instead of the ledger after a compaction
- Editing tracked repository files (the git-ignored ledger is yours), merging, or telling a worker to merge
