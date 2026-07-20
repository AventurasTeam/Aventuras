# Slice 3.2 — Piggyback layer: trailing block, scene metadata, computed bookkeeping

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one; the M2.7 per-turn pipeline and
  M2.8 id-substitution are merged prerequisites)
- **Blocks:** [Slice 3.7](./07-suggestions.md) (both emission folds
  ride this slice's paths; `<suggestions>` parses through C2)

## Goal

The per-turn fast path of the memory cadence: the narrative model
emits a tagged `<state>` block alongside its prose, and this slice
parses it, applies the scene-metadata and state writes, derives the
computed bookkeeping, auto-promotes staged entities on ID emission,
and falls back to a per-turn classifier pass when the model can't
be trusted with tagged blocks. Also extracts the shared
entry-metadata placeholder helper flagged during M2 reconciliation.

## Background

Piggyback exists so the prose and the state it produces are
mutually consistent by construction, at near-zero marginal cost —
a few hundred output tokens on a call already paying full input
cost. Its write set is deliberately narrow: entry scene metadata,
entity state fields, and the monotonic staged→active status flip.
**It creates no rows** — entity / lore / happening creation belongs
to the periodic classifier per the canonical write-set split
(resolved at promotion against a stale roadmap phrase). Parsing is
best-effort per field: a malformed block skips the LLM-emitted
fields for the turn and the periodic classifier eventually covers
the prose. When the narrative model's tagged-block reliability flag
is off, a separate per-turn classifier call writes the same subset.

## Required reading

- [`piggyback.md`](../../../../memory/piggyback.md) — the whole
  contract: write table, trailing-block format, jsonrepair
  fallback, auto-promote, capability gate, mode-mixing.
- [`cadence.md → Concurrency`](../../../../memory/cadence.md#concurrency)
  — the write-set table and per-field-UPDATE discipline; the
  `entities.status` monotonic-overlap invariant.
- [`edge-cases.md → Staged-entity promotion`](../../../../memory/edge-cases.md#staged-entity-promotion)
  — fast path semantics and the staged-entity prompt framing.
- [`generation-pipeline.md → ID placeholder substitution`](../../../../generation-pipeline.md#id-placeholder-substitution)
  — placeholder swap both directions; failure modes.
- [`generation-pipeline.md → Narrow action functions over write-set declarations`](../../../../generation-pipeline.md#narrow-action-functions-over-write-set-declarations)
  — how the write-set boundary is enforced in code.
- [`generation-pipeline.md → Config pre-flight validation`](../../../../generation-pipeline.md#config-pre-flight-validation)
  — the resolver-input declaration + halt semantics the fallback
  phase's agent declaration rides.
- [`architecture.md → Classifier contract — metadata fields`](../../../../architecture.md#classifier-contract--metadata-fields)
  — `worldTime` delta invariant (`≥ 0`, flashback `0`, re-roll then
  clamp + warn), user-action inheritance.
- [`data-model.md → Entry metadata shape`](../../../../data-model.md#entry-metadata-shape)
  — the metadata fields this slice writes.

## Scope: in

- **Trailing-block parse utility (C2):** segment isolation per
  top-level tag, repair fallback, per-field best-effort, placeholder
  swap integration; exported for 3.7's `<suggestions>` block.
- **Prompt fragment:** the `<state>` emission instructions +
  bracketed-ID entity list framing in the bundled per-turn template
  (including the staged-entities block with promotion instructions,
  and the active calendar's vocabulary — tier names, weekday and
  era labels — so the model converts prose like "two days later"
  into a seconds delta per
  [`data-model.md → In-world time tracking`](../../../../data-model.md#in-world-time-tracking)).
- **Piggyback apply:** `sceneEntities` / `currentLocationId` /
  `worldTime` delta onto the new entry's metadata (the first
  non-zero `worldTime` values flow through the M2.5 calendar
  renderer from this slice); `visual.*` and
  transfer writes via per-field narrow actions; the `worldTime`
  validation ladder (reject negative → re-roll once → clamp to 0 +
  `logger.warn`).
- **`<summary>` enrichment hand-off:** parse the trailing block's
  optional one-sentence summary and hand it off for the next
  turn's Q2 structural digest
  ([`retrieval.md → Q2`](../../../../memory/retrieval.md#q2-structural-digest)
  treats it as optional enrichment — absent on parse failure or
  restart is fine); the transport (run-scoped vs store-scoped) is a
  planning decision recorded at finish.
- **Computed bookkeeping:** per-character `current_location_id`
  from scene presence; `lastSeenAt` on scene-exit from the previous
  entry's metadata — code-side, no LLM.
- **Staged→active fast path:** auto-promote on staged-ID emission
  under the turn's `action_id`.
- **Capability gate + fallback:** `piggybackMode` resolution from
  story settings + the model's tagged-block capability flag; when
  off, a per-turn classifier pass (own phase inserted after the
  narrative phase through the C6 phase-list seam, declared resolver
  input per M2.9) writes the same subset; mode-mixing mid-story
  needs no migration.
- **Shared metadata-placeholder helper:** extract the hand-built
  `{ sceneEntities: [], currentLocationId: null, worldTime }`
  placeholder duplicated across `submit-turn.ts` and `pipeline.ts`
  (surfaced by Slice 2.7) into one helper, now that real values
  flow.

## Scope: out

- Any row creation (entities, lore, happenings) and any
  `description` authorship — [Slice 3.3](./03-classifier.md).
- `<suggestions>` emission and parse wiring —
  [Slice 3.7](./07-suggestions.md) (consumes C2).
- Retirement (`active → retired`) — classifier-only per canon.
- The piggybackMode settings UI (Story Settings · Memory · Classifier
  panel) — M7.2; the setting itself is readable since M1.5.
- Embedding anything — piggyback's writes touch no embedded fields
  (state is excluded from embeddings by design).

## Acceptance criteria

- A stub-provider turn with a well-formed `<state>` block lands
  scene metadata on the new entry, per-field state updates on the
  named entities, and computed `current_location_id` / `lastSeenAt`
  transitions — all under one turn `action_id`, reversible by one
  CTRL-Z (vitest end-to-end over the pipeline).
- A malformed block (fixture set: truncated tag, bad JSON-ish
  interior, unknown placeholder) skips LLM-emitted fields, still
  applies computed bookkeeping, and completes the turn; the parse
  failure logs (vitest per fixture).
- A staged entity emitted in `<scene_entities>` flips to `active`
  in the same action; a second emission no-ops (monotonic).
- Negative `worldTime` delta: rejected, re-rolled once, then
  clamped to 0 with `classifier.delta_clamped` warn (vitest, fault
  injection).
- With the capability flag off, the per-turn classifier fallback
  phase runs, writes the same subset, and pre-flight fails cleanly
  when its agent is unassigned (M2.9 vocabulary).
- Write-set discipline: no read-modify-write on `entities` rows —
  per-field UPDATEs only (asserted by reviewing the narrow actions'
  tests; a concurrent-writer vitest exercises the status overlap).
- The metadata-placeholder helper is the single construction site
  for empty entry metadata (grep-level assertion in review;
  `submit-turn.ts` and `pipeline.ts` both consume it).

## Tests

- Vitest: parse utility (well-formed / repaired / malformed
  matrix), apply path, computed bookkeeping transitions, fast-path
  promotion, worldTime ladder, fallback-mode phase, concurrent
  status-write no-clobber.
- No new compounds expected; no Storybook scope unless one is
  extracted.
- Manual smoke: real-provider turn with a tagged-block-capable
  model; visual state change reflected on a second turn's prompt.

## Open questions

- **Tagged format final shape** — canon says "exact tagged format
  firms up at implementation"; pin the grammar in this slice and
  record it in Implementation notes (3.7's `<suggestions>` inherits
  it).
- **Capability flag sourcing** — the tagged-block reliability flag
  is "curation + detection, user-overridable"; what seeds it for
  OAI-compat models where no curation exists yet (default-off vs
  default-on-with-fallback).

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
