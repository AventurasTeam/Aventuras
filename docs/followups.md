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

- **Embedder failure skips the one retrieval pathway that needs no
  embedder.** `runRetrieval` returns on a failed query embed roughly
  fifty lines before `buildKeywordInjections` runs, so when the embedder
  actually fails — model not loaded, ONNX fault, provider down — the
  [keyword injection](./memory/retrieval.md#keyword-injection) pre-pass
  never executes and a story on `mode='inject'` gets nothing, where it
  could have had its keyword hits. The pathway is vector-independent by
  construction (`run.ts` says so at the call site: "Needs no vectors —
  which is why a keyword hit can seat a row the KNN missed"), and a
  zero-query stack already reaches it correctly; only the failure arm
  short-circuits past it. Fixing it means deciding what a partial
  success returns, so it touches `RetrievalPartial`'s failure arm and
  the probe's
  [failed-capture lane](./memory/probe.md#failed-captures) rather than
  being a local reorder. Surfaced 2026-09-06 designing the
  [query stack](./explorations/2026-09-06-retrieval-query-stack.md).

- **M4.4 — "Upgrade to current default" story-open prompt deferred from 3.1b.**
  Canon ([`retrieval.md → Model swap UX`](./memory/retrieval.md#model-swap-ux))
  names a second dialog entry point: a prompt when opening a story whose
  embedding model differs from the current app default; accepting it fires
  the swap dialog. Slice 3.1b shipped only the Story Settings entry point
  (planning decision 2026-07-24) — the prompt needs its own "stops nagging
  until the next manual swap attempt" persistence decision. Owner: a future
  reader/settings slice. Surfaced by M3.1b Task 14 (2026-07-24).

- **M4.5 — Custody of a failed turn's text rests on one deletable system entry.**
  A failed or refused turn reverse-replays its own `user_action` with the
  rest of its action group (`abortRun` → `reverseReplayDeltas`, and
  `submitTurn`'s own rejected arm), so the text the user typed survives
  only as `metadata.systemFailure.submission` on the failure entry that
  replaces it — pinned by `submit-turn.test.ts`'s
  `expect(branchEntries('b1')).toHaveLength(0)`. Two paths then delete
  that entry with no restore: **Dismiss** (`dismissSystemEntry` is a bare
  `clearSystemEntry` plus `reload`, and dismissing an error is not a
  request to discard the draft behind it), and the pre-dispatch tail clear
  (fixed for regenerate's rejected arm in M3.10, still uncompensated when
  the dispatch throws). In-session `lastSubmission` masks both; after a
  restart the text is gone. The alternative shape to weigh: keep the
  `user_action` standing on failure and let Retry re-dispatch against it —
  which is exactly what regenerate already does — so only an explicit
  cancel reverses it, returning the text to the composer. That would make
  the failure entry a pure notice with no custody role and delete this
  class of bug rather than patching its instances. Wants a reader-composer
  design pass, not a local fix. Raised 2026-08-16.
