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

_Empty._

Drained 2026-08-20. Four items were fixed on the branch that surfaced
them — the corrupt-draft clobber, the suggestion re-roll's reversal
gate, a deliberate cancel logged as an embedder fault, and
`embedding_stale`'s column default. Two went to their owning
milestone's slice-authoring notes in [`roadmap.md`](./roadmap.md):
the per-row delete-vector sweep to M4.2, the main-process
unhandled-rejection handler to M7.3. One went to
[`parked.md`](../parked.md) with a stated signal —
`runSyncStage`'s embed payload, whose fix trades away a documented
no-partial-success contract. Three entries carried claims that were
wrong or materially incomplete and were corrected before they moved.

Previously drained 2026-08-18: items with a downstream owner went to
that milestone's slice-authoring notes in
[`roadmap.md`](./roadmap.md), items with a stated revisit trigger to
[`parked.md`](../parked.md), and the unowned M3 remainder to
Slice 3.12 — since split (2026-08-19) into
[Slice 3.12a](./milestones/03-memory-floor/slices/12a-runtime-integrity.md)
and
[Slice 3.12b](./milestones/03-memory-floor/slices/12b-ui-tooling-contracts.md).
