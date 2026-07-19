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

- **Single-document reader — close out validation, then retire
  the per-entry tail.** Implementation landed 2026-07-19 per
  [`ui/patterns/reader-document.md`](./ui/patterns/reader-document.md):
  shared fully-rendered flow list on all platforms, the
  `'use dom'` reader document, native host integration with
  handshake and recovery — device-verified for landing, scroll,
  boundary loads, inline edit with IME (go: no native-edit-sheet
  fallback needed), delete/rollback, security probes, and
  renderer-kill recovery. Remaining from the
  [validation checklist](./ui/patterns/reader-document.md#validation-checklist):
  streaming feel on device, fonts under CSP, release-build
  memory, TalkBack, `expo export`, and the uncovered anchor
  scenarios (reasoning expansion and footer re-wrap above the
  fold). Once those pass, delete the dormant per-entry tail:
  `rich-entry-content.native.tsx`, `rich-entry-dom.tsx`,
  `rich-entry-visibility.ts`, `entry-window.tsx`, reader RNRH
  usage, and — audit-gated — the juice/cheerio native sanitize
  path with its Metro pin.
