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

- **Rich-entry rendering — on-device validation.** Implementation
  landed 2026-07-19 per
  [`ui/patterns/rich-entry-rendering.md`](./ui/patterns/rich-entry-rendering.md).
  Remaining work: per-machine dev-client rebuild
  (`react-native-webview` is a new native module — see
  [lessons-learned → native deps](./implementation/lessons-learned/native-dep-expo-link.md)),
  then the
  [on-device validation checklist](./ui/patterns/rich-entry-rendering.md#validation-checklist)
  on real low-end Android hardware. Until validated, Android rich
  cards ride the untested WebView path (web/desktop shadow-host
  path is exercised by Storybook tests).
