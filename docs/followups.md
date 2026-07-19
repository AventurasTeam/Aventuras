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

- **Rich-entry rendering — implement per pattern doc.** Design
  pass resolved 2026-07-19; canonical spec in
  [`ui/patterns/rich-entry-rendering.md`](./ui/patterns/rich-entry-rendering.md).
  Remaining work: `react-native-webview` install + dev-client
  rebuild (see
  [lessons-learned → native deps](./implementation/lessons-learned/native-dep-expo-link.md)),
  implementation, then the
  [on-device validation checklist](./ui/patterns/rich-entry-rendering.md#validation-checklist).
  Until it lands, the floor is the juice-inlined RNRH subset.
  Wanted earlier rather than later (user-confirmed 2026-07-18).
