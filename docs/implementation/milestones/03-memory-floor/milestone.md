# Milestone 3: Memory floor

## Goal

The memory pipeline is online. Piggyback writes scene metadata and
per-turn state mutations inline with main generation; the periodic
classifier reconciles entities, happenings, awareness, and
relationships in the background; retrieval embeds, ranks, and
injects relevant context into each turn's prompt under per-type
budgets. The embedder becomes a hard requirement for story
creation, the wizard gains its full World and Cast steps, and the
reader gains suggestions, regenerate, per-entry world-time editing,
and action-batched undo. Stories made in M3 are coherent across a
session.

## Why now

Real story data exists from M2; this milestone is where classifier
prompt engineering and retrieval ranking get their first contact
with real inputs — validation of the specs in
[`docs/memory/`](../../../memory/README.md) against live traffic,
not tuning (tuning waits for the M7.5 probe surface). It lands
before the rich read surfaces (M4) because those need **populated**
entity / awareness / happening data to render against: the tables
and stores exist since M1.5; M3 fills them. It also front-loads the
one schema-landing job M1.5 deliberately excluded (the per-type
vec0 `embeddings` virtual tables), after which no v1 milestone
carries schema work.

## Narrative / overview

Three build tracks run in parallel after day one, converging on the
classifier as the hub. The **embedding track** lands the substrate
retrieval stands on: [Slice 3.1a](./slices/01a-embedder-core.md)
ships the vec0 tables, the local-ONNX and provider embedder
runtimes behind one service surface, the curated-catalog download
flow, and the story-creation hard gate (the wizard's Finish now
embeds cast and lore in its commit transaction);
[Slice 3.1b](./slices/01b-embedder-lifecycle.md) layers the
lifecycle machinery on top — stale-row drain worker, the
crash-safe model-swap flow, staleness UI, and the Matryoshka
effective-dim machinery. [Slice 3.4](./slices/04-retrieval.md)
then builds query construction, the pure ranker module, per-type
budgets, and the memory pack templates — developed against seeded
rows so it parallelizes with the classifier — and
[Slice 3.5](./slices/05-dev-probe.md) writes the first
`probe_captures` and pins the simulator-vs-prod parity test.

The **classifier track** owns the write side.
[Slice 3.2](./slices/02-piggyback.md) is the per-turn fast path:
trailing-block parse, scene metadata (including each entry's
`worldTime` — the roadmap attributed that write to the periodic
classifier, another stale phrase dropped at promotion; the
write-set table gives entry metadata to the per-turn layer),
computed bookkeeping, the
staged→active fast path, and the per-turn classifier fallback mode
— **no row creation**; per the canonical write-set split
([`cadence.md → Concurrency`](../../../memory/cadence.md#concurrency)),
creation belongs exclusively to
[Slice 3.3](./slices/03-classifier.md), the background periodic
classifier: happenings extraction, awareness with severity-judged
`decay_resistance`, relationship UPSERT-merge, disambiguation with
the collision flag, provenance stamping into the survival anchor,
the retry policy with per-branch `classifier_status`, and the
in-flight classifier barrier for prose reversals. The roadmap
entry's "stub creation" phrasing for 3.2 was stale against canon
and is dropped (resolved at promotion). Slice 3.3 also keeps the
`processedThrough` clamp — the roadmap's authoring note suggested
moving it to the undo slice, but M2.2 already landed the
survival-anchor predicate, and the clamp is correctness-critical
from the moment `processedThrough` is first written, so it ships
with its owner.

The **reader / wizard track** ships what users touch:
[Slice 3.6](./slices/06-wizard-world-cast.md) completes the wizard
(World and Cast steps, refine / regenerate on the opening);
[Slice 3.7](./slices/07-suggestions.md) adds next-turn suggestion
chips over both emission folds plus the `suggestion-refresh`
pipeline; [Slice 3.8](./slices/08-worldtime-edit.md) adds the
per-entry world-time click-to-edit overlay and monotonicity flag;
[Slice 3.9](./slices/09-undo-batched.md) extends CTRL-Z so undoing
a prose turn reverses the positional suffix through the survival
anchor; and [Slice 3.10](./slices/10-regenerate.md) (added at
promotion — the roadmap's cross-cutting table named reader
regenerate but no slice owned it) wires regenerate over the shared
reversal sweep. The same table's "refine on entries" phrase is
dropped: canon defines no reader-entry refine (refine is a
wizard-opening affordance, 3.6).
[Slice 3.11](./slices/11-story-settings-shell.md) (also added at
promotion, from an audit finding) ships the minimal Story Settings
host that 3.1b's embedding-status panel and 3.7's Composer section
register into — the real basic surface remains M4.4.

What changes from "before" to "after": the app goes from "one loop
that forgets everything past the recent buffer" to "prose and
structured world state stay consistent turn by turn, and older
relevant content resurfaces on its own." M4 then makes that graph
browsable.

## Slices

- [Slice 3.1a](./slices/01a-embedder-core.md) — embedder core:
  vec0 tables, local + provider runtimes, catalog download flow,
  story-creation hard gate, wizard Finish embeds
- [Slice 3.1b](./slices/01b-embedder-lifecycle.md) — embedder
  lifecycle: drain worker, crash-safe model swap, staleness UI,
  Matryoshka effective dim
- [Slice 3.2](./slices/02-piggyback.md) — piggyback layer:
  trailing-block parse, scene metadata, computed bookkeeping,
  staged fast path, classifier-fallback mode
- [Slice 3.3](./slices/03-classifier.md) — periodic classifier:
  background pipeline, extraction + reconciliation + provenance,
  retry policy, classifier barrier
- [Slice 3.4](./slices/04-retrieval.md) — retrieval: sync stage,
  three-query stack, pure ranker, budgets, memory pack templates,
  `js-tiktoken`
- [Slice 3.5](./slices/05-dev-probe.md) — developer-only retrieval
  probe: first `probe_captures` writes, parity test
- [Slice 3.6](./slices/06-wizard-world-cast.md) — wizard steps 3
  (World) and 4 (Cast), refine / regenerate on the opening
- [Slice 3.7](./slices/07-suggestions.md) — next-turn suggestions:
  emission folds, chip strip, `suggestion-refresh` pipeline,
  categories editor
- [Slice 3.8](./slices/08-worldtime-edit.md) — per-entry worldTime
  click-to-edit overlay, monotonicity-break flag
- [Slice 3.9](./slices/09-undo-batched.md) — CTRL-Z action-batched
  extension over the survival anchor
- [Slice 3.10](./slices/10-regenerate.md) — reader regenerate over
  the shared reversal sweep
- [Slice 3.11](./slices/11-story-settings-shell.md) — minimal
  Story Settings host + section-registration seam

## Dependency graph

```
day-one: 3.1a   3.2   3.6   3.8   3.11

3.1a ─┬→ 3.1b
      ├→ 3.3 ─┬→ 3.9
      │       └→ 3.10
      └→ 3.4 ──→ 3.5
3.2 ───→ 3.7
3.11 ┄┬→ 3.1b   (partial: settings-section portions only)
     └→ 3.7
```

- **3.1a** gates 3.1b (lifecycle extends the service), 3.3 (the
  disambiguation flow embeds extracted descriptions at decision
  time), and 3.4 (vec0 + query embeds).
- **3.2** gates 3.7 — both emission folds ride the per-turn paths
  3.2 owns, and `<suggestions>` parses through 3.2's trailing-block
  utility (C2). The roadmap sketch also gated 3.7 on 3.3; that gate
  is dropped — the classifier fold is 3.2's per-turn fallback pass,
  not the periodic classifier.
- **3.3** gates 3.9 and 3.10 — both consume the shared reversal
  sweep with the classifier-cancel drain and `processedThrough`
  clamp (C3).
- **3.4** develops against `pnpm db:seed` rows (frozen shapes;
  the same look-ahead pattern M4 uses) and therefore does **not**
  gate on 3.3; its definition of done still requires ranking real
  classifier output. 3.4 gates 3.5 (the capture writer serializes
  the ranker trace, and the parity test needs the pure module).
  3.4 also pairs with 3.1b via C8 (its sync-failure surface's
  `Switch embedder` action opens 3.1b's swap dialog) — a
  doc-as-contract seam, not a gate.
- **3.6** is day-one: the M1.5 lore / entity layer plus M2.3's
  wizard shell are merged prerequisites. Its Finish-commit rows
  flow through 3.1a's embed step via C5 — a doc-as-contract pair,
  not a gate. 3.1b and 3.6 also co-edit wizard step 5 (memory-cost
  disclosure vs opening refine / regenerate) in non-overlapping
  regions — parallel-safe, noted for completeness.
- **3.8** is build-independent day-one (entry metadata + the M2
  calendar substrate); it only becomes _useful_ once 3.2's
  piggyback layer writes non-zero `worldTime` values, so its
  milestone-level validation follows 3.2 without blocking its
  build.
- **3.11** is a thin day-one shell; its edges to 3.1b and 3.7 are
  **partial** — only their settings-section portions wait on it
  (M2's partial-gate precedent); swap flow, drain worker, emission,
  and the chip strip proceed regardless.

## Slice contracts

### C1 — Embedder service surface

[Slice 3.1a](./slices/01a-embedder-core.md) owns one embedding
service module. Pinned boundary: lazy init (never at boot — see
[`model-management.md → Embedder failures`](../../../memory/model-management.md#embedder-failures));
a batched embed entry point resolving the story's configured
backend and model (`stories.settings` → app default); typed
failures distinguishing init-failure from call-failure; the vec0
write helper (metadata row + vector + `source_hash`) and the
`embedding_stale` recompute-and-revalidate helper per
[`retrieval.md → Compute lifecycle`](../../../memory/retrieval.md#compute-lifecycle).
Consumers: 3.1b (drain worker, swap re-index), 3.3 (transient
disambiguation embed), 3.4 (pre-retrieval sync stage + query
embeds), and 3.1a's own wizard-Finish step. Matryoshka truncation +
renorm (3.1b) lands **inside** the service — consumers never
truncate, so rows written by 3.3 / 3.4 code built before 3.1b
merges pick up effective-dim handling transparently. Exact names
fixed in 3.1a's first commit.

### C2 — Trailing-block parse utility

[Slice 3.2](./slices/02-piggyback.md) owns the tagged
trailing-block parser: segment isolation (each top-level block —
`<state>`, later `<suggestions>` — parses independently; one
failing never blocks another), jsonrepair-equivalent repair,
per-field best-effort fallback, and placeholder substitution
integration per
[`generation-pipeline.md → ID placeholder substitution`](../../../generation-pipeline.md#id-placeholder-substitution).
[Slice 3.7](./slices/07-suggestions.md) consumes it for
`<suggestions>` (including category-id placeholder swap) rather
than writing a second parser.

### C3 — Shared prose-reversal sweep

[Slice 3.3](./slices/03-classifier.md) extends M2.2's sweep
primitive (`reverseAndPruneDeltaRows` bracketed by
`reversalInProgress`) with the two classifier-era obligations, in
one place: the in-flight drain
(`await awaitRunTerminal('periodic-classifier', 'cancel')` before
the sweep, per
[`generation-pipeline.md → Prose reversals and the classifier barrier`](../../../generation-pipeline.md#prose-reversals-and-the-classifier-barrier))
and the watermark clamp
(`processedThrough ← min(processedThrough, position(B) − 1)` inside
the sweep transaction, per
[`classifier.md → Persistence`](../../../memory/classifier.md#persistence)).
3.3 also relocates `awaitRunTerminal` from `lib/pipeline` into the
generation store (mirroring M2.2's gate move) so `lib/actions`
stays cycle-free. [Slice 3.9](./slices/09-undo-batched.md) and
[Slice 3.10](./slices/10-regenerate.md) invoke this primitive for
their reversals and implement **no** barrier or clamp logic of
their own. Entry-point signature fixed in 3.3's first commit.

### C4 — Pure ranker module + trace

[Slice 3.4](./slices/04-retrieval.md) ships the ranker
(`rank_per_type` / `rank_all` per
[`retrieval.md → Pseudocode`](../../../memory/retrieval.md#pseudocode))
as a pure-function module with no store or DB imports, and its
output includes a per-candidate **trace** carrying the fields the
probe capture model needs (`sim_q1..q3`, `sim_blend`,
`recency_factor`, `pin_signal`, `kw_boost_value`,
`chapter_boost_applied`, `bypass_triggered`, `final_score`,
`mmr_rank`, `selected`, `drop_reason`, `tokens_estimated`, and the
row's `embedding_stale` flag at capture time — per
[`probe.md → What gets captured`](../../../memory/probe.md#what-gets-captured--light-mode-default)).
This contract pins the **per-candidate** trace only; the
query-level metadata (incl. Q3 sentence scores), per-type funnel
summary, structural-floor list, and stale-row counts that the
capture model also needs come from 3.4's retrieval-phase output,
which 3.5 consumes sequenced (3.4 gates 3.5).
[Slice 3.5](./slices/05-dev-probe.md) serializes that trace into
`probe_captures` and pins the simulator-vs-prod parity test against
the same module. Any ranker change that bypasses the pure module is
a contract violation.

### C5 — Wizard-commit embed seam

The wizard's Finish transaction is touched by three slices: 3.1a
adds the embed handling (each `entities` / `lore` row embeds at its
insert step inside the one atomic transaction, per
[`wizard.md → What Finish does`](../../../ui/screens/wizard/wizard.md#what-finish-does--atomic-commit);
any embed failure rolls the whole commit back), 3.6 adds the rows
themselves (full cast + initial lore), and 3.1b writes
`stories.settings.effectiveDim` from the step-5 memory-cost
disclosure — resolved by the embed helper from the story settings
assembled earlier in the same transaction. Pinned: all Finish
embeds flow through 3.1a's single embed helper; 3.1a implements it
against the M2 commit shape (lead entity only); 3.6's rows and
3.1b's dim flow through it without any slice knowing another's
internals.

### C6 — Per-turn phase-list extension seam

Two parallel slices insert phases into the M2.7 per-turn pipeline
declaration: 3.4 inserts the retrieval phase (with its
head-of-phase sync stage) before the narrative phase, and 3.2
inserts the conditional fallback-classifier phase after it, per
the canonical phase order the pre-flight walk assumes
([`generation-pipeline.md → Config pre-flight validation`](../../../generation-pipeline.md#config-pre-flight-validation)).
Pinned: the per-turn definition exposes named insertion points (a
structured phase list, not positional splicing), each slice adds
its own phase entry plus its resolver-input declaration, and
neither edits the other's entries. Exact shape fixed by whichever
slice lands first; the insertion order above is binding either way.

### C7 — Story Settings section registration

[Slice 3.11](./slices/11-story-settings-shell.md) owns the minimal
Story Settings shell and a section-registration seam: a section is
a self-registered module declaring its tab and rendering its own
body — consumers touch no shared file (same spirit as the M1.5
delta-dispatch registration API). Consumers: 3.1b registers the
Memory tab's embedding-status panel; 3.7 registers the Composer
section (categories editor, master toggle, count stepper).
Registration names fixed in 3.11's first commit.

### C8 — Swap-dialog open action

[Slice 3.1b](./slices/01b-embedder-lifecycle.md) exports a single
named action that opens the model-swap dialog for a story (the
[`Model swap UX`](../../../memory/retrieval.md#model-swap-ux)
entry point). [Slice 3.4](./slices/04-retrieval.md)'s sync-failure
surface imports it for its `Switch embedder` action rather than
re-implementing any routing. Name fixed in 3.1b's first commit;
3.4's own acceptance criteria test only the Retry path, so the
cross-slice routing verifies at integration once both are merged
(the two slices stay parallel).

## Definition of done

- **Coherence loop, both platforms.** On Electron desktop and an
  Android device / emulator: play a story past one classifier
  cadence; the classifier populates happenings, awareness rows,
  and a canonically-ordered relationship row (verified via the dev
  probe / DB); a later turn's prompt injects a retrieval bundle
  containing at least one non-buffer candidate (verified via a
  probe capture); suggestions chips render after replies and
  tap-fills the composer in `Free` mode.
- **Embedder hard gate.** On a fresh install with no embedder:
  story creation is blocked with a route to settings; after a
  curated download (license shown and attested, SHA256 verified),
  creation proceeds and Finish embeds cast + lore in the commit
  transaction — committed rows are never `embedding_stale`
  (asserted by test); an embed failure at Finish rolls back the
  entire commit and surfaces the retry surface.
- **Sync-before-read holds.** A turn following classifier writes
  runs the pre-retrieval sync stage and KNN sees the fresh rows;
  a forced embed failure at the sync stage blocks the turn with
  `Retry / Switch embedder / Roll back this turn` and the next-turn
  affordance disabled; rows still stale at retrieval are excluded
  from candidates (vitest each).
- **Swap crash-safety.** Kill the app mid-re-index; on next story
  open the resume / cancel prompt appears; resume completes the
  stage-then-flip, cancel deletes staged NEW-model vectors and
  clears `embedding_swap_target` (manual smoke + vitest on the
  marker transitions).
- **Matryoshka.** A provider-mode story created at
  `effectiveDim = N` stores N-dim unit-norm vectors and queries at
  N dims; truncation + renorm covered by unit test.
- **Piggyback resilience.** A malformed trailing block skips
  LLM-emitted fields for the turn without failing it; computed
  bookkeeping still applies; `<state>` and `<suggestions>` parse
  independently in all four outcome combinations (vitest).
- **Classifier lifecycle.** Injected failures walk the
  30 s → 2 m → 5 m backoff into failed-persistent, cadence
  suspends, manual retry re-arms it (vitest, fake timers);
  `classifier_status.processedThrough` advances on success and
  clamps on reversal.
- **Survival anchor exercised.** Regenerating a reply after a
  catch-up classifier pass spares committed facts anchored to
  surviving turns and re-processing does not re-derive them; CTRL-Z
  of a prose turn carries its piggyback deltas and any classifier
  deltas anchored to it (vitest over fixture logs + manual smoke).
- **Parity.** The simulator-vs-prod ranker parity test passes:
  identical selections and scores for the same captured state and
  params.
- **Wizard complete.** A story is creatable with genre / tone /
  setting, initial lore, and a mixed cast including staged
  entities; staged entities are excluded from opening
  `sceneEntities`; refine / regenerate work on the opening
  preview.
- **Pre-flight coverage.** `periodic-classifier` and
  `suggestion-refresh` declare resolver inputs; unassigned agents
  halt before phase 0 with the M2 failure vocabulary.
- **Hygiene.** Storybook stories exist for every compound M3
  introduces; every new chrome string routes through `t()`;
  `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, and the full
  vitest suite pass on every slice's PR.

## Open questions

- **Classifier output wire format.** Strict structured-output mode
  (capability-gated) versus tagged trailing block for the periodic
  classifier's emission — canon pins the content and placeholder
  rules but not the wire shape. Resolve in
  [Slice 3.3](./slices/03-classifier.md) planning.
- **Curated catalog v1 contents.** Which embedding models ship in
  the bundled catalog JSON beyond `Xenova/all-MiniLM-L6-v2-q8`.
  Resolve in [Slice 3.1a](./slices/01a-embedder-core.md) planning.
- **Scheduler placement.** Where the cadence tick lives (store
  subscription on entry writes vs an orchestrator-adjacent
  module) — the framework deliberately excludes it
  ([`generation-pipeline.md → Background scheduler`](../../../generation-pipeline.md#background-scheduler--out-of-framework-scope)).
  Resolve in [Slice 3.3](./slices/03-classifier.md) planning.
- **Token-progress strip fill.** `js-tiktoken` lands in 3.4; the
  reader's zero-filled token-progress strip (M2.5 interim) could
  gain real open-region counts there or wait for chapter work in
  M5. Default assumption: wire it in 3.4 if cheap, else record in
  the slice's Implementation notes.
