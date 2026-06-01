# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Remove the temporary `__DEV__` landing debug reader affordance.**
  [Slice 1.7b](./milestones/01-spine/slices/07b-ui-shells.md#implementation-notes)
  added an "Open reader (debug)" button on the landing (`app/index.tsx`),
  `__DEV__`-gated, as the only M1 path into the reader (no story /
  create-flow exists yet). Remove it once a real story-list (cards +
  create-flow) provides a path to the reader — route to that slice's
  Open questions when the post-M1 story-list slice is defined.
- **Reconcile `EntryCard.EntryMeta` with the canonical `EntryMetadata`.**
  `EntryCard` defines its own display shape (`{ tokens: { reply, reasoning? } }`)
  with no explicit link to `lib/db`'s `EntryMetadata` (`tokens.completion`,
  etc.). The `reply` name matches the reader-composer spec's display
  vocabulary, but the projection (DB `completion` to UI `reply`) lives
  nowhere yet — Milestone 1's reader renders no real entries. When the
  reader is wired to live `story_entries` (the DB-to-UI mapping), make
  that projection explicit and decide whether `EntryMeta` should derive
  from `EntryMetadata` rather than restate it. Owner: the reader-data
  slice; route to its Open questions when defined.
