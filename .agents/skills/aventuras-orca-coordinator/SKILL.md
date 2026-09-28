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
3. Reuse the ledger's Run. Only with none: `orca orchestration run-create --objective "slice workers" --json`, and record its ID.
4. Reconcile: `orca orchestration worker-list --run <run> --include-remote --json` against the ledger.
5. Re-post every question still waiting on the developer into the session, and push the ones whose push never went out.
6. Start the wait, with `--ack` if the ledger shows a handled delivery not yet acknowledged. A replayed message whose ID the ledger already marks handled gets no second reply, release or push.

## The ledger

You are its only writer. Update it before acting and before every acknowledgement:

- the Run ID and the repo ID (`orca repo list --json`)
- per slice: plan path, task and dispatch IDs, worktree, branch, whether it changes the schema, state (queued / running / waiting on the developer / PR #n ready / merged / failed)
- per question: `Q<n>`, slice, message ID, text, class, reply and its label, state, whether the push went out
- per delivery: its ID, the message IDs it held, and whether each is handled and the delivery acknowledged

## Waiting

Keep exactly one consuming wait, always in the background (`run_in_background`), then end your turn. You wake on a worker message or on a developer message.

```bash
orca orchestration check --run <run> [--ack <delivery_id>] --wait --types "worker_done,escalation,question" --timeout-ms 3600000 --json
```

Never wait in the foreground; you would miss the developer. Read the output with `grep -v _keepalive`: Orca writes a keepalive line every 15 s. A wait that ends within seconds with an error is a failure to read and fix, not a timeout; don't restart it blindly.

**A timeout is a checkpoint.** Run `orca orchestration worker-list --run <run> --include-remote --json` and act on what needs attention, as the guide says. Check every `PR #n ready` slice with `gh pr view <n> --json state`; a merged one is `merged` in the ledger, and a slice queued behind it, or whose Execution gate now holds, starts now. If another unmerged slice also changes the schema, mark it `needs its migration regenerated` in the ledger: a follow-up worker in its worktree (Review follow-ups) merges `origin/main` in and regenerates the migration with drizzle-kit. Start that follow-up only once the slice's own worker has reported done and been released; two agents in one worktree commit over each other. Then restart the wait.

## Dispatching a slice

On "Dispatch slice `<milestone>/<stem>`: plan at `<path>`":

1. Read the plan at that absolute path: its slice doc link, which must match the dispatch line (ask the developer if not), its Execution gate, and whether any task touches `lib/db/schema.ts` or `lib/db/migrations/`.
2. If the gate isn't `none` and its condition doesn't hold yet, queue the slice, record the gate, and tell the developer. It starts at the checkpoint where the condition holds.
3. If it changes the schema while another unmerged slice does too, queue it, record that, and tell the developer; it starts when that slice's PR merges.
4. `git fetch origin` (worktrees branch from `origin/main`).
5. Start the worker:

   ```bash
   orca orchestration worker-start --run <run> --worktree new-top-level --repo id:<repo-id> --name <milestone>-<stem> --setup run --agent claude --task-title "<milestone>/<stem>" --spec "<spec>" --json
   ```

   The spec, filled in:

   > **Target:** the plan at `<path>`, executed in your new worktree. **Change:** execute it with aventuras-subagent-driven-development as a dispatched worker (see its Dispatched worker section) and finish with aventuras-finishing-a-development-branch. **Constraints:** the plan is read-only; your ledger is `<plan-stem>.worker.md` next to it; your escalation channel is the `ask` command in your preamble, with `--timeout-ms 540000` (your shell tool stops a command at 600000, which would lose the message ID a timeout prints); replying in the review threads of your own PR is part of the task, not contacting a human; never merge, never push to main. **Ownership:** your worktree and your ledger file. **Acceptance:** an open PR against main with every check passing and every review comment replied to; your worker_done carries the PR URL.

6. Record the IDs. Tell the developer the worktree name.

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

- **worker_done, succeeded:** `gh pr view <url> --json baseRefName,state,statusCheckRollup,body`. Check that it's open, with every check passed and CodeRabbit's description `Review completed`: its check also passes when it skipped the review for its rate limit. A wrong base: `gh pr edit <n> --base main`. Every `PROVISIONAL:` and `DEVELOPER:` reply in your ledger for that slice must appear in the body; add any missing ones with `gh pr edit <n> --body`. Then `worker-release --dispatch <id>`; it closes the worker's terminal and keeps its worktree. If a check failed or is still pending, CodeRabbit didn't review, or the ledger says the slice needs its migration regenerated, start a follow-up worker in that worktree (Review follow-ups) for it, and push nothing yet. Otherwise ledger `PR #n ready` and push `<slice> PR #<n> ready for review`.
- **worker_done, failed, or an escalation:** ledger it and push `<slice> failed: <reason>`. Keep the worktree.
- **Silence:** a worker inside a long subagent run can't heartbeat. Act only on Orca's liveness verdicts, as the guide describes.

## Review follow-ups

On "address review on PR #n", start a fresh worker in that slice's existing worktree, `--worktree id:<repo-id>::<worktree-path>`. Its spec: address the developer's review comments on PR #n with aventuras-receiving-code-review as a dispatched worker, then report as before.

## Red Flags

- Answering a load-bearing question yourself, even with "reply to overrule"
- Holding an acknowledgement until the developer answers
- A foreground wait, or two waits at once
- Relaying the developer's words without the normalised option
- Starting a second schema-changing slice
- Acting on what you remember instead of the ledger after a compaction
- Editing tracked repository files (the git-ignored ledger is yours), merging, or telling a worker to merge
