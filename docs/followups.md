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
- **Abort-before-stream keep-vs-reverse is unresolved.** Slice 2.5's
  `submitTurn` shares one actionId between the user_action write and
  the pipeline run (C6), so a preflight failure (e.g. no narrative
  profile resolves) now reverses the user's typed turn along with
  the failed generation, not just mid-stream cancel. Whether that's
  the right UX for this specific case — as opposed to mid-stream
  cancel, which [Slice 2.7](./implementation/milestones/02-first-user-loop/slices/07-wiring.md)
  already settles as "reverse" — is still open; resolve at Slice 2.7
  planning.
- **Jump-to-bottom's `End` key and Actions-menu entry aren't wired.**
  Slice 2.5's `reader-composer.md#jump-buttons` scope names all three
  affordances (floating button, `End` key, Actions-menu "Jump to
  bottom"), but only the floating button is wired
  (`app/reader-composer/[branchId].tsx`) — no `End`-key handler, and
  `AppActionsMenu` has no reader-contextual entries yet. Low priority
  (the button alone satisfies the slice's acceptance criteria); wire
  the other two whenever the reader's Actions-menu contextual zone is
  next touched.
