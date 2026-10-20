# Periodic classifier — yielding to prose reversals

Resolves the `Periodic classifier must yield to reverse-replay
(regenerate / rollback / swipe-switch)` followup previously tracked in
[`followups.md`](../followups.md), removed by the commit that lands
this exploration. The followup named the race and sketched a fix
direction (give reversal a concurrency-visible run kind the classifier
`yieldsTo`); this session pins the mechanism, corrects two load-bearing
details the sketch glossed, and traces the integration.

The substrate this builds on was already pinned: the
[concurrency model](../generation-pipeline.md#concurrency-model)
(`gateBehavior`, `concurrencyPolicy`, `checkConcurrencyContract`), the
[classifier's background-task framing](../memory/classifier.md#pipeline-framing),
chapter-close's
[`drainRunningPeriodicClassifier()` precedent](../memory/chapter-close.md#phase-0--catch-up-passes),
and positional rollback in
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback).

## What this design closes vs. defers

Closes:

- The reversal taxonomy: which operations cancel the in-flight
  classifier and sweep its deltas, and which don't (the
  pure-edit-undo carve-out).
- The classifier phase contract: a distinct `deltas.source` so CTRL-Z
  can skip it, and the abort-free critical section that keeps the
  standard abort path correct.
- The reversal-side orchestration: a generalized `waitForClassifier`
  primitive (finish vs cancel disposition), the wait-then-sweep
  ordering, and the `reversalInProgress` lockout that stops a
  freshly-scheduled classifier slipping into the gap.

Defers (to a new data-model followup):

- The lag-induced **over-reversal** — valid facts about surviving
  turns swept because the classifier committed them late at tail
  log positions. The clean fix is a position-reservation scheme for
  background work; out of scope for a concurrency barrier.
- The exact suffix boundary (`group ∪ > max(group)` vs `≥ min`) and
  the aggressive-cadence CTRL-Z-of-a-turn dangling tail, both facets
  of the same ordering gap.

## The race

The periodic classifier reads a recent prose window and commits a
**single burst of deltas** (happenings, awareness, status flips,
first-introduction descriptions) at the end of its run — one LLM
call, one JSON response, one burst. Its deltas carry their own
`actionId`, disjoint at field granularity from the per-turn pipeline,
which is why forward coexistence is safe and its
[`yieldsTo` stays empty](../memory/classifier.md#pipeline-framing).

That safety argument inverts for a **reversal**. Regenerate,
entry-delete rollback, and swipe-switch all reverse a contiguous delta
suffix the classifier may be mid-consuming. Two failure directions:

- **Dangling (under-reversal).** An in-flight classifier whose burst
  commits _after_ the reversal's positional sweep lands its rows at
  fresh positions above the new head — derived from prose that no
  longer exists, with a dangling `entryId`, missed by the one-shot
  sweep, polluting retrieval.
- **Over-reversal.** The lagging classifier commits happenings about
  _old, surviving_ turns at _new_ tail positions; a positional sweep
  of a later turn reverses them even though their subject survives.
  Deferred — see [Followups](#followups).

This design fixes the dangling direction (a concurrency barrier plus
the existing positional suffix sweep) and scopes the over-reversal
direction out.

## Reversal taxonomy

A reversal cancels the in-flight classifier and sweeps its suffix
deltas **iff it reverses prose** — i.e. reverses a `story_entries`
suffix. A pure
world-state edit-undo does neither, because an edit has no
classifier-derived dependents.

| Operation                                    | Reversal kind     | Barrier and sweep? |
| -------------------------------------------- | ----------------- | ------------------ |
| Regenerate (head turn)                       | positional suffix | yes                |
| Entry-delete rollback (to entry M)           | positional suffix | yes                |
| Swipe-switch (head take)                     | positional suffix | yes                |
| CTRL-Z of a turn (group has `story_entries`) | positional suffix | yes                |
| CTRL-Z of an edit (no `story_entries`)       | action-scoped     | **no**             |

**CTRL-Z discriminates on the undone action group.** If the group
creates a `story_entries` row — an AI reply or a user-written action —
it is a prose reversal: position-based suffix reversal, which sweeps
the classifier's derived deltas, with the barrier fired. If the group
is a pure world-state edit (an entity field, a lore body, a thread
status — no `story_entries` row), it stays action-scoped: reverse
exactly that group's deltas, classifier untouched, no barrier. The
discriminator is _did prose appear or vanish_, not _did any
`story_entries` column move_ — a metadata-only touch (a manual
`worldTime` correction, were it ever to land) stays action-scoped.

This closes the otherwise-awkward case the user named: a user edits a
field while the classifier runs, the classifier commits above the
edit, and the user then undoes the edit — action-scoped reversal
touches only the edit, leaving the unrelated classifier rows intact.

## Classifier phase contract

### Off the undo selection via a distinct source

There is no persisted "undo stack." Undo is computed from the delta
log — CTRL-Z finds the head action group and reverses it; redo is the
only explicit structure (in-memory, non-persisted, cleared on any new
action). So keeping the classifier "off undo" is a statement about
CTRL-Z's **selection** step.

The classifier's deltas get a distinct `deltas.source` value,
`periodic_classifier`, split out from the generic `ai_classifier`
(which thereby connotes per-turn piggyback specifically — the two
could not be told apart before, yet piggyback is part of an _undoable_
AI-reply turn). **CTRL-Z's head-selection skips `periodic_classifier`
groups**, reaching past a classifier commit sitting at the literal log
head to the most recent _user_ action group. The classifier's
`actionId` still lives in the log for crash recovery; it is merely
never the _selected_ undo target.

### The abort-free critical section

The classifier keeps a real per-run `actionId` — it has a
`pipeline_runs` row, and crash recovery reverse-replays orphans _by_
`actionId`, so a mid-burst crash (deltas commit as per-action
transactions) is only recoverable through it.

A run has two stretches with respect to `signal.aborted`:

- **The LLM call** is abort-responsive. On abort the SDK rejects
  mid-stream, the phase discards and returns `aborted`, with **zero
  deltas committed**.
- **The post-LLM data-processing-and-commit phase** (whatever it
  contains — parse, the delta burst) is the **abort-free critical
  section**. Once the response is in hand the run ignores
  `signal.aborted`, runs to completion, commits the burst, and returns
  `completed`.

The **commit burst is the linearization point**: the classifier never
returns `aborted` holding committed deltas. This is the single
invariant the whole design rests on.

Its consequence is that the **standard abort path stays correct with
no special disposition**. `abortRun` on a classifier only ever fires
when nothing is committed → it reverse-replays zero deltas. When the
burst _did_ commit, the run returned `completed` and the positional
suffix sweep is the sole authority over its ≥ N rows. There is no
"non-reversing abort" — the existing machinery is already right
_because_ of the invariant above. (An earlier framing in this session
posited a special non-reversing disposition; it was an artifact of
wrongly assuming the classifier dribbles deltas across its LLM call.
It does not — one response, one burst — so the simpler contract holds.)

## Reversal-side orchestration

### The `waitForClassifier` primitive

Generalize chapter-close's `drainRunningPeriodicClassifier()` into one
primitive, `waitForClassifier(disposition)`, with two dispositions.
Both **await the in-flight run's terminal resolution** and are a
**no-op when no classifier is running** (the common case — most
reversals happen while it is idle):

- **`'finish'`** (chapter-close phase 0): no abort signal — await the
  natural commit, because it wants the classification done.
- **`'cancel'`** (prose reversal): fire `signal.abort()`, then await
  terminal — cancelling the doomed LLM call so the user is not made to
  wait it out.

The disposition difference is the only thing that separates the two
consumers; the await-terminal structure is shared.

### Ordering — wait, then sweep

A prose reversal does `await waitForClassifier('cancel')` and _then_
runs the positional suffix sweep. By the abort-free invariant the only
committed classifier state at sweep time is all-or-nothing (nothing,
or a whole burst), and the sweep is the authority over its ≥ N rows.
The barrier's worst-case wait is an SDK stream-cancel (LLM-call case)
or the parse-plus-burst (data-processing case) — low-ms either way,
since embeddings are pre-read at retrieval, not computed on the
classifier's path.

### The classifier-start lockout

The one genuinely new mechanism. A freshly-scheduled classifier could
otherwise start _between_ the wait and the sweep — read pre-sweep
prose, then commit doomed deltas after. So the reversal sets a
`reversalInProgress` flag in `txState` before the `waitForClassifier`
call and clears it after the sweep commits. `checkConcurrencyContract` treats it as a
block on `periodic-classifier` starts, alongside `blockedBy`; the same
flag also gates user edits (extend `isUserEditBlocked`) so a
concurrent edit cannot insert a delta into the sweep's DB-await
windows. The synchronous-`setState` invariant the chained-transition
guarantee already leans on closes the check-vs-register window.

This is the piece Approach A (modelling reversal as a `'reversal'`
pipeline kind with the classifier declaring `yieldsTo: ['reversal']`)
would have gotten for free. We rejected A: a reversal is a
**synchronous, destructive, LLM-free** log operation, and forcing it
into the pipeline shape means it writes no forward deltas under its
own `actionId`, opting out of the framework's central transaction
invariant and giving crash recovery a nonsensical zero-delta orphan to
reason about. The lockout is ~3 lines in the existing entry algorithm
— cheaper than a pipeline that disables what makes it a pipeline. So
`yieldsTo` correctly stays unused in v1.

### Blanket, single-run-per-kind

At most one classifier run exists ([single run per
kind](../generation-pipeline.md#invariants)), so the barrier aborts
whichever run is in flight with no branch or reversed-range
intersection check — the blanket v1 over-approximation the followup
endorsed. A run scheduled _after_ the reversal reads post-reversal
prose and is correct, so the lockout is transient — released the
instant the sweep commits. The reversed-range-vs-classifier-window
intersection check is a later optimization, not v1.

## Edge cases and the load-bearing invariant

**Load-bearing invariant:** the classifier never returns `aborted`
holding committed deltas. If a future edit slips an abort-check into
or after the commit burst, the standard `abortRun` would reverse-replay
below-bound valid rows and silently corrupt surviving state. **Guard
it** with a comment at the burst site and a test that aborts mid-burst
and asserts the run returns `completed` with the full burst intact.

- **Crash mid-barrier.** Clean in every split. The sweep is a single
  atomic SQLite transaction (crash → `ROLLBACK` → the reversal simply
  did not happen). The in-flight classifier is either a zero-delta
  orphan (recovery deletes the row) or a committed-and-valid burst
  (survives; the user's re-attempt sweeps it). `reversalInProgress`
  lives in `txState`, so a crash clears it — no stale lock on reboot.
- **Chapter-close ↔ reversal.** Cannot collide. Chapter-close holds
  `hard-gate`, so a user-initiated reversal is blocked from starting
  during it; and a reversal is not a pipeline-chain origin, so
  chapter-close cannot chain-fire out of one.
- **Classifier in retry / failed-persistent.** No in-flight run →
  `waitForClassifier` no-ops and the reversal proceeds. A retry scheduled
  _after_ reads post-reversal prose and is correct. The reversal does
  not touch retry-count or failed-persistent status — those track
  provider health, orthogonal to prose.
- **Redo after a turn-undo.** A positional turn-CTRL-Z moves the whole
  swept suffix (turn entry plus classifier rows) onto the redo stack;
  redo forward-replays it, entry before happenings. Consistent.

**Honest boundary.** This design's charter is the _in-flight_ race
(barrier) plus the _already-committed about-this-turn_ sweep — both
correct. The residual over-reversal is a memory-_quality_ degradation
(some valid facts vanish until re-derived), never corruption or crash,
and is deferred whole. See [Followups](#followups).

## Integration

Canonical edits:

- [`data-model.md`](../data-model.md):
  - `deltas` table — add `periodic_classifier` to the `source` enum
    (ER diagram).
  - `Entry mutability & rollback` — CTRL-Z gains (a) a head-selection
    skip of `periodic_classifier` groups, and (b) the
    prose-vs-edit discriminator: an undone group containing a
    `story_entries` create is a positional suffix reversal; a pure
    edit stays action-scoped.
- [`generation-pipeline.md`](../generation-pipeline.md):
  - Concurrency model — the `waitForClassifier(disposition)` primitive,
    the `reversalInProgress` gate in `checkConcurrencyContract`, and
    the `isUserEditBlocked` extension. Note `yieldsTo` stays unused
    and why.
- [`classifier.md`](../memory/classifier.md):
  - Background-task framing — the abort-free critical section
    invariant, the `periodic_classifier` source / off-undo-selection
    property, and the reversal-quiesce contract sitting alongside the
    (unchanged, still-correct) forward-coexistence reasoning.
- [`chapter-close.md`](../memory/chapter-close.md):
  - Phase 0 — `drainRunningPeriodicClassifier()` becomes
    `waitForClassifier('finish')`.
- [`delta-log-row.md`](../ui/patterns/delta-log-row.md):
  - `source` union plus badge / label mapping gains
    `periodic_classifier`.

Followups: remove the resolved entry; add the reservation followup
below.

## Followups

The over-reversal gap and its two facets become one new data-model
followup. Direction sketched: a **position-reservation scheme** —
background work claims a `log_position` slot up front so its writes
sort by _semantic_ position rather than commit time, which closes both
the over-reversal (about-old-turns no longer land at tail positions) and
the aggressive-cadence CTRL-Z-of-a-turn dangling. It is a delta-log
substrate change well outside a concurrency barrier.

The followup must also decide a v1 stopgap: until the scheme lands,
over-reversed facts are only recovered if the classifier re-derives
them, which requires its last-processed watermark to be reversal-aware
(swept with the suffix). If the watermark is operational state a
positional sweep does not touch, the loss is permanent — so the
followup pins whether v1 wants the reversal-aware watermark or accepts
the loss.
