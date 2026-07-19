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

- **Single-document reader spike — evaluate, then design pass.**
  Per-entry WebView cards shift on swap-in and cost ~50MB each;
  the candidate endgame hosts the existing web reader surface
  (EntryWindow web branch + EntryCard) in **one** DOM component
  on native. Read-only spike at dev route `/dev/reader-webview`
  (seeded DB required). If the spike holds on device (boot
  latency, scroll feel, memory, rich rendering), the pivot needs
  a full design pass revising
  [`ui/patterns/rich-entry-rendering.md`](./ui/patterns/rich-entry-rendering.md)
  (it supersedes the per-entry native tail and the "chrome stays
  native" scope gate). User-endorsed direction 2026-07-19.

- **Rich-entry rendering — on-device validation.** Implementation
  landed 2026-07-19 per
  [`ui/patterns/rich-entry-rendering.md`](./ui/patterns/rich-entry-rendering.md).
  Remaining work: per-machine dev-client rebuild
  (`react-native-webview` is a new native module — see
  [lessons-learned → native deps](./implementation/lessons-learned/native-dep-expo-link.md)),
  then the
  [on-device validation checklist](./ui/patterns/rich-entry-rendering.md#validation-checklist)
  on real low-end Android hardware. The checklist's rich-heavy
  story ships in the seed dataset ("The Gallery of Impossible
  Rooms", incl. the item-7 security probes); on device, seed it
  via the dev surface's "Reseed database" action. Until
  validated, Android rich cards ride the untested WebView path
  (web/desktop shadow-host path is exercised by Storybook tests).
