# Retrieval

Embeddings, queries, candidate pools, hybrid retrieval per type,
pinning, per-type budgets, and the ranker that turns it all into the
injected slice for each turn.

---

## Embedding infrastructure

### Runtime — provider OR local, user choice

User-pickable backend per story (or app-default), both producing the
same memory algorithm:

- **Provider embedding endpoint.** Self-hosted or cloud, depending on
  the user's configured provider. Anthropic doesn't expose
  embeddings; OpenAI, Voyage, Google do. The
  `app_settings.providers[].cachedModels[].capabilities` schema
  carries embedding capability per model.
- **Bundled local embedder.** A quantized small ONNX model
  (`all-MiniLM-L6-v2` or similar; selection lands at implementation),
  ~25MB bundle, ~384-dim, runs on CPU. Cross-platform via Electron on
  desktop and Expo on mobile.

The user picks one or the other in App Settings → Memory; both drive
identical retrieval behavior. The choice affects only the embedding
model, not the algorithm.

### Storage

The conceptual / logical shape is a polymorphic FK mirroring the
`translations` pattern:

```sql
embeddings {
  branch_id TEXT, id TEXT,                      -- composite PK; forks with branch
  target_kind TEXT,                             -- 'entity' | 'lore' | 'happening' | 'thread' | 'chapter'
  target_id TEXT,                               -- id in target_table
  field TEXT,                                   -- 'description' | 'body' | 'composite' | etc.
  model_id TEXT,                                -- canonical embedding model id; the model that produced this row's vector
  dim INTEGER,                                  -- vector dimension
  vector BLOB,                                  -- packed float32 or float16
  source_hash TEXT,                             -- content hash of source fields at embed time
  updated_at INTEGER,
  PRIMARY KEY (branch_id, id),
  UNIQUE (branch_id, target_kind, target_id, field, model_id)
}
```

**Physical storage — per-type `vec0` virtual tables.** Production
uses one [`sqlite-vec`](https://github.com/asg017/sqlite-vec) `vec0`
virtual table per target kind: `entities_vec`, `lore_vec`,
`happenings_vec`, `threads_vec`, `chapter_summaries_vec` — each
joined to its metadata sibling by id, scoped per row by `branch_id`
in an auxiliary column so retrieval queries can filter to a single
story / branch. The polymorphic schema above is the logical view;
vec0 doesn't filter efficiently across mixed-type rows, so per-type
physical layout is the production shape. Validated in PoC; per-query
KNN at ~11 / 43 / 61 / 122 ms at 1k / 10k / 50k / 100k rows on a
flagship Android device. `source_hash` placement (auxiliary vec0
column or per-type sidecar metadata table) is a production-
integration detail, not pinned here.

**Per-branch single-model invariant.** A retrieval pass is always
scoped to one branch, and all vectors compared in that pass share
one model — query and stored vectors must live in the same vector
space or cosine similarity is meaningless. Each branch's rows are
uniformly under the model that was active when those rows were
embedded.

**Multi-model coexistence across the database.** Different stories
(and thus different branches) can use different embedding models.
A story created when `app_settings.embedding_model_id` was "model-x"
keeps its rows under model-x even after the user switches the app
default to "model-y" — its `stories.settings.embedding_model_id`
records "model-x" until an explicit re-index runs (see
[Model swap UX](#model-swap-ux)). The same `*_vec` table holds rows
from multiple models concurrently, partitioned by branch; each
branch is internally consistent. The `model_id` column on each row
labels the producing model (used as a cache key and to detect
mismatch with the branch's recorded model id, signalling bug or
ungated swap).

**Source-hash tripwire.** `source_hash` stores the content hash of
the embedded fields at embed time (`xxhash(title + description)` or
similar). Under the [Compute lifecycle](#compute-lifecycle) contract
vec0 stays in sync with source content via eager-sync-on-write, so
`source_hash` is a tripwire — at retrieval, a mismatch against the
candidate's current content hash indicates a write path bypassed
the embed step (bug, ungated direct DB write). Log the mismatch
loudly; treat the row's vector as untrusted (exclude or flag, do
not silently re-embed and continue). Hash is chosen over timestamps
because rollback restores prior `updated_at` along with the rest of
the row's state — a timestamp-based check would invert post-
rollback and silently mask the bug it was meant to catch. Content
hashes are timeline-direction-agnostic. Embeddings themselves are
not delta-logged (deterministic from source); the
[`embedding_stale`](#compute-lifecycle) flag carries explicit
degradation state when the eager-sync invariant can't be met.

Branched (forks with the branch like every other branch-scoped table).

### What gets embedded per type

| Type             | Field                                                | Stability                                             |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| **Entity**       | `name + description`                                 | Stable; re-embed only on user edit of either          |
| **Lore**         | `title + body`                                       | Stable; re-embed on user edit                         |
| **Happening**    | `title + description`                                | Stable after creation; re-embed on user edit          |
| **Thread**       | `title + description`                                | Stable; re-embed on user edit                         |
| **Chapter**      | `summary + theme`                                    | Stable after Phase 2 generates; re-embed on user edit |
| **Scene digest** | composite of structural fields plus optional summary | Per-turn ephemeral; not stored                        |

**Entity state is excluded from embeddings.** `visual.*`,
`equipped_items`, etc. mutate per turn; including them in entity
embeddings would force per-turn re-embeds across the cast. State
mutations affect retrieval via the structural floor (active+in-scene
short-circuit) and via the entity's role in scene digests, not via the
entity embedding itself.

### Compute lifecycle

**Eager-sync-on-write contract.** Every write that mutates an
embedded field embeds the new content and updates vec0 in the same
transaction. Creates (classifier emit, wizard, chapter-close
summary, branch-fork copies), updates (user-edit of a description,
lore-mgmt refinement at chapter close), and rollback (delta-log
reversal restoring prior content) all go through this path. By
construction vec0 is never out of sync with source content.

The asymmetry that forces this contract: vec0 KNN can only return
rows that exist in vec0. A row written to its metadata table but
lacking a vec0 entry is invisible to retrieval — there's no "lazy
at first retrieval" path because retrieval can't discover what
isn't indexed. Net-new rows must be embedded before retrieval can
find them. Mutations of existing rows can't fall back to lazy
either, because KNN ranks against the stored vector — a stale
vector silently mis-ranks or excludes candidates that current
content would have qualified.

**Embedder unavailability — `embedding_stale` flag.** When an
embed call fails at write time (init failed lazily, provider
network down, EP crashed) the write succeeds in the metadata
table, the row's `embedding_stale` is set to 1, and vec0 is left
without the row (for creates) or has the row removed (for updates
that invalidate the existing vector). The flag captures the
degradation explicitly — embeddings aren't delta-logged, so without
it any drift between source content and stored vector would be
silent.

**Embed failure is blocking, not "queue and continue."** A failed
embed is treated identically to a failed LLM call: surfaced as an
error, must be resolved, no ignore path. The next-turn affordance
disables until the user picks Retry / Switch embedder / Roll back
this turn. See
[`model-management.md → Embedder failures`](./model-management.md#embedder-failures)
for the action surface and the wider failure-mode discussion.

A worker drains flagged rows opportunistically when conditions
allow — if the user's retry succeeds, or the embedder recovers and
the next normal embed call goes through, the worker catches up the
staleness in the same transaction. The opportunistic drain is the
recovery mechanism; it isn't a "user can ignore the error and let
the worker fix it later" license. The blocking UX prevents the
ignore path.

**Retrieval excludes stale rows.** Stale rows aren't in vec0 — they
don't surface as KNN candidates. Better known-absent than silently-
wrong.

**Per-turn cost.** With this contract, retrieval pays no embed cost
inline for stored rows — vec0 is fresh by the time KNN runs. The
query side still embeds three queries per pass; see
[Query construction](#query-construction--three-vector-stack).

- **Before turn:** embed the three queries (user action,
  structural digest, scene context). Short text; <20 ms local
  warm, <100 ms API.
- **At each embedded-field write:** embed inline as part of the
  write transaction. Atomic with metadata write. Local mode warm
  CPU ~10–30 ms per row; provider mode ~100–300 ms per network
  round-trip (batchable across multiple rows in one transaction).
- **Cache:** keyed by `(target_kind, target_id, field, model_id)`.
  If source field unchanged and model unchanged, reuse.

**Bulk import** (loading a story from `.avts` or migrating an old
database) needs an explicit batched-embed phase, not naive per-row
eager. 100k rows × 10 ms is 16 minutes if you embed each inline
during import; batch the embed calls (especially in provider mode,
where each call is a network round-trip) and surface progress UI.
Same machinery as the model-swap re-index path.

**Edit storms** are not a concern because saves are explicit user
actions in the v1 design — no autosave per keystroke. One save
equals one embed.

### Performance characteristics — PoC findings

Measured on Galaxy Fold 7 (last-gen flagship Android); low-end
device testing remains open. The numbers below validate the design
choices above and inform per-turn budget realism. Mobile feasibility
is settled with significant headroom on flagship hardware; a
4-year-old mid-range device could be 10x slower and still pass.

**Embedder cost (local mode, `Xenova/all-MiniLM-L6-v2-q8` via
ORT-RN).**

- **Warm per-embed:** CPU 10 ms mean / 1–30 ms range; NNAPI 13 ms
  mean, much tighter distribution. NNAPI's stability is more
  valuable for P99-bounded budgeting than its slightly higher mean.
- **Single-shot vs tight-loop variance.** Tight-loop microbenchmark
  measures ~10 ms warm; single-shot embeds (with idle gaps) come in
  closer to ~30 ms. CPU governor downclock between calls accounts
  for the gap. Same pattern under both CPU and NNAPI EPs. **Per-turn
  budgeting uses the single-shot number** — three single-shot query
  embeds is realistically ~100 ms under normal use, not 30 ms.
- **Cold init:** ~270 ms (asset extraction from APK dominates,
  ~150 ms). Warm re-init: ~120 ms.
- **EP determinism:** CPU vs NNAPI cosine = 1.000000. Either ORT
  enforces fp32 at partition boundaries or the quantized-int8 ops
  are deterministic across implementations. The single-key
  `embedding_model_id` cache key is sufficient — no need to broaden
  to `(model_id, execution_provider)`.
- **xnnpack EP** crashes the app on embed; not blocking since CPU +
  NNAPI both work and are interchangeable.

**Retrieval pipeline (sqlite-vec via expo-sqlite SDK 55).** Drizzle
wrapper packages were rejected (single-version, no source link,
~zero downloads); Drizzle's `sql` template-literal escape hatch
handles vec0 operations natively.

- **Per-query KNN against vec0:** ~11 / 43 / 61 / 122 ms at
  1k / 10k / 50k / 100k candidates. Three queries per pass →
  total retrieval (incl. embed + merge) is ~478 ms at 100k —
  ~5-8x faster than JS-side cosine at large pools, comparable at
  1-10k. Slower than the published 75 ms@100k benchmark — likely a
  mix of mobile ARM lacking AVX2 SIMD, expo-sqlite bridge overhead,
  and 3-query vs 1-query workload.
- **Insert cost:** ~600 µs/row → 60 s to populate 100k vectors.
  Bulk-population events (first-story embed, model-swap re-index)
  need progress UI. Per-turn incremental writes are not a concern.
- **JS-side cosine scan + ranker + MMR (alternative path,
  rejected).** Cosine scales linearly: ~24–30 µs per 384-dim dot
  product on Hermes. Initial MMR was ~280 ms regardless of pool size
  (iteration overhead dominated FLOPs); a `Uint8Array` bitmap +
  incremental `maxSimToSelected[]` rewrite dropped it to ~15-18 ms
  (~17x). A contiguous flat `Float32Array(N×dim)` pool was **worse**
  than per-vector `Float32Array[]` — Hermes pays a tax on
  offset-indexed typed-array access that exceeds cache benefit.
  JS-only retrieval is comfortable up to ~10-15k effective
  candidates; at 50k it's ~1.5 s; at 100k ~3.5 s. **vec0 is the
  canonical retrieval path for v1** — splitting paths just for the
  early-game window where JS is competitive adds maintenance cost
  without real benefit.

**Cross-device tier-finding (open).** PoC tested only the flagship.
Whether one model serves all device classes vs tiered selection per
detected class is genuinely unanswered. The off-ramp (demote local
to desktop-only / opt-in, leave provider as mobile default if
low-end devices fail) remains on the table until cross-device data
lands.

### Model swap UX

**Why a per-story model swap is disruptive.** Embeddings only have
meaning inside the vector space of the model that produced them.
A query embedded under model B can't be compared to vectors stored
under model A — cosine similarities go nonsensical. Within one
story, the clean paths to switch models are full re-index (rebuild
every vector under the new model) or explicit user assertion that
the underlying model is unchanged (label-only update, no rebuild).
A partial / lazy re-embed gives broken retrieval over a mixed-state
subset until convergence and is not on offer.

**App-level vs per-story.** `app_settings.embedding_model_id` is
the default for newly-created stories only. Existing stories carry
their own `stories.settings.embedding_model_id`, set at story
creation and unaffected by app-level changes. A user switching the
app default doesn't disturb any existing story.

**Where the dialog fires.** Per-story, when the user explicitly
moves a story to a different model — either via Story Settings
("Change embedding model for this story") or by accepting an
"upgrade to current default" prompt surfaced when opening a story
whose model differs from the current app default. AlertDialog
surfaces three options:

- **Re-index this story.** Default. The swap is crash-safe via a
  stage-then-flip flow tracked by
  `stories.settings.embedding_swap_target`:
  1. **Swap-start (transaction).** Set
     `stories.settings.embedding_swap_target = NEW_MODEL_ID`.
     Commit. From this moment, the marker is the source of truth
     for "swap in flight; expect partial NEW-model rows."
  2. **Phase 1 — re-embed non-destructively.** Foreground job
     (re-index runs in the user's view, not a background queue)
     embeds each row under the new model and INSERTs alongside
     existing rows (`model_id = NEW` next to `model_id = OLD`).
     Each row's insert is its own small SQLite write. Old vectors
     stay intact throughout; retrieval keeps working under the
     old model. Vec tables temporarily ~2x size for swap-affected
     rows. Progress indicator: "re-indexing X / N — retrieval
     limited."
  3. **Phase 2 — atomic flip (transaction).** Single SQLite txn:
     - `DELETE FROM *_vec WHERE branch_id IN (...) AND model_id = OLD`
     - `UPDATE stories SET settings = jsonb_set(settings, '$.embedding_model_id', NEW_MODEL_ID)`
     - `UPDATE stories SET settings = jsonb_remove(settings, '$.embedding_swap_target')`

     Commit. Story is now consistently on NEW.

  **Crash recovery.** On story open, if `embedding_swap_target`
  is set, surface a resume / cancel prompt:
  - **Resume.** If any rows lack a `model_id = NEW` counterpart,
    continue Phase 1 (skip rows that already have one). Then run
    Phase 2.
  - **Cancel.**
    `DELETE FROM *_vec WHERE branch_id IN (...) AND model_id = NEW; clear embedding_swap_target;`
    Story stays on old model.

  **Cancel during a live swap (not a crash)** follows the same
  Cancel path — partial NEW vectors are deleted, marker cleared.

  **Block second swap while marker is set.** Re-index is a
  foreground job, so the in-app flow naturally prevents a second
  initiation — but the invariant is spec-pinned: while
  `embedding_swap_target` is non-null, the UI surfaces the
  resume / cancel prompt on next picker-open and disables "Change
  embedding model for this story" until resolved.
  Belt-and-braces against any future surface (Diagnostics
  override, MCP, scripted migration) that might try to start a
  parallel swap.

- **Keep on the current model.** Don't change anything. Story
  stays on its existing model; the "current model differs from app
  default" prompt stops nagging until the next manual swap
  attempt.
- **Skip with relabel.** Bulk-updates this story's recorded
  `embedding_model_id` to the new value without recomputing
  vectors or touching vec0. **Only safe when the user knows the
  underlying model is unchanged** — relabeling a custom import,
  canonical-id refactor, filename rename, quant-suffix change.
  Disclaimer shown that this is the user's assertion; if the new
  id actually points to a different model, retrieval quality
  silently degrades and the system has no way to detect that.
  Instantaneous; no swap-target marker (nothing to crash through).

A standalone "Re-index this story now" button stays available in
the same Story Settings panel for users who want to force a
re-index without changing the model. It uses the same
stage-then-flip flow (target = current model, same crash-recovery
contract).

### Matryoshka effective dim

Provider models trained with **Matryoshka representation learning**
(MRL) produce vectors whose first N dimensions are themselves a
usable embedding at lower cost. OpenAI `text-embedding-3-large`
(3072 native), `text-embedding-3-small` (1536), Qwen3-Embedding,
BGE-M3, and others ship with a curated dim ladder in their model
card. Truncating to a smaller N trades slight retrieval quality
for proportional storage and compute reduction — at 1024 dim a
3072-dim native model uses 1/3 the storage and ~1/3 the per-turn
KNN compute.

Local-mode is **out of scope** for this lever. The bundled
`all-MiniLM-L6-v2-q8` is 384-dim native — already small; further
truncation isn't worth the quality tail.

#### Schema

A new immutable per-story field:

```
stories.settings.effectiveDim?: number
```

- `null` — use the model's native dim. Default for stories whose
  embedding model doesn't declare Matryoshka support.
- `<N>` — store and query at N dim, truncated from the model's
  native output. Set at story creation; **locked thereafter** with
  the same lock semantics as `embedding_model_id`. Changing it
  would invalidate every stored vector under the old dim and force
  a full re-index — same trade-off as a model swap, exposed
  through the same UX path.

#### Capability flags — provider-side

The provider-model capability JSON gains two fields:

```ts
app_settings.providers[].cachedModels[].capabilities = {
  reasoning?: boolean,
  structuredOutput?: boolean,
  matryoshkaSupported?: boolean,    // NEW
  matryoshkaDims?: number[],        // NEW; curated ladder, e.g. [256, 512, 1024, 1536, 2048, 3072]
}
```

Capability flags are detected from the provider's `/models`
metadata where available and **always user-overridable** in App
Settings · Providers · Models — same pattern as
`reasoning` and `structuredOutput`. A user setting
`matryoshkaSupported = true` on a model the provider didn't
declare is a power-user assertion: the system honors it, and
quality is the user's problem if the model wasn't actually
trained for it.

`matryoshkaDims` is the **curated** ladder — the dims the
provider explicitly endorses. The story-creation picker lists
those first, plus a `Custom…` option for any N from 1 up to
native. Dims off the ladder may exhibit quality cliffs; that's
the user's call.

#### Truncation contract

When `stories.settings.effectiveDim = N` is non-null:

1. **Stored vectors.** At every embed-write (creates, edits,
   chapter-close summaries, etc.), the provider returns a native-
   dim vector. The system truncates to the first N floats and
   **re-normalizes to unit length** before storing. Cosine
   similarity on L2-normalized vectors requires this — truncation
   without re-normalization breaks the unit norm and degrades
   ranking.
2. **Query vectors.** The same truncation + re-normalization
   applies to the three per-turn query vectors (Q1 / Q2 / Q3) so
   query and stored vectors live in the same N-dim space.
3. **vec0 partitioning.** The per-type `*_vec` virtual tables
   store vectors at the dim of the stories that created them;
   different stories can run different effective dims in the same
   physical table, partitioned by `branch_id` per the
   [Storage](#storage) section. Within one branch, all rows share
   one dim — the same single-model invariant extended to dim.
4. **Source-hash tripwire.** `source_hash` continues to compare
   content hashes, not vectors. Truncation is deterministic from
   the native vector; `source_hash` mismatch still indicates a
   bypassed embed step.

Some providers offer **server-side truncation** by passing a
`dimensions` parameter on the embedding request. Where supported,
the integration uses the server-side path — saves bandwidth and
ensures the truncation matches the model's published behavior
exactly. Where not supported, client-side truncation does the
same math; per published Matryoshka properties the result is
indistinguishable.

#### Defaults — platform-aware suggestion

At story creation, the wizard suggests an effective dim based on
the platform the user is creating on:

- **Mobile** — smallest curated dim that's `≥ 512` (typical:
  1024). Mobile-tier devices benefit most from the storage
  reduction (smaller on-disk footprint matters more on phones than
  on desktop).
- **Desktop** — model native dim (no truncation). Desktop has
  enough headroom that the quality tail outweighs the
  cost reduction.

Aventuras is local; a story stays on the device where it
was created. The suggestion reflects that reality. The user can
override either way — picking native on mobile is fine if the
user has signal that the device handles it.

The wizard's cost preview shows **storage only** — `dim × 4 bytes`
× projected row count for a 30-chapter story (per
[scale assumptions](#scale-assumptions)). Retrieval latency is
deliberately not shown: per-query KNN is linear in dim (PoC
table in
[`Performance — PoC findings`](#performance-characteristics--poc-findings) —
~11 / 43 / 61 / 122 ms at 1k / 10k / 50k / 100k rows on a
flagship Android at 384-dim), so smaller dim is mathematically
faster, but absolute
ms vary with the user's device and we have data for one device
only. At realistic story scales the latency difference between
dims is sub-second across all reasonable choices, so storage is
the load-bearing axis.

#### Per-turn pipeline impact

- **Embed cost** — unchanged at the API layer (provider returns
  native dim either way). Slight savings if `dimensions` parameter
  reduces bandwidth.
- **Storage cost** — `dim × 4 bytes` per row. Direct ratio: 1024
  vs 3072 = 1/3 the bytes.
- **KNN cost** — cosine scan compute is linear in dim. Direct
  ratio: 1024 vs 3072 ≈ 1/3 the per-row work for the same pool.
- **MMR cost** — same linear factor; MMR's diversity computation
  is also dim-bound.
- **Memory probe captures** — light captures store per-row
  similarities (3 floats per row) regardless of dim; deep captures
  store vectors and follow the dim ratio. See
  [`probe.md → Capture model`](./probe.md#capture-model).

#### Edge cases

- **Capability flag flips after stories exist.** A user manually
  toggles `matryoshkaSupported = false` on a model that already
  has stories with non-null `effectiveDim`. Existing stories'
  vectors stay where they are — the flag only governs new-story
  creation. Trust the stored data over the flag.
- **Provider redeploys a different model under the same id.**
  Same as the existing model-swap-mismatch hazard. The
  [model swap UX](#model-swap-ux) covers it; the `Skip with
relabel` path is already user-attested-only. Effective dim
  joins `embedding_model_id` in the locked-set the relabel
  asserts unchanged.
- **Bulk re-index (model swap).** Re-index uses the story's
  current `effectiveDim` (the one stored at creation, not a
  per-swap input). A model swap that changes the underlying model
  doesn't re-pick the dim; it rebuilds at the same N.

---

## Query construction — three-vector stack

Each retrieval pass embeds three queries and ranks candidates against
each, blending the per-vector similarities into a final score per
candidate.

### Q1: User action

The user's action text for the current turn. Always available
(retrieval runs after the Pre phase commits the user-action delta).
Short, signal-dense, embeds fast.

### Q2: Structural digest

Code-template floor + optional piggyback enrichment:

```
{sceneEntities.names}, {currentLocation.name}.
Active threads: {activeThreads.titles}.
Era: {era_name}.
{summary}    -- optional, from piggyback trailing block
```

Structural fields are computed from existing data; deterministic,
free, always available. The summary line is **optional enrichment**
from the piggyback trailing block (one sentence, ~30 tokens). When the
trailing block parses, summary is included; when it doesn't, the
structural template stands alone.

The bet on enrichment-not-dependence: rich digests improve retrieval
ranking but the structural template is genuinely rich on its own
(names, location, arc context). Tying retrieval quality to "the model
emitted a clean structured block this turn" was rejected as too
fragile at narrative-generation temperatures.

### Q3: Heuristic prose extract

Sentence-level signal-density extraction from the last narrative
entry. Avoids embedding 400-1000 tokens of filler-heavy prose;
isolates the high-signal slices.

Per-sentence scoring:

| Signal                                                                                                         | Weight |
| -------------------------------------------------------------------------------------------------------------- | ------ |
| Named-entity hit (matches entity-name index)                                                                   | High   |
| Lore-keyword hit (matches `lore.keywords` index)                                                               | High   |
| Action-verb hit (drew, struck, said, killed, swore, revealed, named, refused, agreed, ran, fled, found, lost…) | Medium |
| Dialogue (quoted span)                                                                                         | Medium |
| Brevity bonus (short impactful sentences)                                                                      | Low    |

Top-K sentences (K=3-5) concatenated, embedded as one vector. Reuses
the entity-name and lore-keyword indexes already built for the
[hybrid retrieval](#hybrid-retrieval-per-type) pathway.

What this catches that pure structural digest misses: terminology in
dialogue, action cues, references the digest's structural fields
don't carry. What it still misses: pure thematic / emotional signal,
pronoun-mediated reference (genuinely needs an LLM-emitted digest or
coreference resolution; not chased in v1).

### Blending — weighted average

Each candidate scores against each query vector via cosine similarity.
Final score is the weighted average:

```
score(c) = w_action × sim(Q1, c) + w_digest × sim(Q2, c) + w_prose × sim(Q3, c)
```

Default weights (placeholder; user-tunable in advanced settings):

```
w_action = 0.35
w_digest = 0.35
w_prose  = 0.30
```

Weighted average over `max` because `max` lets a single strong signal
dominate, which is recall-favoring but noisy. Weighted average is the
consensus shape. Hybrid (`α × max + (1-α) × weighted_avg`) is reserved
for if real testing surfaces over-conservative retrieval.

### Cold start

Turn 1 has no prior user action AND no prior AI entry to embed
against. Fall back to:

- Q1: user's first action (available; retrieval runs after Pre).
- Q2: wizard-derived structural digest. No piggyback summary line yet.
- Q3: heuristic prose extract from the **opening** entry.

When a component is missing, weights re-normalize across the remaining
queries. No special cold-start logic beyond that.

---

## Candidate pools

The retrieval pool per type after the structural floor is satisfied.

### Structural floor — always inject

| Source                         | Notes                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt buffer                  | Partial mode: last `partialChapterBuffer` entries of current chapter. Full mode: entire current chapter. Both modes: previous-chapter spillover to satisfy `protectedBuffer` floor. See [`cadence.md → User-tunable knobs`](./cadence.md#user-tunable-knobs) |
| Active + in-scene entities     | `entities.status='active' AND id ∈ sceneEntities` — short-circuits `injection_mode`                                                                                                                                                                          |
| Current location entity        | `currentLocationId` — same short-circuit                                                                                                                                                                                                                     |
| Active threads                 | `threads.status='active'` — must-inject as structural framing                                                                                                                                                                                                |
| `injection_mode='always'` rows | Across entities / lore / threads — user-intent override                                                                                                                                                                                                      |

### Chapter summaries pool

Closed `chapters` rows form a separate retrieval pool. Each chapter's
`summary` (plus `theme` and `keywords`) is the ranking content; the
pool is small (one row per closed chapter) and grows linearly with
story length.

A matched chapter — one that survives MMR + budget-fill and ends up
injected — is also used as a structural cue to boost happenings
within its range (see
[Chapter-match boost on happenings](#chapter-match-boost-on-happenings)).

**Why chapter summaries are real signal that happenings + lore don't
already cover:** chapter summaries are the **mid-level** "what was
this chapter ABOUT" layer. Happenings are atomic events; lore is
timeless reference. Neither captures meta-narrative — "Aria's arc in
this chapter shifted from solo journey to political conspirator" —
which is what a chapter summary expresses. When budget is tight on
long stories, one chapter summary at ~100 tokens covers ground that
5-10 happenings would take ~400 tokens to convey. Compression ratio
matters.

**Cold start:** pool is empty until the first chapter closes. Budget
allocated to chapter summaries goes unused (hard partitions; no
spillover). Acceptable.

### Three-sub-pool entity model

The retrieval pool for entities splits by status:

| Sub-pool             | Framing in prompt                                                        |
| -------------------- | ------------------------------------------------------------------------ |
| **Active off-scene** | "Currently elsewhere; available for retrieval reference"                 |
| **Staged**           | "Available to introduce when narratively appropriate"                    |
| **Retired**          | Default-excluded; opt-in via `injection_mode='always'` for ghosts/echoes |

All three compete for the entity-type token budget. Embedding
similarity to the current scene digest determines which staged
entities float up — a wizard-curated character "the queen who rules
the throne room" auto-surfaces when the scene digest mentions the
throne room.

### Pool exclusions

- **Common-knowledge happenings** with `common_knowledge=1` skip the
  awareness graph entirely; ranked directly off `sim_blend + kw_boost`
  (see
  [Common-knowledge happenings — special case](#common-knowledge-happenings--special-case)).
- **Pending / resolved / failed threads** join the ranker pool subject
  to `injection_mode`.
- **Same-name suppression** — staged entities whose names appear in
  recent un-classified buffer prose are suppressed from the current
  pool (see
  [`edge-cases.md → Name collision`](./edge-cases.md#name-collision-and-disambiguation)).

---

## Hybrid retrieval per type

Embedding similarity is the primary signal but not the only one.
Different types benefit from different signal blends.

| Type                  | Primary                         | Complement                                                                               |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| **Lore**              | Embedding (title + body)        | Keyword on `lore.keywords` — proper nouns, in-world terminology                          |
| **Entities**          | Embedding (name + description)  | Keyword on `name` — direct prose reference                                               |
| **Happenings**        | Embedding (title + description) | Keyword on `awareness.source` strings — verbatim names / places in awareness descriptors |
| **Threads**           | Embedding (title + description) | None                                                                                     |
| **Chapter summaries** | Embedding (summary + theme)     | Keyword on `chapters.keywords` — chapter-level browse keywords (Phase 2 output)          |

For lore particularly, the keyword pathway is load-bearing — embedding
models have no semantic prior on user-authored proper nouns
("Vael" / "the Aetherium" / "blood-bound"). Keyword matching catches
exact lexical hits that embeddings miss; embeddings catch thematic /
conceptual matches that keyword can't (synonym, paraphrase). Together
they cover.

### Keywords schema

| Type         | Keyword surface                   | Source                                                                  |
| ------------ | --------------------------------- | ----------------------------------------------------------------------- |
| `lore`       | `keywords TEXT` (JSON `string[]`) | User-authored at create time, OR lore-mgmt agent emits at chapter close |
| `entities`   | `name` field                      | Implicit                                                                |
| `happenings` | `awareness.source` strings        | Implicit (per-row, not per-happening)                                   |
| `threads`    | (none)                            | —                                                                       |

Lore's `keywords` field is added; `lore.tags` stays separate (tags are
user-meaningful labels; keywords are retrieval-targeted strings).

### `auto` injection mode

`injection_mode='keyword_llm'` is renamed to `'auto'` across entities,
lore, and threads. The `_llm` suffix was misleading once retrieval
became keyword + embedding (LLM is fallback only, not primary). `auto`
honestly describes the user contract: the system handles it via
whatever signals are available (keyword + embedding + LLM fallback
when both miss). Implementation can evolve without changing
user-facing semantics.

Schema migration: rename enum value across data-model and any code
references; UI copy updates accordingly.

---

## Pinning — `decay_resistance`

The "load-bearing despite dissimilar" signal that semantic similarity
will miss. Lives on awareness rows (and on common-knowledge
happenings) as an auxiliary attribute.

### Pinning schema

```
happening_awareness {
  ... existing fields ...
  decay_resistance REAL DEFAULT 0   -- ∈ `[0, 1]`; scales decay rate
}
```

`decay_resistance = 0` means full decay (today's behavior). `1` means
no decay (effectively a hard pin). Fractional values for
"mostly persistent."

### Why on awareness only

Awareness is per-character; severity / importance is naturally
per-character ("Aria's mother died" is severity-95 to Aria, severity-10
to a stranger who heard rumors). Storing on `happening_awareness` lets
the per-character variance survive into retrieval ranking, which is
itself per-character via POV-awareness.

Common-knowledge happenings (`common_knowledge=1`) skip the awareness
graph entirely and **don't carry a `decay_resistance` signal**.
They're already pinned by being common knowledge — adding a per-row
pin would be redundant. The ranker scores them by relevance only
(see
[Common-knowledge happenings — special case](#common-knowledge-happenings--special-case)).
Trade-off: user can't force-pin a load-bearing common-knowledge
happening that's consistently semantically dissimilar to scenes. v1
floor; rare in practice.

### Sources

| Source                                | Cadence                    | Signal                                                                                                                                                                     |
| ------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User explicit toggle**              | Any time                   | UI affordance on awareness rows in Plot / World panels. Sets `decay_resistance = 1`. Permanent until user toggles off.                                                     |
| **Classifier severity at extraction** | Periodic classifier writes | When emitting an awareness row, classifier judges severity ∈ `[0, 1]` from prose context. Subjective, model-judged. Becomes the default `decay_resistance` on the new row. |
| **Lore-mgmt housekeeping**            | Chapter close              | Reviews closed-chapter awareness rows; can adjust `decay_resistance` upward (recognized structural) or downward (turned out incidental). Conservative bias.                |

### Ranker semantics

The ranker uses `decay_resistance` to bias the budget queue: pinned
items get **preferred slots in the budget queue, ranked by recency
among themselves**, with the embedding-similarity-ranked tail filling
remaining budget. Pinned items do **not bypass the budget** — long
stories with hundreds of pinned rows still fall to budget pressure,
oldest-pinned-first. Absolute always-inject would break on long
stories.

Decay model: salience decays per chapter, scaled by
`(1 - decay_resistance)`. Exact math at the
[ranker scoring function](#scoring-function).

### What doesn't drive `decay_resistance`

- **In-prose recall reinforcement** — the idea that "the model wrote
  about this happening, so it must be important; bump the pin" — was
  rejected as a positive feedback loop. Pinned items get retrieved
  more, prose references them more, pin grows, monopolizes budget. No
  clean cap. Dropped.
- **Common-knowledge auto-emission by classifier** — was rejected as
  too risky. "Is this widely known" requires social-spread reasoning
  the prose doesn't reliably encode. `common_knowledge` stays
  user-only; classifier never auto-emits.

### Pin contradiction reconciliation

A `death` event auto-pinned at chapter 3 becomes obsolete when chapter
25 reveals "actually alive." Auto-detection of contradicting evidence
is parked for v1 — accept the cost (some stale-pin retrieval noise);
user can manually un-pin. Lore-mgmt eventually catches the most
egregious cases at chapter close.

---

## Per-type retrieval budgets

Token budget split across candidate types is user-configurable per
story. Gives explicit control over context allocation.

### Additive UI

User adjusts individual sliders for each type's allocation; the total
emerges as the sum. **No "set total budget, then assign percentages"
gymnastics** — sliders show absolute token counts, total appears
beneath them.

```
Entities:    [====      ]  1200 tokens
Lore:        [======    ]  1800 tokens
Happenings:  [=====     ]  1500 tokens
Threads:     [==        ]   400 tokens
                          ─────
Total:                    4900 tokens
```

The user feels the cost directly per type. Tuning is "I want more
lore in retrieval; drag the slider up" — not "I want lore at 35% of
an abstract whole."

### Hard partitions in v1

Unused tokens within a type's allocation stay empty. No cross-type
spillover. Trade: predictable behavior over slightly-better window
utilization. Spillover is post-v1; the schema supports adding it later
without breaking changes.

### Structural floor takes budget first

The numbers in per-type budgets apply to **what's left after the
structural floor seats**. Recent buffer + active+in-scene entities +
their location + active threads consume tokens unconditionally. Then
prompt-overhead reservation. Then the per-type retrieval budgets
allocate the remainder.

UI shows allocations as **"of remaining ~X tokens after structural
inject"**, not "of full window." Cast-heavy scenes shrink the
available pool dramatically; misleading the user about the relative
cost would let them paint into a corner.

### POV-awareness scope

Retrieval queries the awareness graph as the **union of all in-scene
characters' awareness rows** in both adventure and creative modes:

```sql
SELECT * FROM happening_awareness
WHERE character_id IN ({sceneEntities ∩ characters})
```

Lead-only filtering was considered for adventure mode and rejected.
Characters can feasibly acquire knowledge without the protagonist
present (detached-POV moments), and the `narration` setting
(`first | second | third`) is the lever for POV-constraint via
prompt, not retrieval. The risk of leakage (AI mentions things the
protagonist shouldn't know) is bounded by narration-mediated
prompting; the schema supports tightening to lead-only later if
real-world testing shows persistent leakage.

---

## The ranker

The ranker turns per-type candidate pools into the actual injected
slice for each turn. **Inputs** are settled per the rest of this doc:
three query vectors with weighted-average blending, per-type candidate
pools with the three-sub-pool entity model, per-type token budgets
(additive sliders, hard partitions in v1), and per-row signals
(`decay_resistance` on awareness, `priority` on lore, recency
markers, `injection_mode='always'` overrides).

Independent ranker pass per type. Per-type budgets are hard
partitions, so types don't compete with each other; each type's
ranker fills its own slice.

### Scoring function

Per-candidate score combines four signals — multiplicative
integration for similarity × recency × pin, additive for the
keyword complement, with a high-similarity bypass for revival of
deeply-decayed rows:

```
score(c) = max(
    sim_blend(c) × recency_factor(c) + kw_boost(c),
    (sim_blend(c) − τ_revive) if sim_blend(c) ≥ τ_revive else 0
)

recency_factor(c) = exp(−λ_type × chapters_old(c) × (1 − pin_signal(c)))
```

Where:

- **`sim_blend(c)`** — weighted-avg of cosine similarities between `c`
  and each of the three query vectors (action / structural digest /
  prose extract). Already computed in the
  [query stack](#query-construction--three-vector-stack).
- **`pin_signal(c)`** — `decay_resistance` for awareness rows,
  `priority/100` for lore, `0` for entities and threads (no
  continuous pin signal in v1).
- **`λ_type`** — type-specific decay rate (table below).
- **`chapters_old(c)`** — chapters since `c` became relevant
  (`learned_at_entry` for awareness, `created_at` mapped to chapter
  for happenings without awareness, `updated_at` for entities and
  threads, effectively zero for lore since lore is timeless).
- **`kw_boost(c)`** — additive bonus when the keyword index hits
  (lore keywords, entity name, awareness `source` string). Default
  magnitude `0.10`. Zero if no keyword pathway exists for the type.

The multiplicative pin-into-recency integration is the key shape:

- `pin_signal = 1` flat-tops decay (item maintains full `sim_blend`
  forever).
- `pin_signal = 0` decays normally.
- Fractional values for "mostly persistent."

Pinned items naturally float higher in the ranker without a separate
tier; budget pressure still drops them when oversubscribed (see
[Budget-fill termination](#budget-fill-termination)). The
"long story with hundreds of pins" failure mode handles itself —
pins compete on similarity to current scene, only the
diverse-and-relevant ones survive MMR + budget.

### High-similarity bypass — revival of decayed memories

The decay model handles ageing well but creates a structural gap on
long-arc stories: a chapter-3 happening with `dr = 0.3` at chapter
60 has `recency_factor ≈ 0.06` even at perfect `sim_blend = 1.0`,
falling below the noise floor. Without intervention, decayed
memories are invisible to retrieval — they can never resurface even
when extremely relevant to the current scene.

The bypass term in the scoring function fixes this:

```
bypass_score(c) = sim_blend(c) − τ_revive   when sim_blend(c) ≥ τ_revive
                  0                          otherwise
```

A candidate whose embedding similarity to the current scene exceeds
`τ_revive` (default 0.85, tunable) gets a score floor of
`sim_blend - τ_revive`, ignoring the recency-and-pin decay. Old
rows that perfectly match a callback scene resurface; old rows
that match weakly or generically don't.

The semantics: "if this old thing matches the current scene that
closely, it's probably a real callback — surface it regardless of
age." Conservative threshold (0.85+) limits false positives from
generic prose-similarity matches.

**Interaction with other mechanisms:**

- **Retrieval-frequency tracking** still applies. Bypass-revived
  rows participate in the counter; if they keep getting revived
  turn after turn, they show up in
  [phase 3d's high-frequency candidate set](./chapter-close.md#3d--awareness-pin-tuning)
  at next chapter close, where lore-mgmt can promote them to higher
  `decay_resistance` (or leave alone if marginal). Self-correcting.
- **Budget pressure** still gates inclusion. Revival doesn't
  bypass the budget; it only bypasses the score-threshold floor.
  An old row that bypasses can still lose to recent rows that
  out-score it within the budget.
- **MMR diversity** still applies. Multiple bypass-revived rows
  that semantically cluster will dedup against each other.

The risk — false-positive revivals where high embedding similarity
isn't load-bearing narrative connection — is bounded by `τ_revive`
height, by budget pressure, and by the lore-mgmt review path.
Worst residual case: user notices via
[memory probe](./probe.md) that a row is being revived
spuriously and manually unpins or demotes via World panel.

### Chapter-match boost on happenings

When chapter summaries survive their own ranking pass and end up
injected, their content is contextually relevant — and the
happenings that occurred within those chapters' ranges inherit some
of that relevance. The happenings ranker applies a multiplier to
such candidates:

```
chapter_boost(h, matched_chapters) =
  if any(ch.range contains h.occurred_at_entry for ch in matched_chapters):
    1.3   # tunable; default range 1.2-1.5
  else:
    1.0

score(h) = (sim_blend × recency_factor + kw_boost) × chapter_boost(h, matched_chapters)
```

`matched_chapters` is the set of chapters that survived the
chapter-summary pool's MMR + budget-fill — actually injected, not
just ranked highly. The boost only fires for chapters whose content
the prompt will actually carry context about.

**Pipeline impact** — chapter-summary ranking must complete before
happenings ranking starts so `matched_chapters` is known. Other
types (entities, lore, threads) run independently in parallel.

**Why this matters.** Without the boost, happening retrieval is
"scattered" — top-K by similarity across the entire story, often
disconnected. With the boost, top-K tends to cluster around the
chapters most relevant right now: a more narratively coherent slice
of context for the LLM.

### Scale assumptions

Pool sizes grow substantially with story length. Realistic projection
for a story at `chapterTokenThreshold = 24k`, ~500 tokens/turn
(~48 turns/chapter), and 1-2 happenings extracted per turn:

| Metric                                                   | Per chapter | At 30 chapters | At 60 chapters |
| -------------------------------------------------------- | ----------- | -------------- | -------------- |
| Happenings                                               | 50-100      | 1.5-3k         | 3-6k           |
| Awareness rows (5-10× happenings depending on cast size) | 250-1000    | 7.5-30k        | 15-60k         |
| Embedding storage (~1.5KB per happening)                 | ~100-150KB  | ~3-5MB         | ~5-10MB        |

The decay-rate defaults below are **guesses calibrated for these
volumes** — calibrated in the sense of "λ=0.07 produces sensible-
looking ranking on toy data," not "λ=0.07 has been validated against
real stories." Real testing on real stories will move these numbers,
possibly by 2× or more in either direction. v1 ships these
starting points exposed for power-user override in advanced
settings; empirical calibration happens organically once test
stories surface real ranking-quality signal.

Architecturally, these volumes drove several choices we already
made: pre-filter to top-200 before MMR (otherwise ranking thousands
of candidates per turn gets expensive), per-type hard-partitioned
budgets (otherwise happenings drown out lore), and chapter-match
boost on happenings (otherwise top-K from thousands of candidates is
scattered rather than coherent).

### Per-type decay rates

Sensible starting defaults; tunable per story in advanced settings:

| Type                   | `λ`          | `recency_factor = 0.5` at | Rationale                                                                     |
| ---------------------- | ------------ | ------------------------- | ----------------------------------------------------------------------------- |
| Happenings (awareness) | 0.07         | ~10 chapters              | Events get stale, but not as fast as a 5-chapter half-life would imply        |
| Entities (off-scene)   | 0.025        | ~28 chapters              | Cast turnover is slow                                                         |
| Threads                | 0.025        | ~28 chapters              | Arc presence is slow                                                          |
| Lore                   | 0 (no decay) | —                         | Effectively timeless; ranks purely on `sim_blend × (priority/100) + kw_boost` |
| Chapter summaries      | 0 (no decay) | —                         | Mid-level historical record; ranks purely on `sim_blend + kw_boost`           |

Lore and chapter summaries don't decay — they're inherently long-arc
content. Lore is timeless reference; chapter summaries are factual
records of "what happened in chapter X." Both rank purely on
relevance to the current scene.

These defaults are starting guesses; the empirical-tuning followup
calibrates them against real story data.

### Common-knowledge happenings — special case

Common-knowledge happenings (`happenings.common_knowledge=1`) bypass
the awareness graph entirely; no awareness rows exist for them. They
score by:

```
score(c) = sim_blend(c) + kw_boost(c)
```

No recency decay, no pin signal. They're pinned by being common
knowledge; rank purely on relevance to current scene. If a
common-knowledge happening becomes irrelevant to current scene
context, it ranks low and falls out of budget naturally; if relevant,
it always gets considered for injection.

The small gap: a load-bearing common-knowledge happening that's
consistently semantically dissimilar to relevant scenes can't be
force-injected by the user (no `injection_mode` on happenings, no
`decay_resistance` per the simplification). v1 floor; rare in
practice. If real signal shows it bites, extend `injection_mode` to
happenings or add a `decay_resistance` column.

### Diversity — MMR

Pure top-K by raw score surfaces near-duplicate clusters (three
similar awareness rows about Aria's grief crowd out orthogonal
signals). Maximal Marginal Relevance penalizes redundancy:

```
mmr_score(c, S) = λ_div × score(c) − (1 − λ_div) × max(sim(c, c') for c' in S)
```

Where:

- `S` is the already-selected set (initially empty; `max(...)` is `0`).
- `sim(c, c')` is embedding similarity between candidates.
- `λ_div = 0.75` default — strong relevance preference, mild
  diversity. Tunable.

Iteratively pick the candidate with highest `mmr_score`, add to `S`,
recompute, pick next.

**Per-type MMR.** Diversity runs independently within each candidate
type. A happening shouldn't dedup against a lore entry; they're
different shapes carrying orthogonal signal.

**Cost.** O(N × K) per type. For typical pools (hundreds), sub-
millisecond. For long-running stories with thousands of awareness
rows, **pre-filter to top-200 by raw score before MMR**. Trade:
candidates ranking ~200th by raw score are unlikely to make it into
the budget anyway, so the pre-filter doesn't lose meaningful
selections.

### Budget-fill termination

Greedy fill within the per-type budget after MMR ranking:

```python
selected = []
remaining = type_budget

for c, mmr_score in mmr_ranked_candidates:
    if mmr_score < min_score_threshold:
        break              # entered noise territory; stop
    cost = token_estimate(c)
    if cost > remaining:
        continue           # too large for what's left; try smaller candidates
    selected.append(c)
    remaining -= cost

return selected
```

**Edge cases:**

- **Candidate larger than remaining budget** — skip and try next.
  Don't truncate (truncated candidates are noise).
- **Candidate larger than the entire type budget** — skip permanently.
  Surface in Story Settings as a warning ("your happenings budget is
  below the median happening size; consider raising it").
- **`min_score_threshold = 0.15`** (cosine baseline) — rows below
  this are essentially semantically unrelated to current scene;
  including them clutters the prompt with noise. Underutilized budget
  is fine; we don't backfill with low-relevance content.

No "must-fill-budget" mode. The user's expectation is "good context
or no context, not bad context."

### Token estimation

Tiktoken-based, computed at ranker time:

```
token_count(c) = tiktoken(c.rendered_field_text) + type_overhead(type_of(c))
```

Per-type overhead is a small constant for the Liquid macro / block
wrapping (entity character_block ≈ 30 tokens, lore block ≈ 10 tokens,
happening memory block ≈ 20 tokens, thread block ≈ 10 tokens).
Measured empirically once the macros are concrete; constant in code
thereafter.

**No stored column on candidate tables.** Tokenization is fast enough
(microseconds per row); per-turn cost is sub-millisecond total.
Ranker passes cache results in memory for reuse within the turn.

If real perf testing later shows tokenization is a bottleneck, add a
`token_count INTEGER` column per candidate table with cache
invalidation on row update. Don't pre-optimize.

### Per-turn cost budget

Dominant terms:

| Step                                        | Cost                                               |
| ------------------------------------------- | -------------------------------------------------- |
| Embedding three query vectors               | ~20ms local / ~50ms API (parallelized)             |
| Cosine similarity batch over candidate pool | <10ms for 1000s of candidates with vectorized math |
| MMR per type (after pre-filter to 200)      | <5ms per type                                      |
| Token estimation                            | <1ms total                                         |
| Budget fill                                 | <1ms                                               |

Target: <100ms total for typical stories on local embedder. Acceptable
even for the longest typical pools.

### Pseudocode

```python
def rank_per_type(candidates, queries, type_budget, λ_type, type_overhead, *, matched_chapters=None):
    # 1. Compute raw score per candidate
    scored = []
    for c in candidates:
        sim = blend_similarity(c, queries)
        kw  = keyword_boost(c, queries)
        if c.kind == 'happening' and c.common_knowledge:
            score = sim + kw
        else:
            pin = pin_signal(c)
            rec = exp(-λ_type * c.chapters_old * (1 - pin)) if λ_type > 0 else 1.0
            score = sim * rec + kw

        # High-similarity bypass — revival of decayed memories
        if sim >= τ_revive:
            score = max(score, sim - τ_revive)

        # Chapter-match boost on happenings
        if c.kind == 'happening' and matched_chapters:
            if any(ch.contains(c.occurred_at_entry) for ch in matched_chapters):
                score *= 1.3

        scored.append((c, score))

    # 2. Pre-filter for MMR efficiency on large pools
    if len(scored) > 200:
        scored = top_n_by_score(scored, 200)

    # 3. MMR-rank
    mmr_ranked = mmr(scored, λ_div=0.75)

    # 4. Greedy budget fill
    selected = []
    remaining = type_budget
    for c, mmr_score in mmr_ranked:
        if mmr_score < 0.15:
            break
        cost = tiktoken(c.rendered_text) + type_overhead
        if cost > remaining:
            continue
        selected.append(c)
        remaining -= cost

    return selected

def rank_all(pools, queries, budgets, type_config):
    # Chapters first — small pool, ranks fast, output feeds happenings
    matched_chapters = rank_per_type(
        pools['chapters'], queries, budgets['chapters'],
        type_config['chapters'].λ, type_config['chapters'].overhead
    )

    # Happenings depend on matched_chapters (chapter-match boost)
    happenings = rank_per_type(
        pools['happenings'], queries, budgets['happenings'],
        type_config['happenings'].λ, type_config['happenings'].overhead,
        matched_chapters=matched_chapters
    )

    # Other types run independently — no inter-type dependencies
    others = {
        type: rank_per_type(
            pools[type], queries, budgets[type],
            type_config[type].λ, type_config[type].overhead
        )
        for type in ('entities', 'lore', 'threads')
    }

    return {**others, 'chapters': matched_chapters, 'happenings': happenings}
```

### Tuning surface

Defaults are conservative; expose for power-user override in App
Settings → Memory → Advanced:

- Per-type `λ` decay rates.
- `λ_div` MMR diversity vs. relevance.
- `kw_boost` magnitude.
- `min_score_threshold` noise floor.
- `τ_revive` high-similarity bypass threshold (default 0.85;
  controls when decayed-but-extremely-similar rows resurface).
- Per-query weights (`w_action`, `w_digest`, `w_prose`) — already in
  the [query stack](#query-construction--three-vector-stack).

Real signal from testing tunes these. v1 ships with defaults;
empirical calibration happens once test stories surface real
ranking-quality signal.
