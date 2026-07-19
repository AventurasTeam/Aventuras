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

- **RNRH text not selectable on native** (2026-07-19, rich-entry
  design pass). Plain-entry prose on Android can't be long-press
  selected — RNRH renders RN `Text` without `selectable`. The
  [rich-entry pattern](../ui/patterns/rich-entry-rendering.md#scope-gates)
  gives rich cards WebView-native selection, widening the
  asymmetry. Decide whether to enable `selectable` across the
  RNRH renderers.
- **Anchor `href` policy across entry render paths** (2026-07-19,
  rich-entry design pass). `<a href>` survives sanitize on every
  path: web DOMPurify scheme-filters it (`javascript:` blocked,
  `http(s)`/`mailto` kept) and a click **navigates the Electron
  window today**; native RNRH renders anchors inert; the rich
  card adds its own
  [navigation lock](../ui/patterns/rich-entry-rendering.md#navigation-lock).
  Decide one policy for all paths — strip `href` entirely, or
  keep-and-intercept via the system browser — and close the live
  web/plain exposure.
