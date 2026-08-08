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
  per-capture deep flag and stores query + candidate vectors when
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

_Populated at finish: notable deviations from the plan and resolved developer decisions._
