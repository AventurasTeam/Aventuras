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
stop. Flipping a toggle never removes a capture: user-initiated
removal is always explicit (per-capture delete or "clear all"), and
the only implicit removal is
[FIFO eviction](#eviction--fifo-at-100-captures-per-story) once a
story is at the cap.

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
selection, before prompt assembly. It is an independent, best-effort
write — there is no ranker transaction to join, because the ranker is
pure, and a failed turn does not roll a capture back:

1. Pre phase commits the user-action delta.
2. Retrieval pass runs: queries embed, candidates score, MMR ranks,
   budget-fill selects.
3. **Capture writer** assembles a record from in-flight ranker state
   and writes a `probe_captures` row in its own transaction.
4. If the per-story FIFO cap is hit, the oldest capture for the
   **story** — across all its branches, per
   [Eviction](#eviction--fifo-at-100-captures-per-story) — is dropped
   in that same transaction, so write-and-evict is atomic.
5. Turn proceeds to generation.

A retrieval pass that fails in the embedder family — init or call,
including the vector-invariant faults that classify into it — still
captures, with an explicit `failure_reason` field. Debugging failures
is a primary use case, and a missing capture for the failed turn
would be the worst possible UX.

Two cases the sentence above does **not** cover:

- **An empty pool is not a failure.** A pass over an empty pool
  succeeds; the capture writes with `failure_reason` null and
  zero-size funnels. Turn 1 of a fresh story reads this way.
- **A non-embedder fault writes no capture at all.** A vec0/SQLite
  error, a dead IPC bridge or a ranker bug propagates out of
  `runRetrieval` and aborts the turn before the capture site is
  reached. `failure_reason` is an `EmbedderErrorKind`, so there is no
  legal value for such a fault to carry. Closing that gap needs a
  capture-failure taxonomy separate from the embedder's — filed in
  [`triage.md`](../implementation/triage.md).

### What gets captured — light mode (default)

Per capture:

- **Identity.** `capture_version`, `branch_id`, `target_entry_id`
  (the entry whose retrieval this drove), `chapter_id`,
  `captured_at`, `capture_mode = 'light' | 'deep'`,
  `embedding_model_id` active at capture. The version is bumped
  whenever a captured field's shape or meaning changes, so a decode
  warns rather than silently misreading an older payload as the
  current type.
- **Tokenizer identity.** `tokenizer: { encoding, version }` — which
  vocabulary priced `tokens_estimated`. A replay under a different
  tokenizer can then warn instead of diverging quietly.
- **Params snapshot.** `params.ranker` embeds the ranker's own
  `RankerParams` **verbatim**, in its declared camelCase: `weights`,
  per-type `lambda`, per-type `pinBoost`, `lambdaDiv`, `kwBoost`,
  `tauRevive`, `minScoreThreshold`, `chapterBoost`, `preFilterTopN`,
  `typeOverhead`. Beside it sit the story-settings knobs the ranker
  does not own — `retrievalBudgets`, `fullChapterInBuffer`,
  `partialChapterBuffer`, `protectedBuffer`. Embedding the type
  rather than restating its fields is what makes a newly added
  tunable a type error here instead of a silently absent capture
  field. Frozen to capture-time values; the simulator diffs against
  current story params at inspect time.
- **Three queries.** Q1 / Q2 / Q3 text content, plus per-query
  metadata: token count, source pointer (which entry / structural
  fields produced it), and for Q3 the per-sentence selection scores
  from the
  [heuristic prose extract](./retrieval.md#q3-heuristic-prose-extract).
  Query **vectors are never stored**, in either mode — see
  [Deep mode](#deep-mode-per-capture-opt-in).
- **Per-type candidate pool.** For each type
  (entities / lore / happenings / threads / chapters), one row per
  candidate that entered the type's ranker pool:
  - Candidate id (`target_kind`, `target_id`).
  - `display_name` — denormalized name / title at capture time.
    Survives row deletion / edit so the probe stays readable
    indefinitely.
  - `display_text` — the exact string the ranker priced. **Null on a
    pre-filtered row**, which the simulator can never seat.
  - `sim_q1`, `sim_q2`, `sim_q3` — per-query cosine similarities,
    each **null where that query produced no vector**, a state a `0`
    cannot express. Presence is read off these three and nowhere
    else.
  - `sim_blend` — weighted-avg blend at capture-time weights.
  - `recency_factor`, `pin_signal`, `chapters_old`, `kw_boost_value`,
    `chapter_boost_applied` (bool), `bypass_triggered` (bool).
    `chapters_old` is stored clamped exactly as the decay exponent
    read it, so a `λ` or `pin_signal` replay recomputes the factor
    instead of trying to invert it.
  - `common_knowledge` (bool) — happenings only, absent on the other
    four types. The ranker forces `pin_signal = 0` and
    `recency_factor = 1` on those rows, which the captured pair alone
    cannot tell apart from an unpinned recent one.
  - `final_score`, `mmr_rank` (or null if pre-filtered out).
  - `selected` (bool), `drop_reason` (enum):
    `pre_filtered | below_threshold | over_budget |`
    `candidate_too_large | not_dropped`.
  - `tokens_estimated` — **null on a pre-filtered row**, because
    tokenization is deferred past the pre-filter cut (see
    [`retrieval.md → Token estimation`](./retrieval.md#token-estimation)).
  - `embedding_stale` flag at capture time
    (per [`retrieval.md → Compute lifecycle`](./retrieval.md#compute-lifecycle)).
- **Pool funnel summary per type.** `pool_size`,
  `pre_filtered_size` (capped at 200 per
  [pre-filter rule](./retrieval.md#diversity--mmr)),
  `selected_count`, `tokens_used`, `type_budget`.
- **Structural floor.** List of must-inject rows (active+in-scene
  entities, their location, active threads, `injection_mode='always'`
  rows) and their token cost. The token cost **excludes the `[id]`
  affix** the templates add to the three entity rows on a piggyback
  turn — whether piggyback fires is decided after retrieval, so a
  capture cannot know it. On those turns the floor's cost reads as a
  lower bound.
- **Prompt buffer cost.** `prompt_buffer_tokens` — the buffer window
  (mode-dependent rule plus protected-buffer spillover) priced as one
  scalar, not as floor rows: buffered entries carry no retrieval
  identity, so a row each would add bulk without adding a tunable.
  Normally the largest floor term, and the one per-type budget tuning
  is measured against — a capture without it under-reports what the
  pools competed over. Priced on the prose alone; the per-turn
  template wraps entries in bare newlines, so it reads as a lower
  bound the way the floor's own rows do.
- **Stale-row count per type** — rows still `embedding_stale` at
  retrieval, excluded from the pool because the pre-retrieval sync
  stage couldn't embed them (their vec0 entry was missing at
  retrieval time). Counts only; no per-row data, since stale rows
  weren't candidates.

### Deep mode (per-capture opt-in)

Adds one thing to a light capture: the per-row vector for every
candidate in the pool.

Candidate vectors alone are sufficient. `λ_div` — the one thing deep
mode exists for — needs candidate-vs-candidate cosines, and every
other simulation re-blends the per-row `sim_q1..3` the capture
already stores, so a query vector would never be read.

Storage cost is 40-80x light mode gzipped — measured at dim 384 and
dim 768 respectively on the fixture under
[Capture cost](#capture-cost), whose write cost is the sharper
constraint. Lets the simulator re-tune `λ_div` (MMR diversity) — see
[Simulatable parameters](#simulatable-parameters). Toggled on a
per-capture basis from the reader's per-turn probe affordance
**before turn-fire**; can't be retrofitted onto a light capture.

### Capture format

Stored in a new `probe_captures` table:

```sql
probe_captures {
  branch_id TEXT, id TEXT,                    -- composite PK; branch-scoped, NOT copied on fork
  target_entry_id TEXT,                       -- FK-less story_entries.id (branch-scoped, resolved via (branch_id, id)); the entry whose retrieval this drove
  captured_at INTEGER,
  capture_mode TEXT,                          -- 'light' | 'deep'
  embedding_model_id TEXT,                    -- model active at capture
  failure_reason TEXT,                        -- nullable; set if retrieval failed
  payload BLOB,                               -- gzipped JSON of the per-capture record
  payload_size INTEGER,                       -- pre-compression size for storage UI
  PRIMARY KEY (branch_id, id)
  -- No FK on (branch_id, target_entry_id): story_entries has a composite
  -- PK so a single-column FK is impossible, and entry refs are FK-less
  -- by design (entries are hard-deleted on rollback). Resolved in app code.
}
```

Branch-scoped, but the only branch-scoped table a fork skips — see
the branch-copy manifest under
[`data-model.md` → Branch model](../data-model.md#branch-model).
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
overhead at 100 light captures is ~10 MB at scale-assumption
volumes, at the ~97 KB gzipped each measured under
[Capture cost](#capture-cost). A hundred deep ones would be ~400 MB
at dim 384 and ~780 MB at dim 768, which is why they are expected to
be used sparingly.

### Capture cost

Capture write is in-transaction with the ranker output, so it adds
to per-turn latency. Measured, not estimated:
`bench/probe-capture-cost.test.ts` (`pnpm bench:probe`) builds and
compresses a capture over the same
[cost-budget](./retrieval.md#per-turn-cost-budget) fixture the
retrieval bench uses — a ~1070-row pool at 6000 happenings / 60
chapters, desktop Node 24, median of seven warm builds after two
discarded:

| Stage                              | light  | deep, dim 384 | deep, dim 768 |
| ---------------------------------- | ------ | ------------- | ------------- |
| Payload assembly                   | ~1ms   | ~8ms          | ~16ms         |
| `JSON.stringify` + UTF-8 encode    | ~1ms   | ~32ms         | ~67ms         |
| Gzip                               | ~9ms   | ~303ms        | ~604ms        |
| **Build and compress, end to end** | ~11ms  | ~341ms        | ~673ms        |
| Payload, uncompressed              | ~675KB | ~9.2MB        | ~18MB         |
| Payload, gzipped                   | ~97KB  | ~3.9MB        | ~7.8MB        |

Plus one row insert, and one row delete when FIFO eviction fires.
Neither is in the table: one statement against a PK-only table, the
same statement in both modes.

**Light mode is cheap; deep mode is not.** ~11 ms against a ~108 ms
retrieval pass is the price of the default path, and assembly stays
there because the only tokenization a capture pays for is the three
query texts and the structural-floor rows — pool rows reuse
`tokens_estimated` off the trace. The fixture's floor is 4 rows, so
that stage is not stressed by these numbers; at
[`retrieval.md`'s measured ~45-60 µs per row](./retrieval.md#token-estimation)
a floor in the dozens still leaves assembly under 5 ms.

Deep mode costs **~340 ms at dim 384 and ~670 ms at dim 768** on the
same fixture, three to four times the entire retrieval pass, because
it serializes a vector for every pool row — not just the seated ones —
as JSON number arrays. It is synchronous, on the JS thread, inside
the write transaction. Deep mode is per-capture opt-in and reachable
only from a developer affordance today, so this bounds the
simulator's design rather than any shipped path: the levers, if it
ever needs to be cheaper, are storing vectors only for rows that
survive the pre-filter, or a binary encoding instead of JSON floats.

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

**The light-mode list below is under review.** Slice 3.5's parity
work found most of it unreachable from a light capture. Every
parameter that feeds `score` changes MMR's greedy pick order, and
recomputing that order needs the candidate-vs-candidate cosines only
a deep capture's per-row vectors carry.
`min_score_threshold` is further out of reach: it compares against
the post-MMR `mmr_score`, and no capture stores one — `final_score`
is the **pre-MMR** raw score.

**Per-type budgets are the confirmed-surviving case.** The
below-threshold latch is monotone over the MMR order, so the first
captured `below_threshold` row pins the partition and no budget
change can move it; re-walking `mmr_rank` order against
`tokens_estimated` then reproduces the fill exactly.

What light mode should actually offer — accept the narrower list,
capture an `mmr_score` per row (one float, recovers the threshold),
or store the kept-set pairwise cosines (recovers everything) — is an
open product call, to settle before the simulator is built. Until
then read the list as design intent, not as shipped capability.

From a light capture:

- `w_action`, `w_digest`, `w_prose` — re-blend stored per-query
  sims into a new `sim_blend`.
- Per-type `λ` decay rates — re-compute `recency_factor` from stored
  `chapters_old`, which every captured candidate carries.
- `kw_boost` magnitude — re-scale stored `kw_boost_value`.
- `τ_revive` — re-evaluate the bypass branch against stored
  `sim_blend`.
- `chapter_boost` magnitude — re-apply where stored
  `chapter_boost_applied=1`.
- `min_score_threshold` — re-run budget-fill termination.
- Per-type budgets — re-run greedy budget-fill against stored
  `tokens_estimated`.
- `k_pin` per-type — re-scale the pin multiplier against stored
  `sim_blend`, `recency_factor` and `pin_signal`. Needs no field the
  capture does not already carry.
- `pin_signal` overrides — let the user simulate "what if I pin /
  unpin this row?" by overriding `pin_signal` per-row. Rests on the
  same field `λ` does: an override has to recompute `recency_factor`,
  and the captured `(recency_factor, pin_signal)` pair pins down the
  underlying age only while `pin_signal < 1` — at exactly 1 the factor
  is 1 regardless of age. `chapters_old` is what closes that.

Adds in a deep capture:

- `λ_div` (MMR diversity) — requires candidate-vs-candidate
  cosines, which require the per-row vectors.

### Non-simulatable parameters

Even in deep mode, the simulator can't re-derive the candidate pool
itself, nor the cut that decides which of it reaches MMR:

- The structural floor (computed from current scene at capture).
- Pool exclusions (common-knowledge happenings,
  pending / resolved / failed thread mode, same-name suppression
  per [edge-cases](./edge-cases.md#name-collision-and-disambiguation)).
- Awareness-graph filter (POV characters in scene at capture).
- `preFilterTopN` — re-slicing the top-N by raw score changes which
  rows reach MMR and so its greedy pick order, which needs the
  per-row vectors a light capture does not store. Raising it is out
  of reach even in deep mode: a pre-filtered row carries
  `display_text` and `tokens_estimated` as null, so an admitted row
  has neither a text to re-price nor a cost to seat against a budget.

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

If retrieval failed in the embedder family at capture time, the
capture's `failure_reason` is set — on the row **and** in the payload,
so `replayType` can refuse a failed capture without the row — and the
body contains whatever partial state was reached:

- Embedder failure during query embed — captures Q1/Q2/Q3 text
  but no sims; pool data may be empty.
- Vector-invariant fault mid-pass — captures queries and partial
  pool data up to the failure point.

Not in this list: an empty pool (a success, `failure_reason` null)
and a non-embedder fault (no capture written at all). See
[When a capture is written](#when-a-capture-is-written) above.

The payload's marker is required, not defaulted. A decode refuses a
payload that omits it rather than reading the row's column as a
stand-in — the payload is the single source `replayType` consults,
and a stale column deciding a replay's outcome is worse than the
capture surfacing as corrupt in the browse list.

Stale counts read zero on a failure arm. The failure carries one
un-split scalar with no per-type breakdown, so spreading it across
five types would be a guess — read `failure_reason` and the pipeline
log instead.

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
