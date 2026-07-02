# Slice 2.9 — Resolver-input declaration + config pre-flight validation

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** none (framework addition over M1 orchestrator
  code)
- **Blocks:** [Slice 2.7](./07-wiring.md) (the per-turn
  declaration registers against this shape)

## Goal

The one framework piece M1 didn't ship: phases declare their
resolver inputs as **data on the declaration** (a `Pipeline` /
`PhaseNode` addition — M1 phases are opaque generators), and the
orchestrator validates those inputs against `app_settings` before
phase 0 fires, emitting `run_complete(failed)` with the first
failing resolver in phase order when validation fails. No LLM
call goes out, no tokens spent, nothing to roll back.

## Background

Provider / profile deletion semantics deliberately leave dangling
references as data ("visible errors at next use, no silent
re-pointing"). Pre-flight is the layer that catches them before
any cost is incurred; runtime resolver failure remains the safety
net for the config-changed-mid-turn race, surfacing the identical
vocabulary so the user can't tell which layer caught it. The walk
is selective per pipeline kind — it validates only the resolver
inputs of phases the kind actually fires. In M2 that's the
narrative profile for per-turn; the selective machinery matters
because M3+ kinds (classifier, suggestions, chapter-close)
declare richer input sets against this same shape. The walk
delegates to [Slice 2.1](./01-provider.md)'s `resolveModel` and
consumes its C3 failure literals as a type — mockable until 2.1
merges, so this slice carries no hard dependency.

## Required reading

- [`generation-pipeline.md → Config pre-flight validation`](../../../../generation-pipeline.md#config-pre-flight-validation)
  — the canonical contract this slice implements: what's
  validated, selectivity, failure emission, surfacing split.
- [`generation-pipeline.md → Pipeline declaration`](../../../../generation-pipeline.md#pipeline-declaration)
  — the declaration shape being extended.
- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  — deletion semantics: which references can dangle and how.
- [`reader-composer.md → Error surface`](../../../../ui/screens/reader-composer/reader-composer.md#error-surface--system-entries-vs-persistent-state-pill)
  — the four broken-reference system-entry variants pre-flight
  failures map to.

## Scope: in

- **Declaration addition** (C4 in
  [the milestone doc](../milestone.md#c4--resolver-input-declaration-shape)):
  per-phase declared agent inputs (including the `narrative`
  pseudo-slot), walkable without executing phase generators;
  conditional inputs expressible (M3's "classifier iff piggyback
  off", "suggestions iff enabled" shapes — design the predicate
  form now, with per-turn-M2 as the only registered user).
- **Pre-flight walk** in `runPipeline`, before phase 0: for each
  declared agent, assignment resolves to an existing profile (or
  the narrative profile exists); each resolved profile's
  `modelRef.providerId` resolves to an existing provider.
  In-memory only, against the Zustand snapshot.
- **Failure emission:** halt before phase 0;
  `run_complete(failed)` with an error payload identifying the
  first failing resolver in phase order; no `pipeline_runs`
  side effects beyond the framework's normal failed-run record;
  zero deltas, zero HTTP.
- **Surfacing hooks:** this slice owns the **system-entry write
  helper** (per the C4 note in
  [the milestone doc](../milestone.md#c4--resolver-input-declaration-shape))
  — composing the existing entry-create arm into a
  `kind='system'` entry carrying the failure metadata; pre-flight
  failure on turn-blocking kinds is its first caller, and
  [Slice 2.7](./07-wiring.md)'s runtime resolver / provider
  failures reuse the same helper. EntryCard's `system` rendering
  is shipped. The background-pill variant is declared but has no
  M2 consumer (periodic classifier is M3.3).

## Scope: out

- Per-story embedder pointer validation — explicitly excluded by
  the canonical contract (deletion-semantics invariant owns it).
- The settings surfaces the system-entry action buttons route to
  (`Fix profile` / `Assign profile` target the interim form in
  M2; full routing matures with M7.1).
- Runtime resolver failure handling itself — that's
  [Slice 2.1](./01-provider.md)'s typed failures surfacing
  through the narrative phase ([Slice 2.7](./07-wiring.md)).

## Acceptance criteria

- Fixture pipeline with a declared agent whose assignment is
  unset: `runPipeline` returns / emits `run_complete(failed)`
  before any phase generator is instantiated (spy-asserted), with
  the failing resolver named; no HTTP-wrapper invocation, no
  delta rows.
- Phase-order precedence: two broken resolvers report the
  earlier phase's agent only.
- Selectivity: a kind that doesn't declare agent X passes
  pre-flight when X's assignment is broken.
- Happy path: valid config proceeds into phase 0; the walk
  issues no DB or network calls (asserted by spies).
- Per-turn (after [Slice 2.7](./07-wiring.md) lands): deleting
  the narrative profile's provider then submitting a turn yields
  the system entry naming the missing provider — covered by an
  integration test in 2.7, vocabulary owned here.

## Tests

- Vitest against fixture pipelines: each failure class, phase
  ordering, selectivity, the narrative pseudo-slot, conditional
  input predicates (fixture kinds exercising the M3 shapes so
  the design is proven before its consumers exist).

## Open questions

- Declaration syntax (per-`PhaseNode` field vs pipeline-level map) —
  resolved to per-node; see Implementation notes.

## Implementation notes

- **Declaration shape.** Resolver inputs are a per-`PhaseNode`
  `resolves?` field (a `ResolverInput` is `{ target, when? }`), not a
  pipeline-level map — this keeps the declaration next to the phase and
  makes "first failure in phase order" fall out of declared iteration
  order. The `narrative` pseudo-slot is just `target: 'narrative'`, no
  special case. A `when` predicate receives a `PreflightSnapshot`
  (`appSettings` plus optional `storySettings`); M2 registers no
  predicates (per-turn validates narrative only), so the form exists for
  M3's conditional inputs.
- **Pre-flight delegates to Slice 2.1's `resolveModel`** rather than
  re-walking the chain, so the C3 failure vocabulary cannot drift. It
  builds the resolver config WITHOUT story-level overrides — those are
  bare model-id strings and do not enter provider validation (canonical).
  The walk is pure; the orchestrator reads the snapshot via
  `appSettingsStore.getAppSettings()`.
- **`runPipeline` stays pure on pre-flight failure.** It halts before
  phase 0 through the existing abort path (reverse-replay is a no-op, so
  zero deltas), emits `run_complete(failed)` with a new `config-resolver`
  `PipelineError`, and writes only the normal failed `pipeline_runs`
  marker — it does NOT write the system entry. The error's `detail` is
  optional but declared so the orchestrator's union-wide `error.detail`
  access typechecks. **Slice 2.7 wires the surfacing:** it calls
  `writeSystemEntry` on a failed outcome and `clearSystemEntry` at turn
  start.
- **System entries are a direct, non-delta-logged insert**
  (`lib/actions/story-entries/system-entry.ts`), not the delta-logged
  entry-create arm the Background, Scope, and the milestone C4 note
  describe. A `kind='system'` entry is a diagnostic artifact, not a
  narrative-state mutation: the `deltas.source` enum has no fitting value,
  and it must stay invisible to rollback and CTRL-Z. It is the branch-tail
  singleton, cleared on resolution or at the next main pipeline run. New
  canonical note in
  [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback).
  **Developer follow-up:** the milestone C4 note and this doc's Background
  and Scope wording still say "compose the existing entry-create arm" —
  reconcile each to a direct insert.
