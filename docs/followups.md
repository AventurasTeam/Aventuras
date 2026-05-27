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

### Diagnostics hub — per-tab body design passes for tabs 2, 3, 5

[`diagnostics.md`](./ui/screens/diagnostics/diagnostics.md) has
the hub shell (top-bar, tab strip, story selector, cross-tab nav,
empty states, mobile expression) designed, plus tab 1 (memory
probe — existing spec) and tab 4 (logs — closed out at
[2026-05-27 exploration](./explorations/2026-05-27-diagnostics-tab4-logs-close-out.md)).
Tabs 2, 3, and 5 (per-turn inspector / call log / delta log) each
have body content described but at the "what's in this tab" level,
not pixel-level interaction. Each needs its own per-tab detail
design pass before
[M7.3](./implementation/roadmap.md#m7--app-settings--diagnostics--onboarding)
can scaffold it. The passes can sequence (one per tab) or batch;
likely owned by the implementer of M7.3 with design support
per tab. Tab 4's close-out extracts the
[MultiSelect pattern](./ui/patterns/multi-select.md) that tabs
2 / 3 / 5 will inherit for their multi-select filter dimensions.
