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

- **Jump-to-bottom's `End` key and Actions-menu entry aren't wired.**
  Slice 2.5's `reader-composer.md#jump-buttons` scope names all three
  affordances (floating button, `End` key, Actions-menu "Jump to
  bottom"), but only the floating button is wired
  (`app/reader-composer/[branchId].tsx`) — no `End`-key handler, and
  `AppActionsMenu` has no reader-contextual entries yet. Low priority
  (the button alone satisfies the slice's acceptance criteria); wire
  the other two whenever the reader's Actions-menu contextual zone is
  next touched.
