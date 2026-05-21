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

---

## UX

### Per-story export format scope

[`data-model.md → Backup & export format`](./data-model.md#backup--export-format)
lists what a per-story `.avts` export includes and what it strips,
but neither list is exhaustive. `probe_captures` — diagnostic data
that branch-forking already drops — is never named, and the
inclusion enumeration omits tables like `character_relationships`
and `branch_era_flips`. Wants a short dedicated session that
settles, table by table, what an `.avts` per-story export should
carry. Surfaced while resolving the translation-rows export
question (see
[`explorations/2026-05-21-translation-export-import.md`](./explorations/2026-05-21-translation-export-import.md)).

### Actions menu broader design pass

The
[Diagnostics Hub](./ui/screens/diagnostics/diagnostics.md)
adds a single entry (`Open Diagnostics Hub`) to the global Actions
(⚲) menu. The menu has not yet had a focused design pass — its
full inventory, organizational shape (groups, separators, mobile
expression), and contextual variants per screen are
unspecified. Surfaced during the observability design
session; lands as its own pass when the next set of Actions-menu
candidates is ready (or when the menu's current sparseness
becomes a UX friction in real use).
