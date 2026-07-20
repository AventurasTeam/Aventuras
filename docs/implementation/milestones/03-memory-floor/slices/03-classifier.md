# Slice 3.3 — Periodic classifier: extraction, reconciliation, provenance, barrier

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.1a](./01a-embedder-core.md) (the
  disambiguation flow embeds extracted descriptions at decision
  time)
- **Blocks:** [Slice 3.9](./09-undo-batched.md) and
  [Slice 3.10](./10-regenerate.md) (both consume the C3 shared
  reversal sweep)

## Goal

The background pipeline that populates the structured graph
retrieval queries against: happenings with involvements and
severity-judged awareness, relationship UPSERT-merge, entity status
flips, first-introduction descriptions, and name-collision
disambiguation — every delta stamped with survival-anchor
provenance. Ships the `periodic-classifier` pipeline
declaration, its cadence scheduler, the auto-retry policy over
per-branch `classifier_status`, and the in-flight classifier
barrier that prose reversals bracket.

## Background

Piggyback keeps the crucial per-turn subset consistent; the
classifier amortizes everything deeper over many turns — it reads
the prose window past `processedThrough` and emits batch
extractions as a `no-gate` background pipeline that coexists with
per-turn runs on disjoint write sets. Its output references
entities by placeholder and creates new ones as full objects with
no id; code-side reconciliation (name index, then embedding
similarity) decides create vs promote vs flag. Every fact carries a
provenance anchor in `deltas.entry_id` so reversals spare facts
about surviving turns; the predicate itself already landed in M2.2
(dormant), and this slice makes it live — including the
`processedThrough` clamp, kept here rather than the undo slice
because it is load-bearing from the first write of the watermark
(promotion decision).

## Required reading

- [`classifier.md`](../../../../memory/classifier.md) — the whole
  contract: write set, provenance attribution, ID handling,
  embedding-compute boundary, disambiguation, background-task
  framing, auto-retry, persistence.
- [`cadence.md → User-tunable knobs`](../../../../memory/cadence.md#user-tunable-knobs)
  and [`Concurrency`](../../../../memory/cadence.md#concurrency)
  — `classifierCadence`, write-set disjointness, status-overlap
  invariant.
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor)
  — the predicate, the clamp, and redo's accepted re-derive
  tolerance.
- [`data-model.md → Character-to-character relationships`](../../../../data-model.md#character-to-character-relationships)
  — `normalizeForWrite`, UPSERT-merge, the classifier prompt
  contract (fill only the observed POV).
- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  — happening / involvement / awareness shapes, entry-id refs,
  the awareness UNIQUE upsert.
- [`edge-cases.md → Name collision and disambiguation`](../../../../memory/edge-cases.md#name-collision-and-disambiguation)
  and [`Retirement`](../../../../memory/edge-cases.md#retirement)
  — Layer B reconciliation, `name_collision_flag`, hard-finality
  retirement bias.
- [`generation-pipeline.md → Prose reversals and the classifier barrier`](../../../../generation-pipeline.md#prose-reversals-and-the-classifier-barrier)
  — `awaitRunTerminal` dispositions, `reversalInProgress`, the
  abort-free commit burst.
- [`generation-pipeline.md → Background scheduler`](../../../../generation-pipeline.md#background-scheduler--out-of-framework-scope)
  and [`V1 declarations`](../../../../generation-pipeline.md#v1-declarations)
  — the declaration values and the scheduler's out-of-framework
  placement.
- [`generation-pipeline.md → ID placeholder substitution`](../../../../generation-pipeline.md#id-placeholder-substitution)
  — the walker, `IdBiMap`, and unknown-placeholder failure modes
  the parse must honor — plus its
  [`New-entity emission`](../../../../generation-pipeline.md#new-entity-emission)
  subsection: no-id full-object creation, temporary-handle
  registration.

## Scope: in

- **Pipeline declaration + scheduler:** `periodic-classifier`
  (`no-gate`, `blockedBy: ['periodic-classifier', 'chapter-close']`,
  pill-only affordance at low priority), resolver-input declaration
  for pre-flight; the cadence tick reading
  `stories.settings.classifierCadence` and calling `runPipeline`,
  rejected-start = wait for next tick.
- **Extraction pass:** prompt/context over `(processedThrough,
head]` with the placeholder universe;
  structured output (wire format is this slice's planning
  decision); parse through id-substitution; per-fact provenance
  handles resolved to `deltas.entry_id` per the attribution rules
  (single-turn, cross-turn-latest, flip-trigger, window-head
  fallback).
- **Writes:** happenings + involvements + awareness (severity →
  `decay_resistance`; UNIQUE upsert), `character_relationships`
  UPSERT-merge via `normalizeForWrite`, status flips (staged→active
  slow path; active→retired on hard finality only), and
  first-introduction `description` authorship. All embedded-field
  writes set `embedding_stale = 1`; nothing embeds on the write
  path.
- **Disambiguation:** name-index lookup, transient
  embedding-similarity check via C1, τ-banded create / promote /
  flag with `entities.name_collision_flag` (drives the M4 review
  surface).
- **Happening reconcile cascade:** delete / merge of a happening
  also drops or reattaches its `happening_involvements` and
  `happening_awareness` rows (the M1.5 `deleteHappening` arm
  orphans them; first consumer lands the cascade).
- **Status persistence + retry:** `branches.classifier_status`
  lifecycle (idle / running / retrying / failed-persistent,
  last-error, attempt count, `processedThrough` advanced in the
  commit transaction); 30 s → 2 m → 5 m backoff; cadence suspension
  in failed-persistent; manual-run entry point (the settings panel
  UI is M7.2 — the action is exported now).
- **Classifier barrier (C3):** relocate `awaitRunTerminal` into the
  generation store; extend the shared sweep with the
  `'cancel'`-disposition drain and the `processedThrough` clamp
  inside the sweep transaction; the classifier's abort-free commit
  burst (ignore `signal.aborted` once parsing begins).

## Scope: out

- Per-turn scene metadata — including `metadata.worldTime` —
  computed bookkeeping, and fast-path promotion —
  [Slice 3.2](./02-piggyback.md). The periodic classifier never
  writes `story_entries.metadata` per the
  [write-set table](../../../../memory/cadence.md#concurrency);
  the roadmap's contrary phrasing was ruled stale at promotion.
- Turn-capture wiring — grouping comes free via the orchestrator's
  generic `anchorEntryId` stamp per
  [`observability.md → Anchor attribution`](../../../../observability.md#anchor-attribution);
  no per-kind capture work in M3.
- Chapter-close phase 0 catch-up and lore-mgmt — M5.2 (it consumes
  `processedThrough` and the `'finish'` disposition unchanged).
- CTRL-Z / regenerate user surfaces —
  [Slice 3.9](./09-undo-batched.md) /
  [Slice 3.10](./10-regenerate.md) over C3.
- The Settings · Memory · Classifier panel (cadence edit, status
  block, error pill routing) — M7.2.
- `common_knowledge` auto-emission — rejected by canon; user-only.
- Retired→active transitions — user-only in v1.

## Acceptance criteria

- A seeded story with N unclassified turns: one pass writes
  happenings with involvements + awareness rows carrying
  `decay_resistance` and `learned_at_entry_id`, relationship rows
  canonically ordered (the data-model two-entry worked example
  reproduces), and `processedThrough = head` — all rows
  `embedding_stale = 1`, zero vec0 writes (vitest over stub LLM
  fixtures).
- Disambiguation matrix: no-name-match creates; high-sim promotes
  staged; low-sim creates flagged; ambiguous creates flagged
  (vitest with a deterministic stub embedder).
- Provenance: a fixture emitting facts about turns 3 and 5 in one
  pass anchors each delta to its source turn; reversing turn 5
  spares turn 3's facts and clamps `processedThrough` to 4; the
  re-run pass re-processes only turn 5 and re-derives nothing
  spared (vitest end-to-end).
- Barrier: a reversal fired while a classifier run is mid-stream
  cancels it (no committed deltas) and no new run starts inside the
  `reversalInProgress` window; a reversal fired during the commit
  burst lets the burst land and sweeps it positionally (vitest with
  a controllable stub).
- Retry policy: three injected failures walk the backoff into
  failed-persistent; cadence ticks no-op there; the manual-run
  action clears it on success (vitest, fake timers).
- Happening delete / merge cascades involvements + awareness
  (vitest on the reconcile arms).
- Retirement, two assertions: (1) apply path — a fixture emitting a
  hard-finality retirement writes `active → retired` and a
  non-final "wandered off" fixture writes nothing; (2) prompt — the
  rendered classifier prompt carries the hard-finality retirement
  directive (snapshot test).
- Pre-flight: an unassigned `periodic-classifier` agent halts a
  cadence-triggered run before phase 0 with the M2 failure
  vocabulary — no HTTP call, no deltas (vitest).
- Concurrency: a classifier run mid-flight while a per-turn run
  commits — both land, no clobbered rows (the cadence.md
  disjointness test).

## Tests

- Vitest throughout (this is the highest-risk slice): extraction
  parse fixtures, provenance matrix, disambiguation bands, retry
  state machine, barrier interleavings, cascade, UPSERT-merge,
  pre-flight halt for an unassigned agent, retirement prompt
  snapshot.
- Manual smoke: real provider, cadence 2–3 turns, verify graph
  population and the pill's low-priority behavior during a
  foreground turn.

## Open questions

- **Output wire format** — strict structured-output mode
  (capability-gated) vs tagged trailing block; also whether one
  call emits all write kinds or the pass splits into a small number
  of calls.
- **Scheduler placement** — store-subscription on entry commits vs
  an orchestrator-adjacent tick module.
- **τ_high / τ_low starting values** — canon suggests 0.75 / 0.50
  cosine as starting ranges; pin the constants and their config
  location (hardcoded v1 per the tuning-surface parking).
- **Prompt-window truncation cap** — `app_settings` carries
  classifier truncation caps (app-only settings); confirm the M1.5
  field and apply it to the window build.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
