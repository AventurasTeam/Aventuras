# The Fix Loop

Part of aventuras-subagent-driven-development. The task review reported spec ❌, a Critical or Important finding, or a ⚠️ item you confirmed as a real gap.

Before the loop starts, three routes leave it immediately:

- Record Minor findings in the ledger as you go (`Task <N>: minor (deferred): <one-liner>`); the final whole-branch review gets that list so it can triage which must be fixed before merge. A roll-up nobody reads is a silent discard. Minor findings never enter the loop.
- Outside this change goes to `docs/implementation/triage.md`. Don't hold the task for it.
- A finding labelled plan-mandated, or any finding that conflicts with what the task's text requires, sets the plan against the review: settle it before the loop, by the rules in `references/handling-reports.md` → NEEDS_CONTEXT. A fix toward the task's evident intent (a test that can fail in place of one that asserts nothing) is yours to settle; one that changes what the task builds needs canon or the slice doc to settle it, or goes to your human partner (a dispatched worker asks through its channel). Ledger what you settle as `settled:` before you act on it; a finding settled as a fix enters the loop with the rest. Do not dismiss the finding because the plan mandates it, and do not dispatch a fix that contradicts the plan without that entry.

Everything else enters the loop, spec and quality findings together: one fix round addresses both verdicts. A fix round is one fix dispatch plus one scoped re-review. Five rounds maximum per task:

**Rounds 1-3 — resume the original implementer** (SendMessage to the agent ID the ledger's `dispatched` line holds). Send it the open findings verbatim. Its context is intact: it knows the task, the code, and its own choices. If it can't be continued, dispatch a fresh implementer at the task's tier, carrying the task's full text, the report-file path, and the findings — the report file is the persistent memory either way.

**Rounds 4-5 — dispatch a fresh implementer one Model tier up** (`cheap` → sonnet, `standard` → opus; `capable` stays opus), with the task's full text, the report-file path, the open findings, and this framing: "A prior implementer attempted this task [N] times; you own it now. Read the report file for what was tried." A loop that survives three resumes usually means the implementer cannot see its own problem — fresh eyes and a capability bump in one move.

**Every round, either way:** the implementer fixes, re-runs the tests covering the amended code, appends its fix report to the same report file, and replies with the short status. Before re-dispatching the reviewer, confirm the fix report contains the covering tests, the command run, and the output; dispatch the re-review once all three are present. Name the covering test files in the fix message — a one-line fix does not need the whole suite.

**A disputed finding** is one the implementer answers with evidence instead of a fix: its short status says `DISPUTED`, and the report file holds the evidence. Don't send it to the re-review and don't rule on it. Take it to your human partner now, through the channel when you are a dispatched worker: the finding verbatim, the implementer's evidence, and whether it is load-bearing. Ledger `Task <N>: disputed — <finding one-liner> — asked <id>`. The round's other findings go on through the loop; a dispatched worker holds only the tasks that build on a load-bearing dispute, as at the cap. The answer withdraws the finding (ledger it with the answer's label) or keeps it. A kept finding re-enters the loop at the next round; after round 5 it gets the cap's answer path instead (a fresh implementer at the round 4–5 tier, then one scoped re-review).

**The re-review is scoped.** Dispatch [re-review-prompt.md](../re-review-prompt.md) with the findings list, the task's text, the report file, and the fix range (FIX_BASE = the head the previous review saw). The re-reviewer verdicts each finding ADDRESSED or NOT ADDRESSED and flags new breakage in the fix diff only. New Critical/Important breakage in the fix diff joins the open findings list. Out-of-scope observations go to the ledger as deferred minors, or to triage when marked `pre-existing` — they never extend the loop.

**After each round,** append to the ledger:
`Task <N>: fix round <R>/5 (<X> addressed, <Y> open — <finding one-liners>; commits <a7>..<b7>)`

Never fix findings yourself in the controller session — your context stays clean for coordination, and controller fixes skip review.

**The cap.** When round 5's re-review still leaves findings open, stop dispatching. Five rounds that didn't converge mean the reviewer and the implementers disagree, or the plan is wrong: that is your human partner's call, not yours. Send every open finding in one question, through the channel when you are a dispatched worker: the finding verbatim, what the rounds tried (from the report file), whether it is load-bearing (a later task builds on it, or it reveals a plan defect), and your recommendation. Ledger `Task <N>: capped — <K> open`, with the question.

- The task is `complete (<K> open at the cap)`. A dispatched worker carries on with the tasks that don't build on a load-bearing finding and ledgers the rest `held:`, as SKILL.md → Dispatched worker describes for any open question.
- When the answer comes, act on it: a fix is a fresh implementer at the round 4-5 tier plus one scoped re-review; anything else is recorded with the answer and its label.

Never rule on a finding before the cap to end the loop: that is pre-judging with a different name. A finding you doubt goes back to the implementer with the rest; only the implementer's evidence makes it a dispute, and only your human partner settles one. A silent discard is forbidden.
