# Slice 3.5 — Developer-only retrieval probe: first captures, parity test

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.4](./04-retrieval.md) (serializes the C4
  ranker trace; parity test re-runs the pure module)
- **Blocks:** none in M3 (M7.5's rich probe surface reads what this
  slice writes)

## Goal

The first `probe_captures` writes and the correctness backstop for
everything 3.4 built: the capture writer records light-mode ranker
state in the ranker's transaction behind the two-level gate, FIFO
eviction holds the per-story cap, a developer-only inspection
affordance makes captures readable during implementation, and the
simulator-vs-prod parity test pins the pure-ranker contract. The
rich user-facing probe screen is deliberately M7.5.

## Background

Calibrating the ranker later is guesswork without captured state,
and debugging retrieval failures without a capture of the failed
pass is the worst UX — so captures land with retrieval, not with
the probe screen. A capture is written right after the ranker emits
its selection, in the same transaction, including on failure (with
`failure_reason`). Both gates default off
(`app_settings.diagnostics.enabled` and
`stories.settings.probe_mode_active`, landed in M1.5); capture
writes are best-effort and never block a turn. The simulator that
M7.5 ships must mirror the prod ranker bit-for-bit — the shared
pure module plus this slice's parity test is what makes that
trustworthy.

## Required reading

- [`probe.md → Capture model`](../../../../memory/probe.md#capture-model)
  — when a capture writes, the light-mode field inventory, the
  `probe_captures` shape, FIFO-at-100, capture cost + best-effort
  posture.
- [`probe.md → Simulator contract`](../../../../memory/probe.md#simulator-contract)
  — the pure-module mirror requirement this slice's parity test
  pins (the simulator UI itself is M7.5).
- [`probe.md → Followups → v1-internal`](../../../../memory/probe.md#v1-internal)
  — the simulator-math validation item this slice resolves.
- [`probe.md → Schema delta`](../../../../memory/probe.md#schema-delta)
  — gates, non-delta-logged posture, fork behavior.
- [`observability.md → Gating model`](../../../../observability.md#gating-model)
  — the diagnostics master gate the app-level toggle rides.

## Scope: in

- **Capture writer:** assemble the light-mode record from the C4
  trace (identity, params snapshot, three queries with per-query
  metadata and Q3 sentence scores, per-type candidate rows, funnel
  summary, structural-floor list, stale counts); gzip payload;
  write in the ranker's transaction; FIFO eviction at 100 per story
  (across branches) in the same transaction; failure-capture path
  with `failure_reason` and partial state; write-failure = log and
  proceed.
- **Gating:** both toggles must be on to write; existing captures
  stay readable when either flips off; per-capture delete and
  clear-all-for-story actions (direct deletes, not delta-logged).
- **Deep-mode hook:** the capture writer accepts a
  per-capture deep flag and stores candidate vectors when
  set. The reader-side opt-in checkbox ships with the M7.5 surface;
  in M3 the flag is reachable from the dev affordance only.
- **Developer inspection affordance:** a minimal dev-only surface
  (debug-gated; shape at planning — likely a JSON view over
  captures for the open story) plus structured `logger.debug`
  score summaries per pass. Not a designed screen; M7.5 owns that.
- **Parity test:** re-run the pure ranker module over a captured
  state with identical params and assert selection + score
  equality with the capture — the simulator-math validation item
  from probe.md, resolved here.

## Scope: out

- The memory-probe screen (browse / inspect / simulate UX),
  per-entry probe icon in the reader, per-turn deep-capture
  checkbox by the Send button — M7.5.
- Cross-capture aggregation, multi-turn playback — post-v1 per
  canon.
- Any new schema — `probe_captures` and both gate fields landed in
  M1.5.

## Acceptance criteria

- With both gates on, a turn writes one light capture whose payload
  round-trips (gunzip → JSON) to the documented field inventory
  against a fixture pool; with either gate off, no write (vitest).
- Capture 101 for a story evicts the oldest across branches in the
  same transaction (vitest).
- A fault-injected retrieval failure (embedder down at query embed)
  still writes a capture with `failure_reason` and the reached
  partial state (vitest).
- A fault-injected capture write failure (constraint violation)
  does not fail the turn; the failure logs (vitest).
- Parity: for three captured fixture states (normal, budget-
  saturated, bypass-triggered), the re-run module reproduces the
  captured selection and scores exactly (vitest — the load-bearing
  test).
- Fork: captures do not copy to the new branch (vitest over the
  branch-copy exclusion — asserted against the M1.5 fork fixture if
  present, else a direct query assertion).

## Tests

- Vitest throughout (this slice is mostly tests + a writer);
  no Storybook scope (no designed compounds).
- Manual: dev affordance renders captures for a real seeded story;
  a deep capture's size lands in the expected ~100x-light order.

## Open questions

All nine were resolved in slice planning (2026-08-08); the resolutions
are in [Implementation notes](#implementation-notes) below and in the
canonical docs they updated. The questions are kept as written — the
cost figures they quote are the pre-slice ones, and the five under
_The capture contract_ only read correctly as a set. One finding the
slice did not settle, the reach of `probe.md`'s light-mode simulatable
list, outlived it and moved to [`triage.md`](../../../triage.md).

### Planning

- **Dev affordance shape** — JSON viewer route vs logger-only; pick
  the cheapest thing that lets implementation debugging read
  captures (it is disposable once M7.5 lands).
- **Params-snapshot source** — v1 ranker knobs are hardcoded
  constants (tuning surface parked); the snapshot should read the
  same constants module so the simulator diff is honest. Confirm at
  planning.

### The capture contract — decide these together

Five questions about what a capture must carry for the simulator to be
honest. **Decide them as one pass**, not one at a time: each proposes a
change to `CandidateTrace` or the capture payload, and settling them
independently risks a shape that satisfies each answer and no coherent
whole. All five were surfaced by the M3.4 review (2026-08-03 to
2026-08-08) against a `CandidateTrace` that is already shipped, so every
answer that adds a field is also a change to M3.4's ranker output.

- **The outcome exposes text-presence, not the presence the ranker
  blended.** `RetrievalOutcome` returns `queries` (whose `presence`
  means "this query's text was non-empty"), while `runRetrieval`
  re-derives a second triple from the vectors actually returned and
  blends on that one — a short embed result nulls a slot the flag
  still reports present. A replay reconstructing the blend from the
  captured `queries.presence` therefore reproduces a **different**
  `simBlend` than the run it is replaying, on exactly the case the
  derivation exists to handle. Either capture the vector-presence
  triple, or fold presence into `Candidate.sims` as
  `readonly [number | null, number | null, number | null]` — `null`
  meaning "no query vector", which `0` currently cannot be
  distinguished from — and delete the second type.
- **`chapters_old` is not captured, and two already-promised
  simulations need it.**
  [`probe.md → Simulatable parameters`](../../../../memory/probe.md#simulatable-parameters)
  promises per-type `λ` re-tuning "re-compute `recency_factor` from
  stored `chapters_old`", but neither `CandidateTrace` nor
  `CaptureCandidate` carries the field — only the derived
  `recency_factor`. The same list promises `pin_signal` overrides, and
  those need it too: from a captured `(recency_factor, pin_signal)`
  pair the simulator can solve back to `λ × chapters_old` and
  recompute, **except at `pin_signal = 1`**, where `recency_factor` is
  1 regardless of age and the pair carries no information about it —
  which is exactly the "what if I unpin this pinned row?" question.
  So this is not only the λ slider. Either add `chapters_old` to the
  capture shape, or drop both λ and pin overrides from the simulatable
  list.
- **`rankPerType` recomputes `tokensEstimated` rather than accepting a
  captured one.** `score` (`lib/retrieval/ranker.ts`) always evaluates
  `input.countTokens(c.renderedText) + params.typeOverhead[type]`;
  there is no path that takes a stored value. The simulator re-runs
  budget-fill against `CaptureCandidate.tokens_estimated`, so any drift
  between the js-tiktoken version that produced the capture and the one
  loaded at replay makes the two disagree row by row with nothing
  reporting it. The ranker's purity is not at issue — it is
  deterministic given its inputs; the tokenizer is one of those inputs
  and the capture does not pin it. Wants either an optional
  captured-token input on `RankTypeInput`, or a recorded encoding
  identity the simulator refuses to replay across.
- **Should `tokensEstimated` become nullable for pre-filtered rows?**
  Eager tokenization is the pass's largest CPU term — ~46 ms of a
  ~140 ms pass, see
  [`retrieval.md → Per-turn cost budget`](../../../../memory/retrieval.md#per-turn-cost-budget)
  — because the non-nullable field forces every **pool** row to be
  tokenized to seat a fraction of them. Capping it at the kept
  `preFilterTopN` would recover most of that. The argument that it
  costs no contract is that a pre-filtered row can never be seated by
  the simulator, so its token count is never read — but that rests on
  `preFilterTopN` being **absent** from probe.md's simulatable list,
  and absent is not the same as decided: the non-simulatable section
  covers pool composition and says nothing about the pre-filter. Making
  the field nullable forecloses ever making `preFilterTopN` simulatable
  without a capture-format change. Decide the pre-filter's
  simulatability first; the nullability follows from it.
- **`StructuralFloor` declares a narrower shape than it holds.** The
  floor is built over loaded source rows, so every row still carries
  `embeddingStale` (and lore's `keywords`) at runtime; only
  `generation-context.ts`'s projection drops them. A capture that
  serialises `floor.sceneEntities` whole ships those fields into the
  payload with no error. Project at construction, or make
  `buildStructuralFloor` generic over the row types so the wider
  value is visible rather than silently erased.

### Other

- **The barrel exports the ranker functions without their input
  types.** `rankAll` / `rankPerType` are public; `RankAllInput` and
  `RankTypeInput` are not, so a replay caller can invoke them but
  cannot name their argument except as
  `Parameters<typeof rankAll>[0]`. `QueryWeights` (the type of
  `RankerParams.weights`) is likewise unexported.
  [`code-conventions.md → Module structure`](../../../../code-conventions.md#module-structure)
  makes types part of the public API. Surfaced by the M3.4 review
  (2026-08-06).
- **`RankerParams` needs validation at the point a capture feeds
  it.** The ranker defends `pinSignal` and `chaptersOld` and says why
  — "pin_signal arrives unvalidated from the probe's per-row
  override" — while the ten tunables share that source and get
  nothing. `lambdaDiv` at 0 makes every type select nothing silently;
  `tauRevive` below 0 bypasses the decay model entirely; a negative
  `pinBoost` inverts the pin, so pinning a row demotes it. The
  constants are frozen as of M3.4, so code cannot retune them; a
  stored capture can. Add an `assertRankerParams` at the capture
  reader. Surfaced by the M3.4 review (2026-08-06).

## Implementation notes

### The capture contract

The capture-contract questions above were settled as one set, because
each answer constrains the next.

- **A captured candidate carries `display_text` — the exact string
  the ranker priced — for rows that survive the pre-filter, and
  `null` for pre-filtered ones.** `tokens_estimated` takes the same
  nullability. The simulator can therefore re-tokenize any row it
  could ever seat, which makes tokenizer drift detectable, and pays
  nothing for rows it cannot. The cost is that `preFilterTopN`
  becomes non-simulatable — it already was, since re-slicing changes
  MMR's pick order and that needs the per-row vectors, but it is now
  written down under
  [`probe.md → Non-simulatable parameters`](../../../../memory/probe.md#non-simulatable-parameters)
  rather than merely absent.
- **`rankPerType` defers tokenization until after the pre-filter
  slice.** This is the answer to the nullability question and the
  pass's largest single saving: ~140ms → ~108ms at dim 384, and the
  chapter-match boost's own cost from ~44ms to ~24ms, since the rows
  it admits land beyond rank 200. A future executor should not read
  the merged `Scoring, tokenization, MMR, budget fill` row in
  [`retrieval.md → Per-turn cost budget`](../../../../memory/retrieval.md#per-turn-cost-budget)
  as a lost measurement: tokenization now runs inside the same
  kept-row map that feeds MMR, so the split is not separable even in
  principle, and a fifth `RetrievalTimings` span would break that
  type's stated disjoint-sub-span contract.
- **Query presence folded into `Candidate.sims` as
  `[number | null, number | null, number | null]`.** Two triples
  existed — `queries.presence` ("this query's text was non-empty")
  and a second re-derived from the vectors actually returned — and
  they could disagree. One triple makes the divergence structurally
  impossible, and `null` expresses "no query vector", which `0`
  cannot. `QueryTextPresence` survives: `buildQueryStack` still needs
  text-presence to assemble `embedTexts` and `distributeQueryVectors`
  to re-expand the batch. It left the **ranker's** input surface
  only.
- **Replay token counts arrive as an optional `capturedTokens` map on
  `RankTypeInput`, beside a recorded `tokenizer: { encoding, version }`
  in the payload.** Production omits the map. This is what makes the
  parity test prove the capture is _sufficient_ to reproduce the run
  rather than merely that the ranker is deterministic in-process —
  which a recompute-based test would have passed tautologically. The
  lookup lives in the deferred tokenization step, not inside
  `score()`.
- **`chapters_old` and `common_knowledge` are captured per row.**
  Both are inert today — `chaptersOld` is hardcoded 0 until M5 closes
  a chapter, so `recencyFactor` is always 1 in production — and both
  become load-bearing the moment M5 lands, which is before M7.5 builds
  the simulator. `chapters_old` unblocks per-type `λ` re-tuning and
  `pin_signal` overrides, the latter unrecoverable from the captured
  `(recency_factor, pin_signal)` pair at `pin_signal = 1`.
  `common_knowledge` is what tells a common-knowledge happening apart
  from a non-common one whose `pin_signal` happens to be 0.
- **`CaptureParamsSnapshot` embeds `RankerParams` verbatim**, in the
  ranker's camelCase, beside the story-settings knobs. Restating the
  fields was the alternative and it had already drifted:
  `lambda_div` / `kw_boost` were typed `Record<string, number>` but
  ship as scalars, and `pinBoost` / `preFilterTopN` / `typeOverhead`
  were absent entirely. Embedding the type makes a newly added
  tunable a compile error rather than a silently missing capture
  field.
- **`buildStructuralFloor` projects its rows down to the declared
  shape at construction.** The floor was built over loaded source
  rows and carried `embeddingStale` (and lore's `keywords`) at
  runtime with nothing to stop a serializer shipping them. Type now
  equals runtime value, so no consumer has to know what to strip —
  and the capture writer was the consumer most likely to forget.
  `generation-context.ts` keeps its own narrower projection.

### Other resolved decisions

- **Deep mode stores candidate vectors only — the query vectors the
  scope bullet and canon both promised are not captured, and canon was
  amended rather than the code.** Nothing on probe.md's simulatable
  list reads one: `λ_div` needs candidate-vs-candidate cosines, and a
  re-blend reads the per-row `sim_q1..3` the capture already stores.
  Threading them would mean widening M3.4's `RetrievalOutcome` — they
  are a local inside `runRetrievalPass` — for a dev-only, deep-only
  field with no consumer. `CaptureQuery.vector` went with the input.
- **The failure arm is widened with a `partial` bag** rather than the
  writer reaching into the pass. `runRetrieval` accumulates into a
  shared state object and the `VectorInvariantError` catch relocated
  so it can read it. `lib/retrieval` keeps returning data and stays
  free of probe concerns, and the failure paths stay unit-testable on
  a returned value rather than on a spy.
- **`assertRankerParams` sits at the capture-read boundary**
  (`lib/probe/read.ts`), not in the ranker. The constants are frozen
  in code; a stored capture is not, and the read boundary is the only
  place an untrusted param set enters.
- **Write-and-evict is one `runInTransaction` batch**, with eviction
  as a single `DELETE ... LIMIT -1 OFFSET 100` issued after the
  INSERT. There is no ranker transaction to join — the ranker is pure —
  so "same transaction" means atomicity of write-and-evict, not
  enlistment in a wider one. No read-then-write race, and a table
  somehow over cap self-heals on the next write.
- **The writer takes `appGateOn` / `storyGateOn` booleans and owns the
  AND**; the phase supplies them. Keeps `lib/probe` free of a
  `lib/stores` import while leaving "either gate off ⇒ no write" unit
  testable inside `lib/probe`.
- **Compression is `fflate`.** Pure JS, so no dev-client rebuild;
  `gzipSync` / `gunzipSync` are synchronous, which matters on a
  transaction path with no `await` to spend; identical on Hermes,
  Node and Chromium, where `CompressionStream` and `node:zlib` are
  both unavailable on Hermes.
- **The inspection affordance is `app/dev/probe-captures.tsx`**, an
  unlinked harness route following the `app/dev/db-check.tsx`
  precedent — no `t()`, no Storybook, no shell. Deleting it when
  M7.5 ships the real surface touches nothing else. It cannot be unit
  tested (the `unit` project cannot render RN-Web chrome), so it is
  covered by manual smoke only.

### Findings a later slice inherits

- **Deep captures are far more expensive than canon estimated.**
  Measured at the cost-budget fixture's 1067-row pool: ~340 ms at
  dim 384 and ~700 ms at dim 768 to build and gzip, against the
  "<20 ms" `probe.md` had carried and a ~108 ms retrieval pass. It is
  synchronous, on the JS thread, inside the write transaction, and it
  is that expensive because deep mode serializes a vector for every
  **pool** row as JSON numbers. Light mode is ~11 ms and unaffected.
  Deep mode is per-capture opt-in from a dev route, so this bounds
  M7.5's design rather than any shipped path; the measured figures
  and the two levers now live in
  [`probe.md → Capture cost`](../../../../memory/probe.md#capture-cost).
- **`probe.md`'s light-mode simulatable list is wider than light mode
  can deliver.** Seven of its nine parameters feed `score`, which drives
  MMR's greedy pick order, which needs vectors light mode does not
  store. Of the two that apply after MMR, only the per-type budgets
  genuinely survive: `min_score_threshold` compares against `mmrScore`,
  and the capture stores `final_score`, which is the pre-MMR raw score.
  The slice kept its scope and ran the parity test on **deep** captures
  — the only mode that reaches `mmrRank` at all — and filed the list's
  correction to [`triage.md`](../../../triage.md). It is a product call
  about what the probe offers, not an implementation choice.
- **The fork-exclusion test is structural, not behavioral.** Branch
  fork is unimplemented (M6.1), so `lib/probe/fork.test.ts`
  source-scans for `probe_captures` references outside an audited list
  instead of forking a branch. It will not catch a generic M6.1
  copier that never names the table. The canonical exclusion now has a
  row in
  [`data-model.md → Branch model`](../../../../data-model.md#branch-model);
  replacing the scan is filed to triage against M6.1.
