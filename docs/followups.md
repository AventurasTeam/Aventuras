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

### Translation rows in per-story export / import

Per-story exports now strip `stories.settings.models`,
`stories.settings.embedding_*`, and vec0 vectors (folded into
[`data-model.md → Backup & export format`](./data-model.md#backup--export-format)
during the provider/profile deletion-semantics design). Cached
translation rows weren't addressed — open whether they travel with
a per-story export and how they reconcile with the importer's
translation backend + language settings on the receiving end.
Lands at the next pass over translation pipeline / export format.

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
