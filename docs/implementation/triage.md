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
- **Lift master-detail hardware-back into a shared hook.**
  `MasterDetailLayout`'s phone list-first collapse needs Android
  hardware-back to pop detail→list before exiting the route. Slice 1.7b
  wired this route-local in `app/settings/index.tsx` with a focus-scoped
  `BackHandler`; it can't live in the shell because the shell's Storybook
  stories render with no navigation context, so `useFocusEffect` would
  throw there. When the next `MasterDetailLayout` consumer lands (World /
  Plot), extract a shared `useMasterDetailBack` hook so the behavior
  isn't re-implemented and the back-exits-route bug isn't reproduced —
  route to that slice's Open questions then.
