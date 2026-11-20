# Handling a Report That Isn't DONE

Part of aventuras-subagent-driven-development. The implementer's short status names it; the details are in its reply, and the full report is in its report file.

**DONE_WITH_CONCERNS:** The implementer completed the work but flagged doubts. Read the concerns before proceeding. If the concerns are about correctness or scope, address them before review. If they're observations (e.g., "this file is getting large"), note them and proceed to review. A concern that cites a conflict with canon or the code (the report's Conflicts and departures field) is about correctness: settle it as for NEEDS_CONTEXT below, and have the implementer apply the answer before review.

**NEEDS_CONTEXT:** The implementer needs information that wasn't provided, or found before writing code that the task conflicts with canon or the code. Answer it. Where the task and canon conflict, canon wins, unless the plan changes that canon on purpose (it says so, and a task updates the doc). Where it conflicts with the existing code, the code wins where the task's intent is still clear. Ledger what these rules settle as `settled: <what> — <why> — <cost if wrong>`. A question the plan, slice doc and canon don't settle goes to your human partner (a dispatched worker asks through its channel). Then continue the same subagent with the answer (SendMessage to its agent ID), so its reading isn't lost; re-dispatch with the answer only if it can't be continued. An answer that changes the task goes, quoted, into the task reviewer's prompt.

**BLOCKED:** The implementer cannot complete the task. Assess the blocker:

1. If it's a context problem, provide more context and re-dispatch with the same model
2. If the task requires more reasoning, re-dispatch with a more capable model
3. If the task is too large, break it into smaller pieces
4. If the plan itself is wrong, escalate to the human (a dispatched worker escalates through its channel)

**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change.

**Failing tests the implementer didn't cause** (its report's Failing tests field): one an earlier task on this branch caused reopens that task as a finding; anything else goes to `docs/implementation/triage.md` with the test's name and the first failing assertion, and is ledgered. Neither holds the current task.

**Failing tests the task's own change caused** are the task's to fix before it completes: send them back to the implementer as findings. On a `review` task they join the review's findings in the fix loop; on an `automated` task they are a fix round before you run its named commands.
