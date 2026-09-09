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

## Memory pipeline

- **Nothing bounds the length of what reaches the embedder.** Every
  embed input is built by concatenation and handed over as-is. Q1 is
  `userAction` trimmed, with no length limit on the composer that
  produces it —
  [`retrieval.md → Q1`](./memory/retrieval.md#q1-user-action) records
  why the query stack deliberately does not cap it, and says the real
  bound belongs here. The sync stage is the same shape:
  `entityRenderedText` and `loreRenderedText`
  (`lib/retrieval/rendered-text.ts`) concatenate user-authored fields
  with no bound either. The local runtime absorbs this silently by
  truncating at the tokenizer's own limit; a provider backend is the
  open half, because an oversized request is rejected rather than
  truncated and an embed failure is blocking by design
  ([`retrieval.md → Compute lifecycle`](./memory/retrieval.md#compute-lifecycle)).
  The rejection fails the retrieval phase and the orchestrator aborts
  the run, so a long pasted action or a long lore body fails the turn
  rather than degrading it. **Verified:** that no bound exists at any
  of those sites, and that a query-embed failure propagates to a failed
  run. **Assumed:** that a configured provider rejects rather than
  truncating — nothing here has been run against one, and that
  assumption is what sets the severity. Owned by the embedder service
  rather than by retrieval or the composer: a cap at one call site
  leaves the others open. Surfaced in the triage pass, 2026-09-09.
