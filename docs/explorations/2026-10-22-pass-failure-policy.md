# Pass failure policy

A periodic-classifier pass that comes due must succeed before its
branch's next turn. `failed-persistent` goes, with the retry count, the
cadence suspension and the `classifier-offline` pill. Designed
2026-10-22, after the gated classifier (#634, #635, #637) landed.

## Why

Under the old policy a failed pass was retried at the next three turn
commits while those turns went ahead, then the branch went
`failed-persistent`: passes stopped until the user pressed `[Retry]` in
Story Settings · Memory. Two problems:

- **Turns ran over unclassified prose.** Each retry let a turn generate
  with memory a window or more behind, and the suspension let every
  later turn do so. That is story memory degradation, which the
  developer does not accept.
- **A short outage became a permanent stop.** Four failures take a few
  turns, so a provider outage, rate limiting or a network drop switched
  memory off until the user found a settings button. In code nothing
  showed it: no UI reads classifier status, nothing calls
  `runClassifierNow`, and the `classifier-offline` pill code is never
  raised (roadmap M7.2).

Backing off by turns was considered and rejected: it heals outages, but
still lets turns run over a failed pass.

## The rule

1. **A chained pass** (after a turn's commit) gets the in-call retries
   only: `callWithRetry`'s provider and parse attempts
   (`lib/ai/generate.ts`). If they fail, the status records the
   failure, the watermark stays, and a warning toast says
   `Memory update failed. It runs again before your next turn.`
2. **At Send**, a pass that is owed runs first, as deferred work runs
   today: its own run and `actionId`, the banner reading
   `Updating memory before your turn…`, committing before the turn's
   first write. A pass is owed when one is deferred for the branch or
   the cadence is due (the unprocessed entries reach
   `classifierCadence`).
3. **If it fails there, the Send fails.** No user_action is written,
   the composer keeps the text, and the failure shows as the reader's
   transient-failure system entry with its cause: `Retry`,
   `View details`, `Dismiss`, or the existing configuration rows
   (`Fix profile`, `Assign profile`) for a broken reference. `Retry`
   runs the pass alone; Send runs it first again. Cancel cancels the
   Send, as today.

Every Send is a fresh attempt; there is no counter. Status is
`idle | running | failed`, `failed` carrying the last error.
`[Run classifier now]` stays, enabled in `idle` and `failed`.

**Why the cadence check, not only the mark.** `txState.deferred` lives
in memory, so a restart dropped the debt and the next turn ran before
the pass. The cadence check reads persisted state (the watermark and
the count), so a failure, an interrupt, a crash and a restart all end
at the same place: the next Send runs the pass first. The mark stays
for what else it does: it stops a regenerate's commit from chaining the
interrupted pass straight back, and it holds the close's slot.

**Regenerate needs no phase 0.** A turn is generated only after the
pass owed at its Send succeeded, and a pass chained after a turn
covers that turn's own entries, which the turn was generated without
by design. A regenerate of the head turn sees what the original saw.

## Timeout

The pass's bound is the classifier profile's `timeout` when the user
set one, longer or shorter, and ten minutes otherwise. The 300-second
hard cap, which a longer profile timeout couldn't raise, goes: a pass
must now succeed, so a cap shorter than the model needs would stop the
story outright. A bound stays at all so a hung provider ends in an
error the user can act on, not an endless spinner.

`data-model.md` gives a profile's `timeout` a 60-second default, which
code doesn't apply (an unset profile timeout sets none). Applied, it
would fail most passes on a local model, and long narrative turns. The
default becomes unset: no limit, except the pass's ten minutes.

## Chapter close

The same rule, recorded in the chapter-close agent design followup: a
close that fails runs before the next turn and must succeed. A failed
phase-0 pass stops the chain there; it runs before the next turn like
any failed pass, and the close, still owed, follows it.

## Adversarial pass

- **The story can be stopped.** A dead provider, a model that can't
  produce the schema, or a prompt past the model's window stops every
  turn on the branch until fixed. That is the intent; the exits are
  fixing the cause and sending again, or rolling back below the
  watermark. Two open items become blockers, not only quality limits:
  the context-growth followup (a long story's pass prompt outgrowing
  the classifier's window) and the writer map's parse-failure check (a
  model that can't produce the larger schema).
- **A pass left `running`.** An orphan whose reversal failed holds the
  branch `running` until a boot reverses it. Before, memory paused
  silently; now Send refuses with the recovery error. Most cases heal
  at the next boot. The parked permanent cases (a column shape gone
  after a migration, a table gone from the registry, an integrity
  refusal) leave the branch unable to take turns; a branch from an
  entry before the orphan starts idle and can.
- **Embedder down.** If reconciliation's transient embeddings fail the
  pass, the embedder now blocks the turn. The turn's own retrieval
  already blocks on it, so nothing new for the user; the plan checks
  it.
- **Cadence lowered in settings.** A lower cadence can make a pass due
  at the next Send; it runs first. Consistent with the setting.
- **A failure toast and then a system entry** for the same pass: the
  toast says the pass will run again; the system entry is the turn
  being refused. Two events, two surfaces.

## Integration plan

- `memory/classifier.md`: When it runs, Interrupted then deferred,
  Pill, Status block, Manual override, Persistence; `Auto-retry policy`
  renamed `Failure policy` (inbound anchors in `generation-pipeline.md`
  and the roadmap).
- `generation-pipeline.md`: `nextMemoryRun` (only `running` holds),
  Work deferred to the next Send, the cadence-chain paragraph,
  Recovery-failure policy.
- `memory/chapter-close.md`: Phase 0's failed-pass paragraph.
- `data-model.md`: fork resets a failure, not `failed-persistent`; a
  profile's `timeout` default.
- `ui/patterns/generation-status-pill.md`: `classifier-offline`
  removed; config pre-flight failures move to the system entry.
- `ui/screens/reader-composer/reader-composer.md` and `.html`: the
  error-pill bullet and wireframe state removed; the system entry's
  row and the failure toast added.
- `ui/screens/story-settings/story-settings.md` and `.html`: status
  states and Run now.
- `implementation/roadmap.md`: M7.2's invisible-failure entry removed;
  the classifier panel, the prompt-budget entry and the five-minute
  hold reworded.
- `followups.md`: a new "Implement the pass failure policy"; the
  context-growth, writer-map and chapter-close design entries amended.
