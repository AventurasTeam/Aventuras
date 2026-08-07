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
and stop at the noise floor. The ranker must be a pure module —
the probe's simulator re-runs it bit-for-bit.

Everything chapter-shaped is structurally present but inert until
M5 closes chapters: chapter summaries, the chapter-match boost, and
recency decay. Decay is inert because `chaptersOld` has no source
until chapters exist, so it is assembled as `0` for every candidate
and `recency_factor` collapses to `1`. That also neutralises the pin
signal, which only ever appears as a scale on the decay exponent —
so `decay_resistance` is recorded by the classifier and read by the
ranker without being able to move a score. See
[Open questions](#open-questions) for the shape M5 should land.

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
  surface (`Switch embedder / Retry / Dismiss` — no rollback action,
  the orchestrator already reverse-replayed the turn, and no composer
  gate, since a resubmit re-runs the same blocking sync stage; the
  switch action imports 3.1b's swap-dialog open action per C8);
  stale-at-KNN rows excluded from pools.
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

Status at close — criteria 2 through 6 met, criterion 1 met in part,
criterion 7 met by the timing log — is recorded under
[Notable deviations from the brief](#notable-deviations-from-the-brief).

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

- **Where does the sync-failure `Switch embedder` action land the
  user?** — **resolved:** it navigates the story-settings route with
  the memory tab preselected and then opens the dialog, matching
  3.1b's pill rather than growing a reader-side host. The dialog
  state is sticky, so the ordering is a readability choice, not a
  race: the Memory panel is simply the only mount host, and a route
  that never gets there renders the open nowhere.
- **Entity-name / keyword index shape** — **resolved:** neither
  option as posed. The index is built in memory from the source rows
  the pass has already loaded, so it costs no query of its own and
  cannot drift from the rows the floor and the pools are reading.
  Q3 and Layer A share it.
- **Per-type overhead constants** — **resolved:** measured against
  the shipped macro; the values and what shapes them are canon at
  [`retrieval.md → Token estimation`](../../../../memory/retrieval.md#token-estimation),
  the measurement narrative is in
  [Per-type overhead constants](#per-type-overhead-constants) below.
- **vec0 returns L2 distance, not cosine similarity** — the
  `0005_embedder_vec0.sql` tables declare no `distance_metric`, so
  KNN ranks by raw L2. That matches cosine ranking only because
  every stored and query vector is unit-norm, an invariant 3.1a's
  embedder facade enforces on every embed rather than something the
  vec0 layer guarantees. Carried over from 3.1a implementation
  (2026-07-20). **Resolved, and not the way this question assumed:**
  no `cos = 1 − d²/2` conversion exists anywhere. `knnQuery` returns
  the `embedding` column on the match row — vec0 gives it up for
  almost nothing, whereas fetching vectors by id afterwards would
  scan the partition — so the ranker computes cosine over the vectors
  themselves. `distance` is carried for logging and never scored, and
  L2 order is only relied on for which rows vec0 hands back.
- **How should `chaptersOld` be sourced once M5 closes chapters?** —
  **deferred to M5, with the shape decided:** store the chapter a row
  belongs to and subtract at rank time, rather than materialising a
  `chapters_old` column that every chapter close would have to
  rewrite across every row. Immutable input, no write amplification,
  and nothing to drift. Happenings need no schema change — they carry
  `occurred_at_entry_id`, and the pass already loads the entry-to-
  chapter map through `loadChapterRanges` for the chapter-match
  boost. Entities, lore and threads need a created-at-chapter column.
  Until then `chaptersOld` is `0` and both decay and the pin signal
  are inert; see [Background](#background).

## Implementation notes

### Per-type overhead constants

Method: render exactly one row of a block with an empty
`renderedText` through the shipped `macro_memory_blocks`
(`lib/prompts/bundled/memory-blocks.ts`) and count the remainder with
the same `countTokens` the ranker uses. The measurement is a test
assertion, not a one-off script —
`lib/prompts/bundled/memory-blocks.test.ts` fails, naming the file and
the new value, when the macro moves and
`RANKER_DEFAULTS.typeOverhead` does not.

The canon estimates were 2-5x high across the board: entities 30 → 11,
lore 10 → 4, happenings 20 → 5, threads 10 → 4, chapters 20 → 4. The
values and the rules that shape them are canon at
[`retrieval.md → Token estimation`](../../../../memory/retrieval.md#token-estimation).

Chapters measured 6 before the title moved off its `##` line and into
`renderedText`. Measured at the default
`retrievalBudgets.chapters = 600` with a 14-token title and 36-token
`summary` + `theme`: budget-fill seated 14 rows charged at 588 that
rendered **732 — a 132-token, 22% overrun of a hard partition**,
scaling with title length times row count. The same shape after the
move seats 10 rows charged at 550 that render 514, i.e. back to
under-filling. Chapters were the only block putting a variable-length
string outside `renderedText`.

Three `lib/retrieval/ranker.test.ts` budget cases moved: they encoded
the old `10 text + 20 overhead = 30` row cost as literal budgets
(`60`, `35`). They now derive the budget from
`RANKER_DEFAULTS.typeOverhead.happenings`, so they assert budget-fill
semantics rather than a constant's current value.

### Resolved developer decisions

- **`retrievalBudgets` needed migration 0007.** Task 3 restated the key
  as token budgets where it had held row counts, and
  `stories.settings.retrievalBudgets` carries no schema default — so a
  pre-slice story kept a count-shaped number that sits below
  `RANKER_DEFAULTS.typeOverhead` on its own, and budget-fill would have
  seated zero rows of every type for the life of that story with
  nothing reporting it. `0007_retrieval_budget_tokens.sql` rewrites the
  key unconditionally, which is safe only because story creation is the
  one writer it has ever had: no stored value can be a user-chosen
  token budget worth preserving.
- **Canon's `[Roll back this turn]` action was removed, across six
  sites.** `abortRun` reverse-replays every delta written under the
  run's `actionId`, and `submitTurn` writes the turn's `user_action`
  entry under that same id — so the turn is already gone when the
  failure bubble is written, and the action would have offered to
  reverse nothing.
  [`model-management.md → Embed failure is blocking`](../../../../memory/model-management.md#embed-failure-is-blocking)
  justified it with a per-row half-commit that the no-inline-embed
  contract at
  [`retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
  makes unreachable; the two were reconciled in favour of the latter,
  and the shipped surface is `Switch embedder / Retry / Dismiss`.
- **Q2's structural inputs are derived from the floor, not accepted
  from the caller.** `RetrievalParams.query` omits `sceneEntityNames`,
  `currentLocationName` and `activeThreadTitles` from
  `QueryStackInput`, and `runRetrieval` fills all three from
  `buildStructuralFloor`'s output. That closes the two-sources-of-truth
  seam the plan flagged: a caller was otherwise free to describe a
  scene the floor had not seated, embedding a digest of a scene the
  prompt never rendered.
- **Per-type budgets are not reduced by the floor.**
  [`retrieval.md → Structural floor takes budget first`](../../../../memory/retrieval.md#structural-floor-takes-budget-first)
  subtracts the floor from the **window**, not from each type's
  partition — which is why the recent buffer, a floor member with no
  retrieval type of its own, appears in that list at all. `runRetrieval`
  therefore passes `settings.retrievalBudgets` to `rankAll` unmodified.
  Subtracting per type would have silently redefined the user's own
  sliders every turn. The window-level accounting canon describes is
  unbuilt and filed in [triage](../../../triage.md).

### Notable deviations from the brief

- **Both bundled templates dropped the `| recent:` filter, not just
  `per-turn.ts`.** The window is composed in code now, by
  `composePromptBuffer` (`lib/retrieval/buffer.ts`) per
  [`cadence.md → Composition rule`](../../../../memory/cadence.md#composition-rule);
  a Liquid re-trim on top of it discards entries whenever the composed
  window is wider than `partialChapterBuffer` — under
  `fullChapterInBuffer`, or with a `protectedBuffer` above
  `partialChapterBuffer` — and does it silently. The plan scheduled
  only `per-turn.ts`; `suggestion-refresh.ts` carried the same filter.
- **The structural floor renders, beyond the ranked bundles the plan
  scheduled.** `macro_memory_blocks`
  (`lib/prompts/bundled/memory-blocks.ts`) renders
  `structuralActiveThreads` and the three `structuralPinned*` bundles
  beside each ranked one. `buildStructuralFloor` seats every
  `injection_mode='always'` row and every active thread, and
  `filterEntityPool` / `filterLorePool` / `filterThreadPool` then
  exclude what the floor seated — so a template rendering only the
  ranked bundles would have dropped both classes outright the moment
  retrieval shipped, against
  [`retrieval.md → Structural floor`](../../../../memory/retrieval.md#structural-floor--always-inject).
- **Chapter titles and thread status live inside `renderedText`, so the
  ranker charges for them.** A string the macro renders but the
  candidate's text omits is costed nowhere and overruns its partition
  by its own length times the row count — measured at 22% for chapter
  titles under
  [Per-type overhead constants](#per-type-overhead-constants). Thread
  status is the same move for a different reason: the pool is pending /
  resolved / failed, and a bare title hands the model a resolved thread
  that reads as an open one.
- **Three tasks the plan did not have.** The **E2E retrofit**: a
  blocking phase ahead of narrative means a turn without an embedder
  model on disk fails before any reply renders, which broke eight
  specs, one of them (`reader-composer-modes`) having passed until then
  only by winning a race against reverse-replay — 4/4 failures on
  repeat. The **generation-status pill's phase label**, which until then
  claimed "generating narrative" while the app was embedding. And
  **`selectedLocationIds`**, without which the `<current_location>`
  instruction named only the location already seated; piggyback reads an
  omitted tag as inherit, so the model had no way to report a location
  change at all.
- **Acceptance criterion 1 is met only in part.** Its injection-mode
  invariants are pinned at both layers — `lib/retrieval/pools.test.ts`
  runs the full status × mode × in-scene × is-location matrix, and
  `lib/prompts/bundled/structural-floor.test.ts` covers the rendered
  side with a permanent negative fixture — but "within each type's
  budget" is asserted only inside the ranker
  (`funnel.tokensUsed` against `funnel.typeBudget`, over a stub
  tokenizer), never against a rendered prompt. It holds by
  construction, since budget-fill decrements by the same estimate the
  macro renders and the per-row header slack runs in the safe
  direction; nothing measures it. Criteria 2 through 6 are met as
  written.
- **Criterion 7 is met by `retrieval.timing`, and the number it reports
  is a concern.** The retrieval phase logs `RetrievalTimings`
  (`totalMs` plus disjoint `syncMs` / `embedMs` / `knnMs` / `rankMs`
  spans) on every pass. Measured cost overshoots
  [`retrieval.md → Per-turn cost budget`](../../../../memory/retrieval.md#per-turn-cost-budget)
  at the volumes
  [`Scale assumptions`](../../../../memory/retrieval.md#scale-assumptions)
  projects for 60 chapters, and the budget table has no line for most
  of what the shipped pass does. Filed in
  [triage](../../../triage.md) with the measurements.
