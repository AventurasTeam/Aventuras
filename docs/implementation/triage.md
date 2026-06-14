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

- **Story-delete cascade must drive asset trashing once refcount-trashing
  lands.** [Slice 2.4](./milestones/02-first-user-loop/slices/04-story-list.md)'s
  `deleteStory` cascade bulk-removes `entry_assets` rows but only drops the
  junction rows — it does **not** trash the now-orphaned `assets` (matching
  M1b/06-content's posture, since refcount-driven trashing is M4/M9 and the
  boot sweep is M9.3). Per the
  [trash-can pattern](../data-model.md#assets-images--future-media), removing
  the last `entry_assets` reference should set `pending_delete_at` + rename to
  `.trash`. When M4/M9 builds refcount-trashing, it must hook the **story-delete
  cascade path**, not just the standalone entry/branch delete arms, or deleting
  a story with assets leaks blobs. No live impact in M2 (M2 stories carry no
  assets). Route into the M4/M9 refcount-trashing slice's Open questions when
  that slice is authored.
