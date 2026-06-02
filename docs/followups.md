# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## Data-model

- **Periodic classifier must yield to reverse-replay (regenerate /
  rollback / swipe-switch) — design before dev.** The classifier's
  `concurrencyPolicy.yieldsTo` is empty by design: it does not abort
  when a foreground pipeline starts, because for a _forward_ new turn
  its write-set is disjoint and its input prose stays valid, so
  coexistence is safe and cancelling would waste work (see
  [`classifier.md → Background-task framing`](./memory/classifier.md#background-task-framing)).
  That reasoning fails for a _reversal_: regenerate, entry-delete
  rollback, and swipe-switch all reverse the suffix the classifier may
  be mid-consuming. Left running, it commits happenings / awareness
  derived from prose that no longer exists — landing _after_ the
  reversal (so the positional sweep misses them), with a dangling
  `entryId`, polluting retrieval. The fix to design and land:
  - Give reverse-replay a concurrency-visible run kind (e.g.
    `'rollback'`) the classifier can `yieldsTo`; regenerate, delete,
    and swipe-switch all compose that reversal. It needs a run
    identity regardless — reversing a turn that created happenings
    writes the classifier's own write-set, so under
    single-writer-per-write-set they already contend.
  - Yield is a **synchronous barrier**: reversal registers, the
    classifier aborts and discards in-flight work, then the reversal
    proceeds. A concurrent yield lets a stale post-reversal commit
    slip through.
  - Already-committed classifier deltas need no special handling — the
    positional sweep reverses those at or above the bound and keeps
    those below; only uncommitted in-flight computation is discarded.
  - Blanket yield-on-any-reversal is an acceptable v1
    over-approximation; a reversed-range-vs-classifier-window
    intersection check is a later optimization.
  - Touches the
    [pipeline concurrency model](./generation-pipeline.md#concurrency-model)
    and [`classifier.md`](./memory/classifier.md#background-task-framing);
    surfaced by
    [parked → reader-composer swipes](./parked.md#reader-composer-swipes--alternate-takes-per-turn)
    but is a general rollback concern, and rollback is v1.

## UX

- **Smoke trigger + synthetic-story scaffolding is debug-only.**
  [Slice 1.7c](./implementation/milestones/01-spine/slices/07c-smoke.md)
  shipped a `__DEV__`-gated "Run smoke" button in the reader-composer,
  the `components/reader/smoke/` module (the `'smoke'` pipeline, its
  phase, and `runSmoke`'s synthetic story/branch bootstrap), and the
  `registerStubProvider()` dev seam in `lib/ai`. All of it is
  scaffolding flagged `TODO(spine)`; remove the module, the reader-route
  trigger, and the `lib/ai` seam when real story-creation and
  provider-settings UI land.
