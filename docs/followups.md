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

### Diagnostics hub — per-tab body design pass for tab 2

[`diagnostics.md`](./ui/screens/diagnostics/diagnostics.md) has
the hub shell (top-bar, tab strip, story selector, cross-tab nav,
empty states, mobile expression) designed, plus tab 1 (memory
probe — existing spec), tab 4 (logs — closed out at
[2026-05-27 exploration](./explorations/2026-05-27-diagnostics-tab4-logs-close-out.md)),
and tabs 3 + 5 (call log + delta log — batched close-out at
[2026-05-27 exploration](./explorations/2026-05-27-diagnostics-tabs-3-5-close-out.md)).
Tab 2 (per-turn inspector) has body content described but at the
"what's in this tab" level, not pixel-level interaction. It needs
its own detail design pass before
[M7.3](./implementation/roadmap.md#m7--app-settings--diagnostics--onboarding)
can scaffold it. Tab 2's two-pane shape embeds subsets of Tabs 3
and 4 inside its detail pane (cross-cut HTTP calls + log entries
filtered by the inspected turn's `actionId`), so it deliberately
lands last to inherit those tabs' detail-pass row shapes.
