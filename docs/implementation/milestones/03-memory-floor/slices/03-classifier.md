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

Resolved during slice planning; the resolutions are recorded in
[Implementation notes](#implementation-notes) below. The one question
the slice did not settle — involvement drift when scene membership is
edited after the fact — outlived the slice and moved to
[`followups.md`](../../../../followups.md), since it is triggered by the
world-state-block edit surface rather than by this pipeline.

## Implementation notes

### Decisions that constrain future slices

- **The field-scoped gate on `entities.status` is deliberately
  unbuilt.** `gateBehavior` stays `'no-gate'`. The colliding surface —
  the scheduled world-state-block edit
  ([`followups.md`](../../../../followups.md)) — is still unimplemented,
  and [Slice 3.8](./08-worldtime-edit.md) writes only
  `story_entries.metadata`, which the
  [write-set table](../../../../memory/cadence.md#concurrency) gives to
  the per-turn layer. Whoever lands the edit surface owns the gate; it
  must stay scoped to `status` rather than inverting `no-gate`
  wholesale.
- **`processedThrough` is written after the delta burst, not
  transactionally with it** — a direct non-delta `UPDATE branches` once
  the burst has landed. The orchestrator applies each delta as it is
  yielded, so there is no run-wide transaction to join. Watermark-after
  is the right order — the reverse would advance over facts that were
  then reversed, a silent permanent hole in the graph — and it is
  coherent, though not by the watermark alone. A crash between two
  committed deltas does leave them on disk with the watermark unmoved,
  but the marker is what closes the window: `beginRun` persists a
  `pipeline_runs` row for every kind including this one, each burst delta
  carries that run's `action_id`, and boot's `recoverInFlightRuns`
  reverse-replays all of them before anything re-reads the range —
  `abortRun` does the same for an in-process cancel. Pinned by
  `lib/pipeline/__tests__/classifier-burst-recovery.test.ts`. The marker
  settles inside the reversal's own transaction, because the replay is
  not idempotent — undoing a `create` deletes (repeatable), undoing a
  `delete` re-inserts (conflicts) — so an orphan left open over
  already-reversed deltas would fail deterministically on every later
  boot. The residual is the reversal that itself fails; boot then leaves
  the branch un-reconciled rather than freeing it, so the cadence cannot
  re-read the window (see the boot note below).
- **`bracketProseReversal` is the only sanctioned entry to the reversal
  sweep.** It owns both classifier-era obligations (drain the in-flight
  run, hold `reversalInProgress` across the whole wait → sweep window),
  and it is deliberately non-re-entrant — it throws — so the constraint
  is discovered at the first test run rather than by a dropped barrier
  in production. [Slice 3.9](./09-undo-batched.md) and
  [Slice 3.10](./10-regenerate.md) must call it, never
  `reverseAndPruneDeltaRows` directly. The clamp bound is
  `B = target.position`: `rollbackToEntry`'s target is itself the first
  removed entry.

### Contracts to preserve

- **`branches.classifier_status` has two independent writers** — the
  reversal clamp owns `$.processedThrough`, the pipeline owns the
  lifecycle keys (`state`, `retryCount`, timestamps). Every write is a
  key-scoped `json_set`; a whole-blob read-modify-write from either side
  silently reverts the other, which
  [`cadence.md → Concurrency`](../../../../memory/cadence.md#concurrency)
  bans.
- **`newCharacters` handles live in a reserved namespace (`new:`), and
  the return trip enforces it structurally.** The placeholder walker runs
  before the planner, so a handle that collides with a live placeholder
  (`c1`, `hp1`, …) would have every ref to the new character rewritten
  into the _existing_ entity's uuid — silent misattribution with no
  unresolved ref and no warning. The prompt reserves the prefix, but the
  guard that actually holds is `substituteClassifierIds` refusing to
  rewrite any ref a declared handle claims, so a non-compliant model
  cannot reach the failure. Any future ref-bearing field must keep both
  halves.
- **A pre-flight failure is recorded by `runClassifierNow`, not by the
  phase.** An unresolvable `classifier` agent halts the run before phase
  0, so the phase's own `nextStatusOnFailure` bookkeeping never executes:
  left alone the status stays `idle`, the backoff never arms,
  `failed-persistent` is unreachable, and the cadence re-fires the doomed
  run on every committed turn. Whoever adds a second pre-phase failure
  mode owns extending that mapping.
- **Cross-turn attribution is a prompt obligation, not an enforceable
  one.** The extraction schema carries one `sourceTurn` per fact, so the
  planner structurally cannot apply the "latest turn wins" rule; the
  only guard is an assertion that the rendered template still carries
  the directive.
- **`redoLastAction` keeps its own bracket and has no classifier
  drain** — an exemption, not an oversight. It re-inserts prose rather
  than removing it, so the barrier's premise ("don't derive from prose
  about to vanish") does not apply. It is now the only hand-rolled
  `setReversalInProgress` left in `undo.ts`; if a drain turns out to be
  wanted, that is a followups entry, not a silent fix.
- **`reverseReplayDeltas` (orchestrator abort, crash recovery,
  `submit-turn.ts`) carries neither obligation, correctly:** the entry it
  removes is at head, and a hard-gate per-turn run is in flight
  throughout, which `blockedBy` prevents the classifier from starting
  under.
- **Redo after an undo does not restore `processedThrough`** — settled
  by canon, not open.
  [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor)
  accepts the re-derive, and the duplicate happenings are cleaned at
  chapter-close dedup.

### Resolved developer decisions

- **Wire format:** one `generateStructured('classifier', …)` call over a
  single Zod schema with per-kind arrays. Keeps the pass literally "one
  response, one burst of deltas" as the barrier contract requires;
  splitting would double input cost over the window the cadence exists
  to amortize. Constraint discovered while building it: no schema field
  may use `.transform()` — `z.toJSONSchema` throws on transforms, so the
  `severity` clamp lives in the planner instead.
- **`common_knowledge` is absent from the schema** (auto-emission is
  forbidden by canon); happenings take the SQLite default `0`.
- **Scheduler placement:** `lib/classifier/scheduler.ts`, a pure
  controller with injected deps, wired in `bootstrap.ts` off
  `pipelineEventBus`'s `run_complete` — the drain worker's precedent. Its
  state is keyed **per branch**: global timer state let a tick on one
  branch destroy another branch's pending backoff, i.e. a failed run
  losing its recovery. `runNow` returns a marker rather than `void`
  (`'busy'` for an in-flight run, `'stopped'` for a torn-down scheduler),
  because it is the only escape from `failed-persistent` and a silent
  no-op there is unreportable.
- **Prompt-window cap:** new `classifierWindowMaxEntries` app setting
  (default 20), filling the app-scope truncation cap
  `architecture.md` specifies but M1.5 never landed. The pass advances
  the watermark only to the cut, so a long backlog drains over
  successive passes instead of skipping prose permanently.
- **The window is read from SQLite, never from `entriesStore`.** The
  store holds only the last `ENTRIES_WINDOW_SIZE` (50) entries, so a
  store-fed window starts at the reader's oldest loaded row — and since
  the pass then advances the watermark over the cut, every turn between
  the watermark and that row is skipped permanently, which is the exact
  failure the cap above is supposed to prevent. The phase queries
  `position > processedThrough` with `LIMIT maxEntries + 1`, the `+1`
  being what still lets `buildClassifierWindow` see the cut and set
  `truncated`. Unit tests that hydrate the store cannot catch a
  regression here; `periodic-classifier.spec.ts` covers it end to end.
- **`τ_high` / `τ_low`:** hardcoded `0.75` / `0.50` in
  `lib/classifier/reconcile.ts`; the tuning surface is parked to M7.5, and
  a config field with no UI is surface without a consumer. `τ_low` is
  load-bearing via `flagReason` (`'distinct'` / `'ambiguous'` /
  `'no-signal'`), which the M4 collision-review surface consumes.
- **Disambiguation similarity** embeds both the extracted description
  and the existing entity's in one call and cosines them in memory,
  rather than reading the stored vec0 vector — a first-introduction row
  is written `embedding_stale = 1`, so reading vec0 would make the
  decision depend on drain timing.
- **Slice size:** one slice / one PR organized as commit-sized task
  clusters; the 3.3a/3.3b split was recommended and declined.

### Deviations from the brief

- **The pass bounds its own model call (5 min), separately from
  `profile.timeout`.** The retry policy in scope here can only act on a call
  that _returns_; a provider that accepts the request and never answers is not
  a failure, so the backoff never armed. That case is uniquely unrecoverable
  for this pipeline: `state: 'running'` is persisted, and both
  `shouldCadenceFire` and `runNow`'s in-flight guard read it, so the pass stayed
  dead until the next boot with the pill showing `classifying` throughout — and
  unlike every foreground kind, the user has no cancel affordance to break it.
  The expiry is routed to `nextStatusOnFailure`, not the abort arm, so it burns
  a retry rather than silently rescheduling the same dead provider. A profile
  timeout shorter than the cap still wins (the SDK aborts first); a longer one
  is deliberately capped.

- **The cascade's "merge" arm is not built.** No merge action exists in
  the delta registry and this planner only ever creates happenings;
  happening consolidation and dedup are chapter-close lore-mgmt (M5.2).
  The cascade landed on the delete arm — the only one that can orphan
  rows today — and a future merge arm inherits the same child-row
  handling. The acceptance criterion is met on that arm, not silently
  unmet.
- **Boot gained `resetStuckClassifierRunState`.** Persisting
  `state: 'running'` at run start (needed to make `shouldCadenceFire`'s
  guard live) meant a crash between that write and the next status write
  wedged the cadence silently, with no escape until M7.2 ships the
  manual-run UI — unlike `failed-persistent`, which is deliberate and
  loudly reported. The reconciliation is a sibling step in
  `runBootstrap`, not part of `recoverInFlightRuns` (which is scoped to
  `pipeline_runs`), and is one key-scoped UPDATE on `$.state`;
  `retrying` and `failed-persistent` are explicitly left alone, since
  resetting those would erase a real error state and re-arm a broken
  provider. It consumes that pass's failures rather than merely following
  it: a branch still holding deltas from an orphan that would not reverse
  keeps `running`, which already suspends the cadence, so the classifier
  cannot re-read a window whose partial writes survive. The boot that
  finally reverses them reconciles the branch normally, and
  `[Run classifier now]` overrides throughout — the suspension is
  automatic only.
- **The reader was narrowed rather than the classifier widened.**
  `isGenerating` was "any run on this branch", which gave a `no-gate`
  classifier run a phantom streaming placeholder and a
  `generating-narrative` pill; it now tracks foreground kinds only.
  `GenerationStatusPill.onCancel` became optional rather than wiring a
  per-turn cancel that would no-op during a classifier-only run.
- **Disambiguation was hardened in review, against both of the shortcuts
  this note originally recorded as deliberate.** A truncating `cosine`
  scores a shared prefix of two differently-sized vectors — reachable
  mid embedder-swap — and hands a fabricated similarity to a
  create-or-merge decision; a dimension mismatch now degrades to
  `'no-signal'` instead. First-match-wins on namesakes is worse than the
  canon limitation it was justified by, because create-with-flag
  _manufactures_ namesakes: from the second flagged duplicate onward,
  insertion order decided whether the real match was ever scored. All
  namesakes are embedded in the same single call and the best is taken.
- **`unresolvedRefs` mixes entity refs with turn handles and merges
  "unknown" with "wrong kind".** Adequate as a counter; a future
  diagnostics consumer will want the two separated.

### Outstanding

The manual smoke is **done**, automated as
`e2e/tests/classifier-real-provider.smoke.spec.ts` (opt-in: it skips unless
`SMOKE_LLM_URL` / `SMOKE_LLM_MODEL` are set). Run against a local koboldcpp
serving a 4B-class Q4 model, it confirms the chain end to end — cadence tick →
pass → anchored deltas → graph rows → watermark — with every
`periodic_classifier` delta carrying an `entry_id`.

What it also showed, and what the M7.5 tuning pass should start from:

- **Extraction quality swings hard on a small model.** Two runs over the same
  window produced nine happenings and one. Titles and descriptions were sound
  both times and `occurredAtTurn` resolved to real entries, so provenance held.
- **`unresolvedRefs` dominates, not `window_head_fallback`.** 7 and 19
  unresolved refs against a single head fallback: the model invents its own
  handles rather than reusing the `[c1]` placeholders it was given. Involvements
  and awareness are what get dropped, so the graph gains happenings but few
  edges. The reserved `new:` namespace does not help here — these are refs to
  entities that already exist. That is a prompt/model-compliance problem and the
  first thing worth measuring.
- **Polymorphic involvement works:** the one edge that did resolve bound a
  happening to the `faction` "The City Watch", not a character.
- **The embedding contract is observable only before the drain.** The pass
  writes `embedding_stale = 1` and the drain clears it moments later, so a
  post-hoc assertion on that column races; the mock-LLM spec covers the
  write-path half instead.
