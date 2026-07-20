# Slice 3.4 — Retrieval: sync stage, query stack, ranker, budgets, memory templates

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.1a](./01a-embedder-core.md) (vec0 +
  query embeds via C1). Develops against `pnpm db:seed` rows —
  no build gate on [Slice 3.3](./03-classifier.md); real-data
  validation is a milestone DoD item. Pairs with
  [Slice 3.1b](./01b-embedder-lifecycle.md) via C8 (the
  sync-failure `Switch embedder` route) — doc-contract, not a
  gate.
- **Blocks:** [Slice 3.5](./05-dev-probe.md) (capture writer
  serializes the C4 trace; parity test needs the pure module)

## Goal

Each turn's prompt gains a retrieved slice: the pre-retrieval sync
stage embeds dirty rows, three query vectors rank per-type
candidate pools through the pure ranker module (scoring, decay,
pinning, high-similarity bypass, MMR, greedy budget-fill), and the
selected bundle renders into the prompt through new memory pack
templates. `js-tiktoken` lands as the first budget-accounting
consumer; injected awareness rows get their `retrieval_count`
increment; `lore.keywords` drives the keyword pathway.

## Background

Retrieval is a phase in the per-turn pipeline, after Pre commits
the user-action delta. It never reads vec0 without syncing first —
the sync stage embeds every `embedding_stale` row in one batch, and
a row it cannot embed blocks the turn like a failed LLM call.
Scoring blends three query similarities, decays by chapter age
scaled by the pin signal, adds keyword boosts, and revives
deeply-decayed rows on very high similarity; MMR de-dupes within
each type; hard-partitioned per-type token budgets fill greedily
and stop at the noise floor. Chapter summaries and the
chapter-match boost are structurally present but inert until M5
closes chapters. The ranker must be a pure module — the probe's
simulator re-runs it bit-for-bit.

## Required reading

- [`retrieval.md`](../../../../memory/retrieval.md) — the whole
  doc; load-bearing sections:
  [`Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle),
  [`Query construction`](../../../../memory/retrieval.md#query-construction--three-vector-stack),
  [`Candidate pools`](../../../../memory/retrieval.md#candidate-pools),
  [`Hybrid retrieval per type`](../../../../memory/retrieval.md#hybrid-retrieval-per-type),
  [`Keywords schema`](../../../../memory/retrieval.md#keywords-schema),
  [`Pinning`](../../../../memory/retrieval.md#pinning--decay_resistance),
  [`Per-type retrieval budgets`](../../../../memory/retrieval.md#per-type-retrieval-budgets),
  [`The ranker`](../../../../memory/retrieval.md#the-ranker) with
  [`Pseudocode`](../../../../memory/retrieval.md#pseudocode).
- [`architecture.md → Retrieval / injection phase`](../../../../architecture.md#retrieval--injection-phase)
  — structural floor, injection-mode filtering, POV-awareness
  union.
- [`architecture.md → Prompt templates and authoring`](../../../../architecture.md#prompt-templates-and-authoring)
  and [`Context groups`](../../../../architecture.md#context-groups)
  — where memory templates extend the engine — plus
  [`Empty retrieval buckets — author contract`](../../../../architecture.md#empty-retrieval-buckets--author-contract)
  for the bucket guards.
- [`model-management.md → Embed failure is blocking`](../../../../memory/model-management.md#embed-failure-is-blocking)
  — the sync-stage failure surface this slice implements.
- [`edge-cases.md → Layer A`](../../../../memory/edge-cases.md#layer-a--retrieval-time-same-name-suppression)
  — same-name suppression of staged entities in the pool build.
- [`memory/probe.md → What gets captured`](../../../../memory/probe.md#what-gets-captured--light-mode-default)
  — the trace fields C4 must expose (consumed by 3.5).
- [`tech-stack.md → js-tiktoken`](../../../../tech-stack.md#6-js-tiktoken)
  — encoding choice, on-demand table loading, accepted drift.

## Scope: in

- **Pre-retrieval sync stage:** batch-embed `embedding_stale` rows
  via C1 at the head of the retrieval phase (inserted before the
  narrative phase through the C6 phase-list seam); blocking failure
  surface (`Retry / Switch embedder / Roll back this turn`,
  next-turn affordance disabled — the switch action imports 3.1b's
  swap-dialog open action per C8); stale-at-KNN rows excluded from
  pools.
- **Query stack:** Q1 user action; Q2 structural digest
  (code-template floor + optional piggyback `summary` enrichment,
  handed off by 3.2's parse);
  Q3 heuristic prose extract (per-sentence scoring over the
  entity-name and lore-keyword indexes, top-K concatenated);
  weight re-normalization when a component is missing; cold-start
  per canon.
- **Pool build:** structural floor first (mode-dependent prompt
  buffer, active+in-scene, location, active threads, `always`
  rows), then per-type pools — three-sub-pool entity model,
  POV-awareness union, common-knowledge bypass, pending / resolved
  / failed threads by mode, Layer-A same-name suppression,
  chapter-summaries pool (empty until M5).
- **Pure ranker module (C4):** scoring function with decay + pin +
  bypass + kw_boost, chapter-match boost hook, top-200 pre-filter,
  MMR, greedy budget-fill with noise floor; per-candidate trace
  output per C4; v1 constants hardcoded per the parked tuning
  surface.
- **Budgets + tokens:** `js-tiktoken` install; token estimation
  (rendered-field text + per-type overhead constants, measured once
  macros are concrete); per-type budgets read from story settings
  (additive-slider UI is M7-era; values flow from
  `default_story_settings` copies); oversized-candidate skip
  semantics.
- **Memory pack templates:** bundled-pack extension rendering the
  selected bundles (entity / lore / happening / thread blocks,
  staged-entity framing with bracketed IDs, awareness `source`
  verbatim); empty-bucket guards per the author contract;
  `retrieval` context-group variables registered in
  `templateContextMap.ts`.
- **`retrieval_count` increment** on injected awareness rows,
  delta-logged under the turn's `action_id` (feeds chapter-close 3d
  in M5.2).
- **Token-progress strip:** wire the reader's zero-filled strip
  (M2.5 interim) with real open-region token counts if it falls out
  of the tokenizer work cheaply; otherwise record the deferral in
  Implementation notes (milestone open question).

## Scope: out

- Capture writing and the simulator —
  [Slice 3.5](./05-dev-probe.md).
- Chapter summaries as a populated pool and the per-chapter
  `retrieval_count` reset — M5.2.
- Ranker-knob user tuning surface —
  [parked](../../../../parked.md#tier-2-retrieval-ranker-knob-tuning-surface).
- LLM-fallback leg of `auto` injection mode — post-v1 posture per
  canon (keyword + embedding ship; the enum stays honest).
- Budget-slider settings UI — M7-era settings depth; values are
  consumed here, edited later.

## Acceptance criteria

- Seeded story (entities, lore with keywords, happenings +
  awareness, threads): a turn's rendered prompt contains the
  structural floor plus per-type retrieved blocks within each
  type's budget; an `injection_mode='disabled'` in-scene entity
  still injects (structural invariant); a disabled off-scene one
  never does (vitest over rendered output; extends the M2.6
  structural-floor test).
- Sync-before-read: rows dirtied by a simulated classifier write
  embed at the next turn's sync stage before KNN; a fault-injected
  embed failure blocks the turn with the three-action surface and
  the affordance re-enables after Retry succeeds (vitest +
  Storybook for the surface).
- Ranker unit matrix over fixture pools: pin flat-tops decay;
  `τ_revive` bypass revives a decayed high-sim row; MMR drops a
  near-duplicate; budget-fill skips an oversized candidate and
  stops at the noise floor; common-knowledge rows score without
  recency or pin (vitest on the pure module — no store, no DB).
- Q3 extraction picks the fixture's entity-name / keyword / verb
  sentences over filler (vitest).
- POV union: awareness of any in-scene character enters the pool;
  a non-scene character's awareness does not.
- `retrieval_count` increments exactly once per injected awareness
  row per turn, delta-logged, and reverses on CTRL-Z of the turn.
- Per-turn retrieval cost on a seeded 10k-row pool stays within the
  same order as the
  [PoC baseline](../../../../memory/retrieval.md#performance-characteristics--poc-findings)
  (~43 ms per KNN query at 10k rows on flagship Android) on desktop
  (logged timing, not a CI gate).

## Tests

- Vitest: pure-ranker matrix (the load-bearing suite), query
  construction incl. cold start and re-normalization, pool
  exclusions, sync-stage failure paths, token estimation, template
  rendering with empty buckets, registry parity (context keys vs
  `templateContextMap`).
- Storybook: sync-failure surface compound if extracted.
- Manual smoke: seeded story on desktop + Android; eyeball injected
  bundle relevance (tuning is out of scope; sanity only).

## Open questions

- **Entity-name / keyword index shape** — in-memory per-branch
  index rebuilt on hydrate vs SQL-side matching; Q3 and Layer A
  share it.
- **Per-type overhead constants** — measured after the memory
  macros are concrete; record the measured values.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
