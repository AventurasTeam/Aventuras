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

- **Smoke trigger + synthetic-story scaffolding is debug-only.**
  [Slice 1.7c](./implementation/milestones/01-spine/slices/07c-smoke.md)
  shipped a `__DEV__`-gated "Run smoke" button in the reader-composer,
  the `components/reader/smoke/` module (the `'smoke'` pipeline, its
  phase, and `runSmoke`'s synthetic story/branch bootstrap), and the
  `registerStubProvider()` dev seam in `lib/ai`. All of it is
  scaffolding flagged `TODO(spine)`; remove the module, the reader-route
  trigger, and the `lib/ai` seam when real story-creation and
  provider-settings UI land.
