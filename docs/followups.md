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

## UX

- **M4.5 — Custody of a failed turn's text rests on one deletable system entry.**
  A failed or refused turn reverse-replays its own `user_action` with the
  rest of its action group (`abortRun` → `reverseReplayDeltas`, and
  `submitTurn`'s own rejected arm), so the text the user typed survives
  only as `metadata.systemFailure.submission` on the failure entry that
  replaces it — pinned by `submit-turn.test.ts`'s
  `expect(branchEntries('b1')).toHaveLength(0)`. Two paths then delete
  that entry with no restore: **Dismiss** (`dismissSystemEntry` is a bare
  `clearSystemEntry` plus `reload`, and dismissing an error is not a
  request to discard the draft behind it), and the pre-dispatch tail clear
  (fixed for regenerate's rejected arm in M3.10, still uncompensated when
  the dispatch throws). In-session `lastSubmission` masks both; after a
  restart the text is gone. The alternative shape to weigh: keep the
  `user_action` standing on failure and let Retry re-dispatch against it —
  which is exactly what regenerate already does — so only an explicit
  cancel reverses it, returning the text to the composer. That would make
  the failure entry a pure notice with no custody role and delete this
  class of bug rather than patching its instances. Wants a reader-composer
  design pass, not a local fix. Raised 2026-08-16.
