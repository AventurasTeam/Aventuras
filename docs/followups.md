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

- **Single-document reader — implement per pattern doc.** Design
  pass resolved 2026-07-19 (spike device-verified; exploration
  record `2026-07-19-single-document-reader`); canonical spec in
  [`ui/patterns/reader-document.md`](./ui/patterns/reader-document.md).
  Work, in dependency order per the exploration's integration
  plan: shared flow-and-engine-culling entry list (retires both
  `EntryWindow` branches, desktop included), the `'use dom'`
  reader document (in-document scroll policy, inline edit,
  streaming), native host integration (loading treatment, bridge
  and handshake, recovery), then the per-entry tail retirements
  and the
  [on-device validation checklist](./ui/patterns/reader-document.md#validation-checklist)
  (IME is the go/no-go for the native-edit-sheet fallback). The
  seeded Gallery story + PROBE entries (`/dev/reseed`) feed
  validation; the shipped per-entry path remains the floor until
  host integration lands.
