# Memory probe

Diagnostic affordance for inspecting per-turn retrieval state and
re-tuning ranker parameters against captured state. Load-bearing for
the empirical-tuning pass against the
[scale-assumed pool sizes](./retrieval.md#scale-assumptions) —
without it, calibrating `λ_type`, `λ_div`, `kw_boost`, `τ_revive`,
per-query weights, and per-type budgets is guesswork.

This doc owns the **capture model** and the **simulator contract**.
The user-facing screen (capture browse, inspect, simulate) lives in
[`docs/ui/screens/memory-probe/memory-probe.md`](../ui/screens/memory-probe/memory-probe.md).

Cross-refs:

- [`retrieval.md`](./retrieval.md) — the ranker the probe inspects.
  All terminology (`sim_blend`, `recency_factor`, `kw_boost`,
  `pin_signal`, `chapter_boost`, MMR, budget-fill) is anchored
  there.
- [`edge-cases.md → v1 limitations`](./edge-cases.md#v1-limitations)
  — the probe was previously listed as parked; this design moves it
  to v1-blocking and lands the contract.
- [`data-model.md`](../data-model.md) — schema delta lives there
  (table shape, settings fields).

---

## Scope

Embedding-mode retrieval only — v1 embedder is hard-required at
story creation, so every story has a numeric ranker to inspect.
LLM-only retrieval (Mode-3) is out of v1; if it returns post-v1
the probe needs a different per-row body — see
[`parked.md → Mode-3 (LLM-only retrieval)`](../parked.md#mode-3-llm-only-retrieval).

Off by default, opt-in via a two-level gate:

- **App level** — `app_settings.diagnostics.enabled`. The master
  gate for the whole diagnostics layer (see
  [`observability.md → Gating model`](../observability.md#gating-model));
  memory probe captures only write when this is on AND the
  per-story toggle below is on.
- **Story level** — `stories.settings.probe_mode_active`.
  Per-story toggle in Story Settings · Memory. No-op when the
  app-level master is off.

Both must be on for new captures to write. Existing captures stay
inspectable when either toggle flips off; only new-capture writes
stop. Removing captures is always explicit (per-capture delete or
"clear all").

**Build-mode gating is intentionally NOT in scope.** The probe
code ships in production bundles; the two runtime gates above
(both default false) are the floor. Opt-in twice plus explicit
clear-all per
[`observability.md`](../observability.md) make the storage cost a
user-controllable choice — see also the per-story toggle's
storage-cost help text in
[`story-settings.md → Memory`](../ui/screens/story-settings/story-settings.md).

---

## Capture model

### When a capture is written

A capture is written immediately after the per-turn ranker emits its
selection, before prompt assembly. The capture lives in the same
transaction as the ranker output:

1. Pre phase commits the user-action delta.
2. Retrieval pass runs: queries embed, candidates score, MMR ranks,
   budget-fill selects.
3. **Capture writer** assembles a record from in-flight ranker state
   and writes a `probe_captures` row in the same transaction.
4. If the per-story FIFO cap is hit, oldest capture for the branch
   is dropped in the same transaction.
5. Turn proceeds to generation.

A failed retrieval pass (embedder unavailable, empty pool, vec0
KNN error) still captures, with an explicit `failure_reason` field —
debugging failures is a primary use case, and a missing capture for
the failed turn would be the worst possible UX.

### What gets captured — light mode (default)

Per capture:

- **Identity.** `branch_id`, `target_entry_id` (the entry whose
  retrieval this drove), chapter pointer, `captured_at`,
  `capture_mode = 'light' | 'deep'`, `embedding_model_id` active at
  capture.
- **Params snapshot.** Full block of every retrieval-tunable knob
  (per-type `λ`, `λ_div`, `kw_boost`, `τ_revive`, `w_action`,
  `w_digest`, `w_prose`, `min_score_threshold`, `chapter_boost`
  magnitude, per-type budgets, `fullChapterInBuffer`,
  `partialChapterBuffer`, `protectedBuffer`). Frozen to
  capture-time values; the
  simulator diffs against current story params at inspect time.
- **Three queries.** Q1 / Q2 / Q3 text content, plus per-query
  metadata: token count, source pointer (which entry / structural
  fields produced it), and for Q3 the per-sentence selection scores
  from the
  [heuristic prose extract](./retrieval.md#q3-heuristic-prose-extract).
  Vectors **NOT** stored in light mode.
- **Per-type candidate pool.** For each type
  (entities / lore / happenings / threads / chapters), one row per
  candidate that entered the type's ranker pool:
  - Candidate id (`target_kind`, `target_id`).
  - Display snapshot — denormalized name / title / brief text at
    capture time. Survives row deletion / edit so the probe stays
    readable indefinitely.
  - `sim_q1`, `sim_q2`, `sim_q3` — per-query cosine similarities.
  - `sim_blend` — weighted-avg blend at capture-time weights.
  - `recency_factor`, `pin_signal`, `kw_boost_value`,
    `chapter_boost_applied` (bool), `bypass_triggered` (bool).
  - `final_score`, `mmr_rank` (or null if pre-filtered out).
  - `selected` (bool), `drop_reason` (enum):
    `pre_filtered | mmr_dedupe | below_threshold | over_budget |`
    `candidate_too_large | not_dropped`.
  - `tokens_estimated`.
  - `embedding_stale` flag at capture time
    (per [`retrieval.md → Compute lifecycle`](./retrieval.md#compute-lifecycle)).
- **Pool funnel summary per type.** `pool_size`,
  `pre_filtered_size` (capped at 200 per
  [pre-filter rule](./retrieval.md#diversity--mmr)), `mmr_size`,
  `selected_count`, `tokens_used`, `type_budget`.
- **Structural floor.** List of must-inject rows (prompt buffer
  per the mode-dependent rule + protected-buffer spillover,
  active+in-scene entities, their location, active threads,
  `injection_mode='always'` rows) and their token cost. Surfaces
  what budget the per-type pools actually competed over.
- **Stale-row count per type** — rows still `embedding_stale` at
  retrieval, excluded from the pool because the pre-retrieval sync
  stage couldn't embed them (their vec0 entry was missing at
  retrieval time). Counts only; no per-row data, since stale rows
  weren't candidates.

### Deep mode (per-capture opt-in)

Adds two things to a light capture:

- The three query vectors.
- The per-row vector for every candidate in the pool.

Storage cost is roughly 100x light-mode at typical pool sizes. Lets
the simulator re-tune `λ_div` (MMR diversity) — see
[Simulatable parameters](#simulatable-parameters). Toggled on a
per-capture basis from the reader's per-turn probe affordance
**before turn-fire**; can't be retrofitted onto a light capture.

### Capture format

Stored in a new `probe_captures` table:

```sql
probe_captures {
  branch_id TEXT, id TEXT,                    -- composite PK; forks with branch
  target_entry_id TEXT,                       -- the entry whose retrieval this drove
  captured_at INTEGER,
  capture_mode TEXT,                          -- 'light' | 'deep'
  embedding_model_id TEXT,                    -- model active at capture
  failure_reason TEXT,                        -- nullable; set if retrieval failed
  payload BLOB,                               -- gzipped JSON of the per-capture record
  payload_size INTEGER,                       -- pre-compression size for storage UI
  PRIMARY KEY (branch_id, id),
  FOREIGN KEY (branch_id, target_entry_id) REFERENCES entries (branch_id, id)
}
```

Branch-scoped, branched (forks branch-scoped data normally).
**Captures are NOT delta-logged** — they're diagnostic, not story
state. A delta-logged capture would mean rollback unwinds probe
data, which is the opposite of what a tuner wants.

**Forking does NOT copy captures to the new branch.** The new
branch starts empty; new turns there get fresh captures if probe
mode is on. A capture is only meaningful against the candidate pool
that existed when it was written, and forks immediately diverge that
pool.

### Eviction — FIFO at 100 captures per story

When a new capture would push the per-story count over 100, the
oldest capture for that story (across all branches) is dropped in
the same transaction as the new write. Per-capture delete and
"clear all captures for this story" remain available as user
actions; eviction is the no-thought floor.

The cap is per-story, not per-branch — branching shouldn't multiply
the capture budget. A user fork-and-explore pattern would otherwise
let captures balloon.

Cap is fixed at 100 in v1, not user-tunable. If real signal shows
tuning sessions need more headroom, a setting follows. Storage
overhead at 100 captures is on the order of tens of MB at scale-
assumption volumes (light mode); deep-mode captures push that to
hundreds of MB and are expected to be used sparingly.

### Capture cost

Capture write is in-transaction with the ranker output, so it adds
to per-turn latency. Light mode adds:

- Serialization of in-flight ranker state to JSON: <5 ms typical.
- Gzip compression: <5 ms typical.
- One row insert, plus (potentially) one row delete on FIFO eviction.

Deep mode adds vector serialization — for typical pool sizes
(~hundreds of candidates) this is still <20 ms. Negligible relative
to the surrounding generation latency.

The capture is best-effort: if the write fails (disk full,
constraint error), the turn proceeds without a capture and the
failure is logged. Probe mode is diagnostic; it must not block
generation.

---

## Simulator contract

### What the simulator does

Re-runs the ranker against captured state with edited parameters.
Outputs the new selected set + per-row score deltas relative to the
captured selection. The simulator is **pure** — it reads the
capture, reads the user-edited param set, computes the new ranker
output in memory, returns the diff. No DB writes, no mutation of
the original capture.

The simulator must mirror the prod ranker bit-for-bit. Implementation
shape: extract the ranker (the
[`rank_per_type` / `rank_all` pseudocode](./retrieval.md#pseudocode))
into a pure-function module that both the prod retrieval pass and
the simulator import. Any divergence between them is a correctness
bug that produces misleading tuning. This is an implementation note,
not a UX one — but it determines whether the probe is trustworthy.

### Simulatable parameters

From a light capture:

- `w_action`, `w_digest`, `w_prose` — re-blend stored per-query
  sims into a new `sim_blend`.
- Per-type `λ` decay rates — re-compute `recency_factor` from
  stored `chapters_old`.
- `kw_boost` magnitude — re-scale stored `kw_boost_value`.
- `τ_revive` — re-evaluate the bypass branch against stored
  `sim_blend`.
- `chapter_boost` magnitude — re-apply where stored
  `chapter_boost_applied=1`.
- `min_score_threshold` — re-run budget-fill termination.
- Per-type budgets — re-run greedy budget-fill against stored
  `tokens_estimated`.
- `pin_signal` overrides — let the user simulate "what if I pin /
  unpin this row?" by overriding `pin_signal` per-row.

Adds in a deep capture:

- `λ_div` (MMR diversity) — requires candidate-vs-candidate
  cosines, which require the per-row vectors.

### Non-simulatable parameters

Even in deep mode, the simulator can't re-derive the candidate pool
itself. The pool composition depends on:

- The structural floor (computed from current scene at capture).
- Pool exclusions (common-knowledge happenings,
  pending / resolved / failed thread mode, same-name suppression
  per [edge-cases](./edge-cases.md#name-collision-and-disambiguation)).
- Awareness-graph filter (POV characters in scene at capture).

These are captured-state, not parameter-state. The simulator
operates on the pool that **was** there. Tuning that affects pool
composition (e.g., switching `fullChapterInBuffer`, adjusting
`partialChapterBuffer` or `protectedBuffer`) requires fresh
turns — the simulator surfaces those params as read-only with a
"regenerate to test" hint.

### Cross-capture aggregation — out of scope for v1

A user can simulate against one capture at a time. "Across the last
20 captures, how does bumping `τ_revive` to 0.9 change average
selection size?" — that aggregate view is the natural next ask but
introduces a query / filter / chart UX that's much heavier than
single-capture inspection. v1 ships single-capture only; the
empirical-tuning workflow is "browse captures, simulate the
suspicious ones, eyeball the diff, apply if confident."

If aggregate analysis becomes load-bearing for tuning beyond v1,
follows as a separate surface. Documented as a v1 limitation rather
than a planned feature.

---

## Cross-cuts

### Stale rows

Rows captured with `embedding_stale=1` show up in two places:

- The per-type **stale-row count** in the funnel summary (rows
  excluded from the pool because vec0 didn't have them).
- Per-row `embedding_stale` flag where applicable (a row that
  entered the pool before being marked stale during the same
  retrieval pass, edge case but possible).

The stale count is the answer to "why isn't X being retrieved?" when
X exists in the metadata table but its vector is degraded.

### Branch fork and capture portability

A capture is meaningful only against the branch where it was
written. Captures don't copy on fork. The probe surface enforces
this: opening a capture from branch A while currently on branch B
prompts a switch (or shows the capture in read-only inspect with a
"switch to branch A to simulate" CTA). Simulation against a capture
from a different branch is disabled.

### Embedding model swap

Captured `sim_q*` and `sim_blend` values are pre-computed cosines —
just numbers. They remain valid for inspection and simulation
indefinitely, regardless of subsequent model swaps. The simulator
re-blends and re-decays freely.

What's not portable: the candidate vectors themselves (deep mode
only). They live in the vector space of the model active at
capture. If the story's `embedding_model_id` swaps after a deep
capture, the captured vectors no longer share a space with the
current store. The simulator surfaces this — `λ_div` simulation
remains valid (it operates within the captured space), but a
warning notes that captured vectors are decoupled from the live
store.

Light captures are entirely model-agnostic post-capture; the swap
doesn't affect them at all.

### Param drift

If the params snapshot at capture differs from the story's current
params (the user has edited `λ_type` since the capture), the inspect
view treats the **captured params** as the live state being
inspected — that's the configuration that produced these scores.
A header badge marks the drift; hovering shows the diff. Switching
to simulate mode pre-fills the simulator panel with the **current**
story params, so the user is naturally comparing "as captured" vs
"as currently configured."

### Common-knowledge happenings

Their score path (`score = sim_blend + kw_boost`, no recency, no
pin) is captured the same way as awareness-routed happenings, but
with `recency_factor = 1.0` and `pin_signal = 0`. The simulator
preserves this branching — params that don't apply to common-
knowledge happenings (per-type `λ`, `pin_signal` overrides) are
no-ops on those rows.

### Failed captures

If retrieval failed at capture time (embedder down, empty pool,
KNN error), the capture's `failure_reason` is set and the body
contains whatever partial state was reached:

- Embedder failure during query embed — captures Q1/Q2/Q3 text
  but no sims; pool data may be empty.
- Empty pool (e.g., turn 1 of a fresh story before classifier has
  written anything) — captures the queries and the empty funnel.
- KNN error — captures queries and partial pool data up to the
  failure point.

The probe surface renders failure captures with a prominent banner
explaining what failed. Simulation is disabled (no scores to
re-rank). The capture is still useful as evidence for "what state
was the pipeline in when it failed?"

### Capture write failure

A capture write that fails (disk full, schema constraint, gzip
error) does NOT block the turn. The failure logs and the turn
proceeds without a capture. Repeated failures surface as a banner
in Story Settings · Memory · Probe ("Last N captures failed to
write").

---

## Schema delta

Landed in [`data-model.md`](../data-model.md):

- New table `probe_captures` per the
  [Capture format](#capture-format) shape above.
- Memory probe's app-level gate is `app_settings.diagnostics.enabled`
  (boolean inside the existing diagnostics JSON, not promoted to a
  column — matches the placement pattern of every other debug
  toggle). Default `false`. This is the same master gate that
  controls the broader diagnostics layer per
  [`observability.md → Gating model`](../observability.md#gating-model).
- New field `stories.settings.probe_mode_active` (boolean inside
  the existing settings JSON). Default `false`.

Both settings fields are explicit booleans rather than enum / mode
strings — there's no third state. The settings UI surfaces them as
toggles.

The `probe_captures` table is excluded from delta-log replay (per
the [Capture format](#capture-format) note). Bulk-clear operations
("clear all captures for this story") are direct deletes, not
delta-logged.

---

## Followups

### v1-internal

- **Simulator math validation.** The shared ranker module needs an
  integration test that compares prod-pass output against
  simulator-pass output on a captured state with identical params.
  Any divergence is a correctness bug.

### Post-v1 / parked-until-signal

- **Cross-capture aggregation.** Rolling per-tuning-experiment
  metrics across N captures (mean selection size, mean tokens used,
  delta vs baseline). Lands if single-capture simulation proves
  insufficient for the empirical-tuning pass.
- **Mode-3 probe shape.** Tracked under
  [`parked.md → Mode-3 (LLM-only retrieval)`](../parked.md#mode-3-llm-only-retrieval)
  — probe support returns alongside Mode-3 itself if it ships
  post-v1.
- **Multi-turn simulator playback.** Simulate a parameter change
  forward across the next N captured turns to see how cumulative
  retrieval evolves. Heavier; not in v1.
