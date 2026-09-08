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

**Physical storage — per-`(type, dim)` `vec0` virtual tables.** A
`vec0` vector column is fixed-dimension at CREATE time (verified
against sqlite-vec v0.1.9 — inserting a vector of any other
dimension is rejected), so a single per-type table cannot hold rows
produced by models with different dims. Production therefore uses
one [`sqlite-vec`](https://github.com/asg017/sqlite-vec) `vec0`
virtual table per (target kind, dimension) pair, named with a dim
suffix: `entities_vec_384`, `lore_vec_768`, and so on. Prose
elsewhere refers to a family by its bare name (`entities_vec`); the
physical table is always dim-suffixed. Each table carries
`pk TEXT PRIMARY KEY` (the `<branch_id>:<id>:<model_id>` composite —
vec0 enforces primary keys globally across partitions, and phase-1
swap staging inserts a NEW-model row next to the OLD-model row for
the same source row, so identity must carry the model too, not just
branch and row; deletes always go by the real columns, never by pk
string, which keeps pre-widen rows forward-compatible), `branch_id`
as a TEXT partition key, `model_id` and `id` as TEXT metadata columns
(`id` joins to the source row), `source_hash` as a TEXT auxiliary
column, and the vector column at the family's dim. There is no
per-row dim column — the dimension is
encoded in the table name. The base migration creates the five
384-dim tables (the bundled default model's dim); any other dim's
family is created lazily by the vec0 write helper via
`CREATE VIRTUAL TABLE IF NOT EXISTS`, ensured outside the atomic
write batch (idempotent, so a crash between DDL and insert is
harmless). A retrieval pass resolves branch → model → dim → exactly
one table per type, so no KNN ever spans tables. The polymorphic
schema above is the logical view; vec0 doesn't filter efficiently
across mixed-type rows, so the per-type split is the production
shape, and the fixed-dim constraint adds the per-dim split.
Validated in PoC; per-query KNN at ~11 / 43 / 61 / 122 ms at
1k / 10k / 50k / 100k rows on a flagship Android device.

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
the embedded fields at embed time. The input is the row's
**composite text**: the type's embedded fields in their declared
order, each `null` coerced to the empty string, joined by a **single
space** — and the very same string is what the embedder receives, so
the hash and the vector can never describe different bytes. The hash
is xxh32 over the UTF-8 bytes of that string, seed 0, rendered as
eight lowercase hex characters (`lib/db/embeddings/source-hash.ts`).
A NUL separator was considered and rejected: it would make field
boundaries visible to the embedder only at the cost of a control
character on every provider request, and changing the join in either
role forces a full re-index. Per the
[Compute lifecycle](#compute-lifecycle) contract the hash is the
reference for the per-row `embedding_stale` flip: an embedded-field
write recomputes the row's hash and compares against it to set or
clear the dirty flag.

The two are not redundant, and they differ in cardinality.
`embedding_stale` is one boolean on the source row, answering "does
this row need embedding into the current model". `source_hash` is one
value per stored vector, keyed by row and model, answering "which
text produced this particular vector". That second question is what
makes a cancelled cross-model swap resumable: the flag cannot say
which rows were already staged into the target family, because the
swap has been flipping it, so recovery compares the source family's
stored hashes against current content instead.

Drift is the flag's job, not the hash's. The rule is that every
writer touching an embedded field flips `embedding_stale`, so there
is deliberately **no** retrieval-time hash comparison — adding one
would mean hashing every candidate's composite text on every turn to
re-derive what the flag already carries.

The rule is enforcement, not convention, as of Slice 3.12a: the
register actions default the flag to `1` on create — a row with no
vector is dirty by definition — and derive the flip on update by
comparing each embedded column against the pre-update row, so
writing an embedded field sets the flag whether or not the caller
remembers. `KIND_FIELDS` is the single source of truth for which
columns those are: the same constant builds the embed `SELECT` and
types each entry against its own row, so a column that is not
genuinely embedded cannot be listed and an embedded one cannot be
silently omitted. That enforcement is what justifies having no
tripwire behind it. One writer still stands outside it —
reverse-replay restores prior column values without re-deriving the
flag — which is why it must flip `embedding_stale` by the same
per-row checksum rather than inheriting whatever the pre-reversal
row carried. Hash is chosen over timestamps because
rollback restores prior `updated_at` along with the rest of the
row's state — a timestamp-based check would invert post-rollback and
silently mask the bug it was meant to catch. Content hashes are
timeline-direction-agnostic. Embeddings themselves are not
delta-logged (deterministic from source); the
[`embedding_stale`](#compute-lifecycle) flag carries the dirty state
the sync stage acts on.

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

**Sync-before-read contract.** vec0 is guaranteed consistent with
source content at every retrieval — not after every write. An
embedded-field write (classifier emit, chapter-close summary,
user-edit of a description, rollback restoring prior content) does
**not** embed inline; it writes the metadata row and sets the source
row's `embedding_stale` flag. A dedicated **pre-retrieval sync
stage** then embeds every dirty row (`embedding_stale = 1`) in one
batch immediately before retrieval — at the head of any pipeline
that retrieves, alongside the query-embed step that already runs
there — and KNN runs against a fresh index.

The invariant is **"no KNN without a preceding sync,"** honoured by
every vec0 reader:

- **Per-turn pipeline retrieval** — the sync stage is part of the
  pipeline, just before the retrieval phase (which already runs
  after Pre commits the user-action delta).
- **Memory probe**, _if_ it offers current-state retrieval rather
  than replaying a captured historical run — spawns the same sync
  stage on demand before its KNN (probe reader-model is still open;
  see
  [`memory-probe.md`](../ui/screens/memory-probe/memory-probe.md)).

Between retrievals vec0 may lag the live rows. That is deliberate
and harmless: nothing reads it without first running the sync stage.
The one trade — a future _ad-hoc_ KNN reader outside a pipeline (a
"search my world" action, an entity-sheet "related" hover) pays the
sync latency before results rather than reading an always-fresh
index — is acceptable for today's readers; revisit if instant-feel
ad-hoc KNN lands.

**Dirty detection is a flag, not a scan.** `embedding_stale` lives
on the source row (entities, lore, happenings, threads, chapters),
so the dirty set is `WHERE embedding_stale = 1` behind a partial
index — no content-hash sweep across the corpus. The flag is flipped
per-row, only on the rows a write or reversal touches: recompute
that row's content hash and compare to the embedding's stored
`source_hash` — set the flag to 1 when they differ, back to 0 when
they match. One rule covers every transition: a create has no
matching vector so it flags dirty; an edit that drifts the content
flags dirty; an edit or rollback that returns content to its
embedded value **revalidates to 0 with no re-embed**, since the
existing vector is still correct. Row deletion cascade-removes the
orphaned vec0 entry (the flag is on the row; when the row goes, so
does its embedding).

The asymmetry this answers: vec0 KNN returns only rows present in
vec0, so a net-new or drifted row invisible at retrieval time
silently mis-ranks or drops candidates. Embedding before the read
satisfies this just as embedding on the write would — the row is
indexed before any KNN — but pays once, at the read. What makes
deferral the right trade is any operation that mutates embedded rows
yet is _not itself a retrieval_: swipe-switching between alternate
takes, rollback, repeated edits. Embedding on every such write is
waste, since only the state live at the next retrieval matters;
deferring collapses it to a single embed of whatever survives.

**Reverse-replay stays embed-free.** Rollback / CTRL-Z /
crash-recovery restore rows through raw delta reversal and never
call the embedder — they write rows, flip `embedding_stale` by the
same per-row checksum, and cascade-delete embeddings for rows they
delete. Re-embedding is the next sync stage's job. (An
embed-on-write contract would have forced reverse-replay through the
embed path for every restored row.)

**`embedding_stale` is one flag, one meaning: "needs embed."** It
covers ordinary deferred writes, creates, and failures alike — a
dirty row stays flagged until a sync stage successfully embeds it,
and a failed embed (init failed, provider down, EP crashed) simply
leaves it flagged and absent from vec0. There is no separate
"drifted vs failed" state.

**Embed failure is blocking, not "queue and continue."** When the
pre-retrieval sync stage can't embed a dirty row, the turn can't
reach retrieval. Treated identically to a failed LLM call: surfaced
as an error, must be resolved, no ignore path. The user picks Switch
embedder / Retry / Dismiss. There is no rollback action — the
orchestrator has already reverse-replayed the turn by the time the
error surfaces — and the composer is not gated, because a resubmit
re-runs this same blocking sync stage, so a still-broken embedder
fails the turn again. The block is self-enforcing. See
[`model-management.md → Embedder failures`](./model-management.md#embedder-failures)
for the action surface and the wider failure-mode discussion.

A worker drains dirty rows opportunistically between turns when
conditions allow, so a later sync stage finds less to do — a
warm-cache optimization, not an "ignore the error and let the worker
fix it later" license. The blocking sync stage prevents the ignore
path.

**Retrieval excludes stale rows.** A row still `embedding_stale = 1`
_at retrieval_ — one the sync stage just failed to embed — isn't in
vec0 and doesn't surface as a KNN candidate. Better known-absent
than silently-wrong. (Pre-sync, the flag is the normal dirty state
and says nothing about retrieval; the sync stage clears every
embeddable row first, so anything still flagged at KNN is a genuine
failure.)

**Per-turn cost.** Retrieval pays the embed cost for rows dirtied
since the last sync — for an ordinary turn, the handful the previous
reply created or changed — plus one embed per live query. No per-write
embed latency; the cost is batched at the sync stage.

- **Pre-retrieval sync stage:** embed the dirty source rows, then
  clear their flags. Local mode warm CPU ~10–30 ms per row; provider
  mode ~100–300 ms per network round-trip (batchable across rows in
  one transaction). A normal turn is a few rows; a swipe selection or
  rollback can dirty more.
- **Query embeds:** embed the live queries (user action, structural
  digest, piggyback summary, classifier-emitted); see
  [Query construction](#query-construction--the-query-stack).
  Short text; <20 ms local warm, <100 ms API.
- **Cache:** keyed by `(target_kind, target_id, field, model_id)`.
  If the source field and model are unchanged, reuse — the
  `source_hash` revalidation above is the per-row expression of this.

**Bulk import** (loading a story from `.avts` or migrating an old
database) uses the same batched-embed machinery, but as an explicit
up-front phase with progress UI rather than one giant sync at first
retrieval. 100k rows × 10 ms is 16 minutes; batch the embed calls
(especially in provider mode, where each is a network round-trip).
Same path as the model-swap re-index.

**Edit storms** are not a concern: saves are explicit user actions
in the v1 design — no autosave per keystroke — and a save only flips
the flag, deferring the single embed to the next sync.

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
  **Read that three-embed total as PoC-era.** It predates the
  [variable-length query stack](#query-construction--the-query-stack),
  which embeds one to six queries per pass, and has not been re-run.
  The embedder is excluded from every figure in
  [Per-turn cost budget](#per-turn-cost-budget), so nothing there
  covers it either.
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
  1k / 10k / 50k / 100k candidates. Three queries per pass → total
  retrieval (incl. embed + merge) is ~478 ms at 100k — ~5-8x faster
  than JS-side cosine at large pools, comparable at 1-10k. Slower than
  the published 75 ms@100k benchmark — likely a mix of mobile ARM
  lacking AVX2 SIMD, expo-sqlite bridge overhead, and 3-query vs
  1-query workload.
  **Read this as a per-query unit cost only.** "Three queries per pass"
  is the PoC's single-family shape; the shipped pass issues one KNN per
  live query per family — five families, and
  [one to six live queries](#query-construction--the-query-stack) —
  plus a by-id vector fetch for chapter-admitted rows. The pass total
  lives in [Per-turn cost budget](#per-turn-cost-budget).
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
     A swap may cross backends (a local model to a provider one or
     back), and a model id alone does not say which backend serves it —
     so when the target's backend differs from the story's, the marker
     also records `embedding_swap_backend` and
     `embedding_swap_provider_id`. Absent, they mean "same backend as
     the story", which is what crash recovery assumes for any marker
     written without them.
     The same marker snapshots `embedding_swap_source_dim` and
     `embedding_swap_target_dim`. They distinguish an in-place
     same-model/same-dim re-index from a same-model-id swap staged into
     another vec family. The target dim starts from resolved capability
     data; if the served vector lands at another dimension, the first
     staged batch corrects the marker in that batch's transaction.
  2. **Phase 1 — re-embed non-destructively.** Foreground job
     (re-index runs in the user's view, not a background queue)
     embeds each row under the new model and INSERTs alongside
     existing rows (`model_id = NEW` next to `model_id = OLD`;
     into the NEW dim's table family when the new model's dim
     differs).
     Each row's insert is its own small SQLite write. Old vectors
     stay intact throughout; retrieval keeps working under the
     old model. Vec tables temporarily ~2x size for swap-affected
     rows. Progress indicator: "re-indexing X / N — retrieval
     limited."
  3. **Phase 2 — atomic flip (transaction).** Single SQLite txn:
     - `DELETE FROM *_vec_<old dim> WHERE branch_id IN (...) AND model_id = OLD`
     - `UPDATE stories SET settings = jsonb_set(settings, '$.embedding_model_id', NEW_MODEL_ID)`
       — together with `$.embeddingBackend` and
       `$.embedding_provider_id`, so a cross-backend swap lands a
       coherent trio instead of a provider model recorded under the
       story's old local backend
     - `UPDATE stories SET settings = jsonb_remove(settings, '$.embedding_swap_target')`
       and its backend, provider, source-dim, and target-dim companion
       keys

     Commit. Story is now consistently on NEW.

  **Crash recovery.** On story open, if `embedding_swap_target`
  is set, surface a resume / cancel prompt:
  - **Resume.** If any rows lack a `model_id = NEW` counterpart,
    continue Phase 1 (skip rows that already have one). Then run
    Phase 2.
  - **Cancel.** Delete staged rows from the recorded target family,
    clear every swap-marker key, and keep the story on its recorded
    source family.

  **Cancel during a live swap (not a crash)** follows the same
  Cancel path — partial NEW vectors are deleted, marker cleared.
  One exception is a standalone same-model, same-dim re-index.
  Staging upserts in place there, so the rows a cancel would delete
  are the story's only vectors — it clears the marker without
  deleting anything. Matching model ids at different dimensions are
  not this exception: the target family is disposable staging and
  the source family remains the rollback copy.

  **Which rows a cancel leaves dirty** depends on the direction,
  because `embedding_stale` describes the vector the story is left
  _on_:
  - **Cross-model** — staging cleared the flag on every row it
    embedded under NEW, but the story reverts to OLD, so exactly
    those rows lost a flag that described their OLD vector. Flag the
    staged set (derivable from vec0, so this also covers a
    crash-recovered cancel).
  - **Same-model** — rows re-embedded before the cancel are current;
    the rest still hold the embedding the re-index was asked to
    replace. Flag only that tail. A crash-recovered cancel has no run
    state and a same-model re-embed leaves no trace to recover the
    split from (same `model_id`, and unchanged content hashes to the
    same `source_hash`), so it conservatively queues the whole story.
  - **Same-model, cross-dimension** — use the recorded target family
    to identify the staged set, delete that family only, and recompute
    those rows' flags against hashes in the preserved source family.

  Flagging rows whose vectors are current would both overstate the
  dirty set to the staleness UI and make the drain silently redo work
  the user just stopped.

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
  `embedding_model_id` to the new value without recomputing any
  vectors. `model_id` is part of the vec0 pk and the KNN filter, so
  a pure settings relabel would orphan every stored vector — the
  implementation rewrites vec0 row identity in SQL (pk and
  `model_id` metadata) for the affected rows in the same
  transaction. **Only safe when the user knows the underlying
  model is unchanged** — relabeling a custom import, canonical-id
  refactor, filename rename, quant-suffix change.
  Disclaimer shown that this is the user's assertion; if the new
  id actually points to a different model, retrieval quality
  silently degrades and the system has no way to detect that.
  Instantaneous; no swap-target marker (nothing to crash through).

A standalone "Re-index this story now" button stays available in
the same Story Settings panel for users who want to force a
re-index without changing the model. It uses the same
stage-then-flip flow (target = current model, same crash-recovery
contract).

**The standalone re-index is confirm-gated.** Every other path to a
re-index is reached by deliberate navigation (pick a model, then
choose Re-index from the options pane), while this one is a single
press that costs a full embed pass over the story — provider spend
the user never opted into. The dialog states the row count it will
re-embed, that nothing is deleted, and what cancelling leaves
behind. It reports the count rather than a token or currency
estimate: the row total is exact and free to compute, whereas a cost
figure depends on per-model tokenization the app doesn't model.

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
  embeddingDim?: number,             // native output dimension learned by a probe
  matryoshkaSupported?: boolean,    // NEW
  matryoshkaDims?: number[],        // NEW; curated ladder, e.g. [256, 512, 1024, 1536, 2048, 3072]
}
```

Selecting a provider embedding model in App Settings or the
per-story swap picker runs a native, untruncated probe when
`embeddingDim` is not already cached. A successful probe persists the
positive dimension on that cached model. Provider config resolution
then threads it into the service's dimension guard and derives the
actual storage family as `min(effectiveDim, embeddingDim)` when a
story truncates.

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
   applies to every per-turn query vector so
   query and stored vectors live in the same N-dim space.
3. **vec0 partitioning.** Vectors land in the `*_vec_<dim>` table
   matching the story's effective dim per the [Storage](#storage)
   section — stories at different dims occupy different physical
   tables of the same family, and `branch_id` partitions rows
   within each. Within one branch, all rows share one dim — the
   same single-model invariant extended to dim.
4. **Source hash.** `source_hash` continues to hash content, not
   vectors. Truncation is deterministic from the native vector, so a
   dim change alone never moves the hash — which is what lets swap
   recovery tell a re-embedded row from a merely re-truncated one.

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

## Query construction — the query stack

Each retrieval pass embeds between one and six queries and ranks
candidates against each, blending the per-vector similarities into a
final score per candidate. Only Q1 is structurally always-present —
every other slot derives its own presence, and
[the blend](#blending--weighted-average) re-normalizes across whichever
are live.

### Q1: User action

The user's action text for the current turn. Always available
(retrieval runs after the Pre phase commits the user-action delta).
Short, signal-dense, embeds fast.

### Q2: Structural digest

Code-template floor, structural fields only. **Every line is
conditional** — a line whose fields are all empty is omitted rather
than rendered as bare punctuation:

```
{sceneEntities.names}, {currentLocation.name}.   -- if either is present
Active threads: {activeThreads.titles}.          -- if any
Era: {era_name}.                                 -- if set
```

Structural fields are computed from existing data: deterministic and
free, though not all of them are always populated — see
[Cold start](#cold-start). The piggyback summary was once a fourth line
here; it is now [a query of its own](#q3-piggyback-summary).

**Why conditional rather than fixed.** Under a fixed three-line
template, a story with no cast, no location, no threads and no era
renders Q2 as punctuation only — and that vector still takes a full
`w_digest` share of every candidate's blended similarity, because
nothing marks it absent. Q2's presence flag is therefore derived from
the rendered result rather than hardcoded true, so an empty digest
reports itself absent and
[the blend](#blending--weighted-average) re-normalizes across the
remaining queries. The cost of conditionality is that Q2's text varies
in shape between turns; the cost of the fixed form is `w_digest` spent
on commas.

Q2 is now purely structural, and that is the point: it is deterministic
and free, so it never fails because a model had a bad turn. The
LLM-emitted material it used to carry is isolated in slots that can
report their own absence.

### Q3: Piggyback summary

The one-sentence `metadata.summary` written on the last AI-authored
entry, embedded as its own vector. Both per-turn writers produce it —
piggyback's tagged block directly, the fallback classifier when
piggyback did not fire or its block failed to parse — so it is
available in either mode
([`piggyback.md → Capability gate`](./piggyback.md#capability-gate)).

**Capped at 200 characters, the same cap and the same constant as
[Q4](#q4-classifier-emitted-queries).** Applied at query build, not at parse or
persist: `metadata.summary` is a reader surface and reaches templates as
`sceneMetadata.summary`, so truncating it there would cut what the user reads.
One sentence is the instruction; the cap is what stops a model that writes a
paragraph from getting a paragraph averaged into one vector. It binds on a long
compound sentence as well as on a runaway one — a deliberate trade for a single
shared constant over two that could drift.

**Why it is not part of Q2.** It used to be the digest's last line, one
natural-language sentence averaged into a single vector with a
comma-separated proper-noun list. The two carry different shapes and
different reliability, and the concatenation served neither.

Its own weight, rather than a share of the digest's, follows from the
same split. The digest is deterministic and free; the summary is
LLM-emitted and optional. Were they to share, then on every turn the
model failed to emit a summary the digest would silently inherit its
share and gain influence nobody tuned for. Separate shares keep the
reliability difference visible to the blend.

Absent on parse failure or restart is fine — presence is derived, and
the blend re-normalizes.

### Q4: Classifier-emitted queries

Up to **three** query strings the per-turn classifier emits directly,
each embedded and KNN-queried individually rather than concatenated.
Where Q1 through Q3 are reconstructions of what the turn was about,
these are the model stating what context it wants.

Both implementations of the per-turn contract carry the field: a
`<retrieval_queries>` tag inside piggyback's `<state>` block, and the
matching optional array on the fallback classifier's structured-output
schema. Answering it requires seeing what the turn was already given,
which is why the fallback receives the assembled memory blocks
([`piggyback.md → Fallback classifier context`](./piggyback.md#fallback-classifier-context)).

**Capped at three, and the cap is a cost decision.** KNN is the pass's
largest measured span and it scales in query count: six live queries
take it from fifteen `sqlite-vec` passes to thirty, measured at
~77ms → ~121ms at dim 384 and ~150ms → ~244ms at dim 768. Well under a
doubling, but it is the term the cap exists to bound. See
[Per-turn cost budget](#per-turn-cost-budget).

**Emission contract.** Absent-tolerant and malformed-tolerant. Absence
comes free — an unrecognised tag is skipped, not recorded as a failure.
Malformed-tolerance does **not**: the tag nests `<query>` children, and
every other nested-tag field in the block throws on content it cannot
resolve into well-formed entries. This field must not. Its parser is
required to be **total** — drop what it cannot read, return what it
can, never raise — which makes it a deliberate exception to the
all-or-nothing rule rather than an inherited property.

That exception is load-bearing: a field-level parse failure fires a
full extra structured call, and spending one to recover an optional
retrieval hint inverts the cost of the recovery it triggers
([`piggyback.md → Parse strategy and failure recovery`](./piggyback.md#parse-strategy-and-failure-recovery)).

Three degenerate emissions are closed before embedding: identical
strings are deduplicated (three copies would split the pooled weight
evenly and cost triple the KNN for one signal), empty strings are
filtered, and an oversized string is capped at 200 characters rather
than left to the [truncation contract](#truncation-contract).

**Storage.** `story_entries.metadata.retrievalQueries`, capped at
three, excluded from `stateReport`, and **not inherited** — a query
carried forward from three turns ago is exactly the staleness this
pathway exists to avoid. Read from the last AI-authored entry, the same
row Q3 reads.

#### Redundancy — reporting a degenerate query

A query that retrieves only rows the prompt already contains has spent
its weight on duplicates. Without a way to see that, a useless query is
indistinguishable from a good one — the failure that removed the
heuristic prose extract this slot replaces.

The structural floor is built before the query stack, so by KNN time
both halves exist. Per emitted query, over its own top-K **before** pool
filtering:

```
redundancy = |topK ∩ floor.seatedIds| / |topK|
```

Near 1.0 means the query asked for what the turn already had; near 0
means it surfaced something the
[structural floor](#structural-floor--always-inject) did not.

**The cut is the ten nearest rows, taken globally.** `topK` is the ten
rows the query wanted most, merged across the floor-seatable kinds and
re-sorted by distance — not each kind's own cut, and not the full
`KNN_K` pass. Global rather than per-kind because a per-kind cut then
unioned dilutes by the kinds that rarely reach the floor: lore reaches
it only through a user-marked `always`. Merging is legitimate because
distances are comparable across those tables — every stored and query
vector is unit-norm, so L2 order is cosine order.

Pinning the cut is what makes the ratio mean anything. Read instead as
the full `KNN_K = 200` pass unioned over those kinds, `k` runs to ~600
against a floor holding ~12 ids: the ratio is then bounded above at
~0.02, a maximally degenerate query and a perfectly novel one land four
thousandths apart, and the "near 1.0" above is arithmetically
unreachable.

**Entities, lore and threads only.** `floor.seatedIds` can hold no
chapter or happening id, so admitting either kind's top-K to the
denominator would deflate every ratio by construction. The cut is taken
over exactly the kinds the
[structural floor](#structural-floor--always-inject) can seat, and no
others.

**The denominator moves with `keywordRetrieval.mode`.** It counts
only `floor.seatedIds`, which is exact under the default `boost`
mode but excludes rows [keyword injection](#keyword-injection) seats
under `inject`, so a query can ask for something the prompt already
carries via injection and still score near 0. Not a defect — canon's
"structural floor" means the floor, not the full prompt — but it is
a caveat whoever eventually sets the warn threshold will need to
weigh.

**The realised `k` travels with the ratio.** A corpus too small to fill
the cut yields fewer than ten rows, and one duplicate in three is not
the same evidence as one in ten. The probe stores both
([`probe.md → What gets captured`](./probe.md#what-gets-captured--light-mode-default)).

**Cheap, but not free.** Pool assembly already discards that
intersection on every pass — the floor filters run after KNN, not
inside it — so the metric reads what was being dropped silently. What
it costs is granularity: assembly used to collapse its KNN hits into a
single union set, and keeping them per query meant widening the KNN
result rows it carries and reshaping what it returns.

It is **observability only** in v1: no automatic dropping, because the
threshold that would justify one needs data nobody has yet. A pinned
cut makes the full range reachable and so makes a warn threshold
meaningful for the first time — the
[memory probe](../ui/screens/memory-probe/memory-probe.md#queries-tab)
marks a degenerate emission with ⚠ — but no number is set for it, here
or in code. Choosing one is open.

What it does not catch is a query retrieving novel but irrelevant rows.
It detects "asked for what it already had", which is the predicted
failure mode, not uselessness in general.

### Blending — weighted average

Each candidate scores against each **live** query vector via cosine
similarity. Final score is the weighted average over the present slots,
with weights re-normalized across them:

```
score(c) = w_action  × sim(Q1, c)
         + w_digest  × sim(Q2, c)
         + w_summary × sim(Q3, c)
         + w_direct  × mean(sim(Q4ᵢ, c) for each emitted Q4ᵢ)
```

Default weights (placeholder; user-tunable in advanced settings):

```
w_action  = 0.30
w_digest  = 0.25
w_summary = 0.20
w_direct  = 0.25
```

**The Q4 slot carries one pooled weight, not one per query.** Under
per-query weighting a model emitting three queries would hand the
pathway half the blend and one emitting none would hand it nothing —
emission volume becomes influence, and the blend's composition swings
turn to turn on how much the model felt like writing. Pooling means
emitting three sharpens the pathway's aim without buying it weight.

Weighted average over `max` because `max` lets a single strong signal
dominate, which is recall-favoring but noisy. Weighted average is the
consensus shape. Hybrid (`α × max + (1-α) × weighted_avg`) is reserved
for if real testing surfaces over-conservative retrieval.

**Correlation caveat.** Q2 and Q3 both describe the current scene — the
summary names the entities the digest lists — so their combined 0.45
may behave as one signal weighted 0.45 rather than two independent
ones. That is a calibration question for the
[tuning surface](#tuning-surface), not a reason to re-merge them: the
reliability asymmetry that justifies the split is independent of how
correlated the two texts happen to be.

**At N=1** the scheme must still hold: Q1 re-normalizes to 1.0 and
retrieval ranks on pure action similarity. That is the cold-start
behaviour, not a degradation to guard against.

**At N=0 there is no retrieval.** With no query vectors every pool is
empty and the ranker ranks nothing. Two things still reach the prompt:
the [structural floor](#structural-floor--always-inject), and — when
`keywordRetrieval.mode` is `inject` — the
[keyword injection](#keyword-injection) pre-pass, which needs no
vectors at all. `boost` cannot survive a zero-query pass, since it
modifies scores on candidates that do not exist. Injection is the only
pathway in the system that produces retrieval output without a single
vector.

### Cold start

Turn 1 has no prior AI entry, so no classifier has run: no summary, no
emitted queries. Q2 is thin-to-absent by construction. Turn 1 therefore
ranks on **Q1 alone**, and no special-casing compensates for it.

That is correct rather than tolerated. The opening entry reaches the
model regardless of retrieval — chapter 1 holds only the opening, so
the protected buffer floor pulls its prose in verbatim
([`architecture.md → Opening-entry classifier exception`](../architecture.md#opening-entry-classifier-exception)).
Retrieval on turn 1 is choosing _additional_ lore, entities and
happenings, of which a fresh story has approximately none. The removed
prose-extract slot was embedding a copy of text the buffer was already
injecting whole.

**Q2 is thin-to-absent on turn 1, by construction.** Its three
structural fields do not all have producers at wizard-commit time, and
this is a sequencing fact rather than a defect — Q2's presence flag is
derived from the rendered digest, so an empty one re-normalizes away
instead of spending its share on nothing:

| Q2 field         | Available at turn 1?                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Scene entities   | Only when the wizard produced a lead                                                      |
| Current location | No — the wizard commits `null`; piggyback is the only writer, and it runs after narrative |
| Active threads   | No — thread authoring arrives with the M4.3 plot panel                                    |
| Era              | No — the shipped calendar sets `eras: null`; flips are manual                             |

Whether the wizard _should_ commit a starting location is an open
question against
[Slice 3.6b](../implementation/milestones/03-memory-floor/slices/06b-wizard-cast.md),
which is where locations are authored.

## Candidate pools

The retrieval pool per type after the structural floor is satisfied.

### Structural floor — always inject

| Source                         | Notes                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt buffer                  | Partial mode: last `partialChapterBuffer` entries of current chapter. Full mode: entire current chapter. Both modes: previous-chapter spillover to satisfy `protectedBuffer` floor. See [`cadence.md → User-tunable knobs`](./cadence.md#user-tunable-knobs) |
| Active + in-scene entities     | `entities.status='active' AND id ∈ sceneEntities` — short-circuits `injection_mode`                                                                                                                                                                          |
| Current location entity        | `entities.status='active' AND id = currentLocationId` — same short-circuit. A staged, retired or deleted `currentLocationId` seats nothing, so the location block is guarded on the seated row, never on the id                                              |
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

Active off-scene and staged compete for the entity-type token budget.
Embedding similarity to the current scene digest determines which
staged entities float up — a wizard-curated character "the queen who
rules the throne room" auto-surfaces when the scene digest mentions the
throne room.

**The retired sub-pool is empty in practice, and that is correct.**
`injection_mode='always'` is its only opt-in, and the
[structural floor](#structural-floor--always-inject) seats every
`always` row before pool assembly runs — so a retired entity that
opted in is already injected and never reaches the pool to compete.
The sub-pool is a statement about what the ranker would do, not a path
production takes: a retired row without `always` is excluded, and one
with it is seated. Nothing is ranked in between.

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
  A staged entity carrying `injection_mode='always'` is exempt, because
  the floor seated it before the pool existed. That exemption is
  intended, not incidental — see
  [`edge-cases.md → Layer A`](./edge-cases.md#layer-a--retrieval-time-same-name-suppression).

---

## Hybrid retrieval per type

Embedding similarity is the primary signal but not the only one.
Different types benefit from different signal blends.

| Type                  | Primary                         | Complement                                                                               |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| **Lore**              | Embedding (title + body)        | Keyword on `lore.keywords` — proper nouns, in-world terminology                          |
| **Entities**          | Embedding (name + description)  | Keyword on `name` and `entities.keywords` — direct prose reference, aliases included     |
| **Happenings**        | Embedding (title + description) | Keyword on `awareness.source` strings — verbatim names / places in awareness descriptors |
| **Threads**           | Embedding (title + description) | None                                                                                     |
| **Chapter summaries** | Embedding (summary + theme)     | Keyword on `chapters.keywords` — chapter-level browse keywords (Phase 2 output)          |

For lore particularly, the keyword pathway is load-bearing — embedding
models have no semantic prior on user-authored proper nouns
("Vael" / "the Aetherium" / "blood-bound"). Keyword matching catches
exact lexical hits that embeddings miss; embeddings catch thematic /
conceptual matches that keyword can't (synonym, paraphrase). Together
they cover.

### Keyword scan surface

The keyword pathway matches against **narrative text**: the current
user action plus the last `keywordRetrieval.scanEntries` entries in
full, default 1 (the previous `ai_reply`). The depth is per-story
configurable; the user action and one trailing entry are the floor.

**The surface is defined here, independently of the query stack.** It
is deliberately _not_ the assembled embed texts. Deriving it from the
queries makes the lexical pathway inherit the dense pathway's inputs,
which defeats the point of having a complement — and under the removed
prose extract it made keyword matching conditional on that slot's
top-K selection, so a proper noun in a sentence the extract skipped
could never fire. Independence is also what let that slot be deleted
without disturbing this pathway.

Entries inside `protectedBuffer` are scanned even though they are
already in context verbatim: the mention is in context, but the lore
_about_ the mention is not, which is exactly what the pathway exists
to seat.

**Match rule follows the script of the keyword, per keyword.** Terms
composed of CJK ideographs, kana or hangul with no internal spaces
match by substring; every other term keeps `matchTerms`' existing
`\p{L}\p{N}` word-boundary lookarounds. Chinese and Japanese do not
delimit words with spaces, and Korean attaches particles directly to
nouns, so word-boundary anchoring silently misses in all three;
correct segmentation would need a dictionary or morphological
analyzer, which is a dependency this does not take on. Substring
matching is safe for these scripts specifically because their
characters are morphemes — the `art`-inside-`start` risk that
boundaries exist to prevent is far lower. Terms shorter than two
characters do not qualify for substring mode. Regex-metacharacter
escaping is unchanged; keywords are user-authored and may contain
them.

### Keywords schema

| Type         | Keyword surface                            | Source                                                                                 |
| ------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `lore`       | `keywords TEXT` (JSON `string[]`)          | User-authored at create time, OR lore-mgmt agent emits at chapter close                |
| `entities`   | `name` + `keywords TEXT` (JSON `string[]`) | Name implicit; keywords user-authored, OR periodic classifier emits at entity creation |
| `happenings` | `awareness.source` strings                 | Implicit (per-row, not per-happening)                                                  |
| `threads`    | (none)                                     | —                                                                                      |

Lore's `keywords` field is added; `lore.tags` stays separate (tags are
user-meaningful labels; keywords are retrieval-targeted strings). The
same split applies to `entities.keywords` against `entities.tags`.

**`entities.keywords` carries what the canonical name misses** —
titles, epithets and relational references ("the Grey Wolf", "your
brother", "the innkeeper"), which is how characters are named in prose
a good share of the time. Matching an entity on its `name` alone drops
every one of them.

Its producers mirror lore's, with the job falling to a different
agent: the user authors keywords directly, and the periodic classifier
emits them when it creates an entity — it already emits a brand-new
entity as a full object with no `id` field
([`classifier.md → What the classifier writes`](./classifier.md#what-the-classifier-writes)),
so keywords join that object, drawn from the prose that introduced the
character. Entity creation is the periodic classifier's job rather
than the lore-mgmt agent's, which is the only reason the producer
differs.

**Classifier writes to `keywords` append and never remove.** A user's
authored aliases have to survive every later classifier pass; a
full-replace write would silently discard them. Appends de-duplicate
against the existing set under the normalization `matchTerms` uses, so
a re-observed epithet does not accumulate.

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

### Keyword injection

`injection_mode` answers whether a row injects. What a keyword hit
_does_ is a separate question, carried on its own axis by the
per-story `keywordRetrieval.mode` setting:

| Value    | Behaviour                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `boost`  | A hit adds `kw_boost` to the ranked score. Default, and the behaviour described above.                        |
| `inject` | A hit seats the row directly, subject to the budget in [Keyword injection budget](#keyword-injection-budget). |

Two axes rather than a fourth enum value: folding this into
`injection_mode` would produce `always | auto | auto_plus_keyword |
disabled`, whose third value mixes two unrelated decisions.

**`injection_mode='disabled'` beats `mode='inject'`.** Disabled is a
standing per-row exclusion; a story-wide mode must not resurrect it.
`always` with either value is a no-op — the
[structural floor](#structural-floor--always-inject) already seated
the row.

**`inject` applies to lore and entities only.** It needs both a
user-curated keyword set and an ordering key for overflow, and only
those two types have both. Happenings and chapters stay on `boost`
unconditionally, which is their current behaviour, so nothing
regresses.

- **Happenings** carry no keyword column. Their hits are derived from
  the entity names appearing verbatim inside freeform awareness
  `source` descriptors — no authored list to curate, and no `priority`
  to order by. Decisively, direct seating would bypass
  [POV-awareness scope](#pov-awareness-scope), which admits happenings
  only through `character_id IN (sceneEntities ∩ characters)`; a
  keyword path assembling its own candidates would seat happenings no
  in-scene character is aware of. That is an information leak, not a
  tuning preference.
- **Chapters** do have `keywords`, so their exclusion is a deliberate
  narrowing rather than an oversight: the keywords are lore-agent
  output rather than user curation, there is no `priority` to order
  overflow with, and a whole chapter summary is a large seat to spend
  on a browse keyword. Admitting chapters later means giving them an
  ordering key first.

**Keyword injection does not exempt a row from same-name
suppression.** See
[`edge-cases.md → Layer A`](./edge-cases.md#layer-a--retrieval-time-same-name-suppression);
`injection_mode='always'` remains the only opt-out, because the
exemption is justified by per-row user intent and a story-wide mode is
not that. Keyword-injected rows otherwise respect the same status and
[pool-exclusion](#pool-exclusions) rules as ranked candidates, and a
row seated by keyword is skipped when it later appears as a ranked
candidate rather than seated or charged twice.

**Cascade** is off by default. Enabled, an injected row's own text is
rescanned for further hits to `keywordRetrieval.cascadeMaxDepth`
(default 2). Cascaded rows draw on the same keyword allowance, and
depth-1 rows seat before depth-2 rows so a dense keyword graph cannot
spend the whole allowance on second-order matches.

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

The ranker uses `decay_resistance` to bias scoring, not to carve out
a separate budget tier: a pinned item's salience decays more slowly
(scaled by `(1 - decay_resistance)`), so it floats higher in the
single similarity-ranked order without reserved slots and without
bypassing the budget. Long stories with hundreds of pinned rows
still fall to budget pressure — pins compete on similarity to the
current scene, and only the diverse-and-relevant survive MMR +
budget. Absolute always-inject would break on long stories.

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
Chapters:    [===       ]   600 tokens
                          ─────
Total:                    5500 tokens
```

These five are the shipped `stories.settings.retrievalBudgets`
defaults (`STORY_SETTINGS_DEFAULTS`). They are **token** budgets;
migration `0007_retrieval_budget_tokens` rewrites the row-count
values stories carried before that.

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

### Keyword injection budget

Applies while `keywordRetrieval.mode` is `inject`; under `boost` a
keyword hit only adjusts a ranked score and this section is inert.

`injection_mode='always'` rows need no rule here — they are
[structural floor](#structural-floor--always-inject) members, so
[the floor seats them before per-type budgets exist](#structural-floor-takes-budget-first).
The asymmetry between the two is deliberate: `always` is a per-row
explicit intent on a small set of rows, so unbounded seating is what
the user asked for, whereas `inject` is a story-wide policy that can
match arbitrarily many rows in one turn. Unbounded seating there is
the classic lorebook failure, where a single scene naming ten
keyworded rows consumes the window.

So keyword-injected rows fill each type's existing budget first, up to
`keywordRetrieval.budgetShare` of that type's allocation; ranked
candidates take the remainder. The cap is per-type, matching the
[hard partitions](#hard-partitions-in-v1) already in force — an unused
keyword allowance in one type does not migrate to another. The cap is
also what makes badly-authored keywords a bounded problem rather than
an unbounded one.

`budgetShare` defaults to `0.5`, splitting each type's allocation
evenly between lexical and ranked evidence. It is a starting guess in
the same sense as the blend weights and per-type decay rates, and
wants calibration against real stories rather than defending as a
derived value.

**Overflow ordering.** When keyword matches exceed the cap, `priority`
orders them, ties broken alphabetically by display name.
`lore.priority` already exists; `entities` gains a matching
`priority INTEGER NOT NULL DEFAULT 0`.

Ordering by similarity was rejected: keyword-direct rows do not all
carry a similarity score, since the match is lexical and sits outside
the embedder pools, so it would mean either pulling matches through a
retrieval pool they had no reason to enter, or leaving part of the set
unordered. `priority` is also the user-facing answer, which matters
for a mechanism users will debug by adjusting it.

**`entities.priority` orders overflow only and does not feed
`pin_signal`**, which stays `0` for entities per the
[scoring function](#scoring-function). `lore.priority` does feed it,
so on lore the column carries a second effect — raising it to win
keyword overflow also raises `pin_boost`. The two never apply to the
same row on the same turn, since a keyword-matched row is seated
without reaching the ranker and a non-matched row never consults
overflow ordering; and both readings run the same direction, meaning
"this row matters more than its raw similarity earns."

**This does not contradict the argument for a graded pin.** The
[scoring function](#scoring-function) makes `priority` multiplicative
precisely so a high-priority but irrelevant lore row still falls under
`min_score_threshold`, reserving unconditional injection for
`injection_mode='always'`. That holds unchanged in the ranked path. In
the keyword path the hit is itself the relevance gate — the row
qualified because its term actually appeared — and `priority` only
orders what already qualified, so it never becomes an unconditional
injector on its own.

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
the live query vectors with weighted-average blending, per-type candidate
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
    sim_blend(c) × recency_factor(c) × pin_boost(c) + kw_boost(c),
    (sim_blend(c) − τ_revive) if sim_blend(c) ≥ τ_revive else 0
)

recency_factor(c) = exp(−λ_type × chapters_old(c) × (1 − pin_signal(c)))
pin_boost(c)      = 1 + k_pin(type_of(c)) × pin_signal(c)
```

Where:

- **`sim_blend(c)`** — weighted-avg of cosine similarities between `c`
  and each live query vector (action / structural digest / piggyback
  summary / classifier-emitted). Already computed in the
  [query stack](#query-construction--the-query-stack).
- **`pin_signal(c)`** — `decay_resistance` for awareness rows,
  `priority/100` for lore, `0` for entities and threads (no
  continuous pin signal in v1). `entities.priority` exists but is
  deliberately outside this function: it orders keyword-inject
  overflow only, per
  [Keyword injection budget](#keyword-injection-budget).
- **`λ_type`** — type-specific decay rate (table below).
- **`chapters_old(c)`** — chapters since `c` became relevant
  (`learned_at_entry_id` for awareness, `created_at` mapped to chapter
  for happenings without awareness, `updated_at` for entities and
  threads, effectively zero for lore since lore is timeless).
- **`kw_boost(c)`** — additive bonus when the keyword index hits
  (lore keywords, entity name and `entities.keywords`, awareness
  `source` string), matched over the
  [keyword scan surface](#keyword-scan-surface). Default magnitude
  `0.10`. Zero if no keyword pathway exists for the type, and zero
  for a row seated by keyword injection, which never reaches this
  function.

The multiplicative pin-into-recency integration is the key shape:

- `pin_signal = 1` flat-tops decay (item maintains full `sim_blend`
  forever).
- `pin_signal = 0` decays normally.
- Fractional values for "mostly persistent."

**`k_pin` is the pin's second channel, for types that do not decay.**
Pin-into-recency needs decay to resist, so on a type with `λ_type = 0`
the exponent is 1 whatever the pin says and `pin_signal` reaches the
score through nothing. Lore is that type — timeless by design, and the
only non-decaying type carrying a pin signal — so its `priority` would
otherwise be inert. `k_pin` is per-type rather than derived from
`λ_type` so a reader can see which types use which channel:

| Type         | `k_pin` | Pin reaches the score via |
| ------------ | ------- | ------------------------- |
| `lore`       | 0.25    | `pin_boost` (no decay)    |
| `happenings` | 0       | the decay exponent        |
| others       | 0       | no pin signal in v1       |

Multiplicative rather than additive, deliberately: at `priority = 100`
a lore row scores 1.25× what its similarity earned, which wins ties
among relevant lore but leaves an irrelevant row near zero and still
under `min_score_threshold`. An additive pin of the same magnitude
would carry a `sim_blend = 0.02` row to 0.27 and inject it every turn
regardless of the scene — which is what `injection_mode='always'` is
for, and what the graded control exists to be an alternative to.
`k_pin = 0` at the default `priority = 0`, so the knob is a no-op until
a user reaches for it.

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

  **The exemption is the mechanism, not a side effect of the score.**
  `bypass_score` alone cannot deliver it: its output is capped at
  `1 − τ_revive = 0.15`, and
  [budget-fill](#budget-fill-termination) compares against `mmr_score`,
  whose first-pick floor is `min_score_threshold / λ_div = 0.2`. So a
  row raised only by `bypass_score` is always below the floor, and the
  bypass would seat nothing at any similarity. Budget fill must skip
  the threshold check for a bypassed row outright. Everything else —
  `candidate_too_large`, `over_budget`, MMR ordering — still applies.

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
  if any(ch.range contains h.occurred_at_entry_id for ch in matched_chapters):
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
happenings **pool construction** starts, not merely before happenings
ranking. `matched_chapters` decides which happenings enter the pool at
all, not only how the ones already in it score: a pool gated purely by
vector similarity puts the boost out of reach of the scattered rows it
exists to rescue, because low own-similarity is precisely their
profile. Happenings inside a matched range are therefore admitted
regardless of KNN rank — they carry no match row, so their vectors are
fetched by id — and they still face the POV-awareness filter, the
stale filter, MMR and budget fill. Admission is not seating. Other
types (entities, lore, threads) run independently in parallel.

**Why this matters.** Without the boost, happening retrieval is
"scattered" — top-K by similarity across the entire story, often
disconnected. With the boost, top-K tends to cluster around the
chapters most relevant right now: a more narratively coherent slice
of context for the LLM.

**What it costs.** Admission is the single largest term the boost adds,
because an admitted row carries no KNN match row and so needs its
vector fetched by id — and `id` is a vec0 metadata column with no
push-down, so that fetch scans the branch partition. Measured at dim
384: seating five of sixty chapters admits ~480 happenings on top of a
~290-row KNN pool, and the whole mechanism costs ~24ms of a ~108ms pass
at 6000 happenings, against ~5ms at 1200 — figures from the pre-fix
bench fixture, so read the share rather than the milliseconds
([Per-turn cost budget](#per-turn-cost-budget)). It cost ~44ms before
tokenization moved past the pre-filter: the admitted rows land beyond
rank 200 and are no longer priced. Two consequences worth holding:

- **Issue the by-id fetch once.** Its cost tracks partition size and is
  near-flat in the id count, so splitting the admitted set into chunks
  multiplies the scans rather than dividing the work.
- **The cost is proportional to happenings on the branch**, which the
  budget accepts — but the benefit is unquantified. Which rows the
  boost rescues cannot be shown on synthetic data; it needs a real
  story's happening distribution. The harness prices the cost and says
  so.

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

| Type                   | `λ`          | `recency_factor = 0.5` at | Rationale                                                                              |
| ---------------------- | ------------ | ------------------------- | -------------------------------------------------------------------------------------- |
| Happenings (awareness) | 0.07         | ~10 chapters              | Events get stale, but not as fast as a 5-chapter half-life would imply                 |
| Entities (off-scene)   | 0.025        | ~28 chapters              | Cast turnover is slow                                                                  |
| Threads                | 0.025        | ~28 chapters              | Arc presence is slow                                                                   |
| Lore                   | 0 (no decay) | —                         | Effectively timeless; pins via `k_pin`, not decay — `sim_blend × pin_boost + kw_boost` |
| Chapter summaries      | 0 (no decay) | —                         | Mid-level historical record; ranks purely on `sim_blend + kw_boost`                    |

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

**Cost.** `O(N²)` per type, not `O(N × K)`: C4's per-candidate trace
records an `mmrRank` for every candidate that entered MMR, which forces
the full greedy ranking rather than stopping at K. So the pre-filter is
what bounds it — **top-200 by raw score before MMR**, which caps the
worst case at ~6.5ms per type at dim 384 and ~12.5ms at dim 768.

In practice only happenings reaches 200; the other four types are
bounded by how much a person authored. Measured across all five types
together, scoring plus tokenization plus MMR plus budget fill is ~40ms
at dim 384 — see [Per-turn cost budget](#per-turn-cost-budget). The
bench no longer separates MMR from the tokenization the same map does,
so the ~6.5ms figure above predates that merge and is not re-derivable
from it. Restructuring is not the lever: a `Uint8Array` bitmap variant
measured only 10-18% faster, and the irreducible cosine floor alone is
4.34ms at N=200.

The pre-filter's trade stands: candidates ranking ~200th by raw score
are unlikely to make the budget anyway, so it doesn't lose meaningful
selections.

### Budget-fill termination

Greedy fill within the per-type budget after MMR ranking. Under
`keywordRetrieval.mode='inject'` the keyword-injected rows for the type
are seated first and their cost deducted, capped at
`budgetShare × type_budget` per
[Keyword injection budget](#keyword-injection-budget); under `boost`
the reservation is zero and the fill starts at the full budget:

```python
selected = list(keyword_injected)          # empty under mode='boost'
remaining = type_budget - cost_of(selected)

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
- **`min_score_threshold = 0.15`** — rows below this are essentially
  semantically unrelated to current scene; including them clutters
  the prompt with noise. Underutilized budget is fine; we don't
  backfill with low-relevance content.

  It is **not a cosine baseline.** The loop above compares it against
  `mmr_score`, which is already scaled by `λ_div` and reduced by the
  diversity penalty — so the raw score a row must reach is
  `(min_score_threshold + (1 − λ_div) × max_sim) / λ_div`. At the
  defaults that is **0.2** for a first pick, where `S` is empty and
  the penalty is zero, and it rises from there: a candidate whose
  `max_sim` to an already-selected row is 0.5 must reach ≈0.367.
  That is deliberate — budget-fill is asking whether a row is worth
  its tokens _given what is already selected_, and a near-duplicate
  of a seated row is poor value however relevant it is alone. The
  floor is on marginal value, not on similarity.

  One consequence is load-bearing enough to state: `τ_revive` caps
  the [high-similarity bypass](#high-similarity-bypass--revival-of-decayed-memories)'s
  output at `1 − τ_revive = 0.15`, which is below the 0.2 first-pick
  floor, so a bypass-bound row could never be seated. Bypassed rows
  are therefore **exempt from this threshold** — see that section.

No "must-fill-budget" mode. The user's expectation is "good context
or no context, not bad context."

### Token estimation

Tiktoken-based, computed at ranker time:

```
token_count(c) = tiktoken(c.rendered_field_text) + type_overhead(type_of(c))
```

Per-type overhead is a small constant for the Liquid macro / block
wrapping — measured empirically against the shipped macro, constant in
code thereafter:

| Type         | Overhead | What the constant covers                         |
| ------------ | -------- | ------------------------------------------------ |
| `entities`   | 11       | `# Elsewhere in the world` plus the bracketed id |
| `lore`       | 4        | `# Relevant lore`                                |
| `happenings` | 5        | `# What has happened`                            |
| `threads`    | 4        | `# Background threads`                           |
| `chapters`   | 4        | `# Earlier chapters`                             |

Three rules hold those numbers in place:

- **A ranked row renders its `rendered_field_text` and nothing else.**
  Anything a block puts outside that string — a heading, a label — is
  length the estimate never charged for, so the type overruns its
  partition by that length times the row count. A chapter's title
  therefore lives inside the string rather than on a `##` line above
  it.
- **Only the entity block brackets an id.** The `<state>` block
  references entities and nothing else, so an id on lore / happenings
  / threads / chapters is spend that invites a reference no parser
  resolves.
- **Emission instructions belong to the including template, not the
  macro.** They cost once per prompt, while anything inside a block is
  charged once per row: the `<scene_entities>` instruction is 27
  tokens on its own, and moving it into the entity block would take
  that type's overhead from 11 to 38.

Measured on a one-row block, so an N-row block is charged its header N
times and renders it once: the estimate carries `N − 1` headers of
slack, at least 3 tokens per extra row. That is the safe direction
against a hard partition, and a marginal-cost measurement would be
tighter but can overshoot.

The slack is not a guarantee at `N = 1`, where there is none. BPE is
not additive across the seam between the wrapper and the row's own
text — a row whose text splits a newline run the empty probe had
merged renders one token more than it was charged. Probed across the
five blocks, that boundary case never exceeded **1 token**, so it is
noise against partitions in the hundreds; the thing that actually
overruns a partition is a variable-length string rendered outside
`rendered_field_text`, which is what the first rule above forbids.

The constants live in `RANKER_DEFAULTS.typeOverhead`;
`lib/prompts/bundled/memory-blocks.test.ts` re-derives them from the
shipped macro and fails when the macro moves and the constant does
not.

**No stored column on candidate tables.** Each candidate is tokenized
at most once per pass — the ranker keeps the result on the scored row —
so nothing pays twice for the same row within a turn.

**Only the rows that survive the pre-filter are tokenized.**
`rankPerType` scores and sorts the whole pool but defers the token
estimate to the `preFilterTopN` slice, so a row that MMR will never see
costs nothing and carries `tokensEstimated: null` in its trace. That is
sound because a pre-filtered row can never be seated — not by the pass
and not by the probe simulator, which cannot un-drop it without the
per-row vectors that would let it re-run MMR. Per-row cost is ~45-60 µs
with js-tiktoken `o200k_base`; capping the row count is what took the
pass from ~140ms to ~108ms at dim 384 — both endpoints from the pre-fix
bench fixture (see [Per-turn cost budget](#per-turn-cost-budget)).
A `token_count INTEGER` column per table remains the fallback if that
is not enough, with cache invalidation on row update.

### Per-turn cost budget

Measured, not estimated: `bench/retrieval-cost.test.ts` (`pnpm
bench:retrieval`) prices the shipped pass against the volumes
[Scale assumptions](#scale-assumptions) projects. Numbers below are
desktop (Node 24 / V8, file-backed SQLite, `sqlite-vec` 0.1.9),
median of seven warm passes, **excluding the embedder and IPC**, taken
on an otherwise-quiet machine across two consecutive runs that agreed
within 2-4%.

| Step                                                   | dim 384 | dim 768 | Scales with                           |
| ------------------------------------------------------ | ------- | ------- | ------------------------------------- |
| `knnMs` — 3 live queries (`q4=0`)                      | ~77ms   | ~150ms  | **query count**, rows per family, dim |
| `knnMs` — 6 live queries (`q4=3`, the Q4 cap)          | ~121ms  | ~244ms  | **query count**, rows per family, dim |
| `rankMs` — scoring, tokenization, MMR, budget fill     | ~40ms   | ~57ms   | min(pool, `preFilterTopN`) per type   |
| **Total**                                              | ~136ms  | ~228ms  |                                       |
| **Total (Q4 saturated)**                               | ~182ms  | ~319ms  |                                       |
| M3.4 sub-split — source reads, awareness, chapter JOIN | ~21ms   | ~21ms   | branch entity / lore / thread count   |
| M3.4 sub-split — KNN, 3 vectors × 5 types              | ~35ms   | ~75ms   | **query count**, rows per family, dim |
| M3.4 sub-split — chapter-range admission               | ~21ms   | ~24ms   | happenings on the branch              |
| M3.4 sub-split — candidate assembly                    | ~6ms    | ~8ms    | pool size                             |

Read at 6000 happenings / 15 000 awareness / 60 chapters with the
chapter-match boost on — the top of the projected range. **Total** and
the first `knnMs` row are the three-vector stack; **Total (Q4
saturated)** and the second are the same pass with the Q4 slot at its
cap of three emitted queries, which is the worst case the budget has to
hold at. Lower scales are cheaper roughly in proportion: at `q4=0`,
~68ms / ~126ms at 1200 happenings and ~110ms / ~179ms at 3600.
`rankMs` carries no `q4` axis because it does not move with query
count — the pre-filter caps what gets scored before ranking runs
regardless of how many query vectors fed KNN. Measured at dim 384:
~41.7ms at `q4=0` versus ~41.9ms at `q4=3`.

**Why the shipped figures moved.** The bench fixture built all three
query vectors on one topic centroid — the topic index was mapped over
but never read — so their KNN top-200 sets largely coincided, the pool
union came out small, and every term that scales with that union read
optimistic in the table that exists to price it. The fixture now takes
one centroid per query and carries a `q4` axis. That is what moved
**Total** from ~108ms to ~136ms at dim 384 and `rankMs` from ~29ms to
~40ms, and it is where the saturated rows come from.

**Which rows a re-run reproduces.** The bench emits five spans:
`totalMs`, `syncMs`, `embedMs`, `knnMs`, `rankMs`. The first five table
rows are spans: **Total** and **Total (Q4 saturated)** are `totalMs` at
`q4=0` and `q4=3`, the two `knnMs` rows are that span at the same two
settings, and the `rankMs` row is that span. The four **M3.4
sub-split** rows are not. They are an ad-hoc split of `knnMs` and of
the unnamed span before it (source loading has no `RetrievalTimings`
member), hand-measured once during M3.4 and not instrumented since — so
they predate the fixture fix and no longer sum to **Total**, and their
KNN row is one component of that split rather than `knnMs` itself, so
the gap between its ~35ms / ~75ms and the measured `knnMs` rows is not
a discrepancy. Re-deriving them would mean instrumenting `runRetrieval`
for a doc's sake. Read them as proportions, not as figures.

Three things the table makes visible that the previous estimate did
not:

- **Tokenization is bounded by `preFilterTopN`, not by pool size.**
  It used to be the pass's largest single term, charged per pool row
  to fill a non-nullable trace field — a 771-row happenings pool
  tokenized to seat 22. `rankPerType` now defers it past the
  pre-filter slice and leaves `tokensEstimated` null on dropped rows,
  which is what took the total from ~140ms to ~108ms at dim 384 — both
  endpoints measured under the pre-fix fixture, so read the drop and
  not the figures. The saving is not separately quotable: tokenization
  runs inside the same kept-row map that feeds MMR, so the two rows
  this table used to carry are one row and one `rankMs` span. Scoring
  and the sort do still walk the whole pool — the bench's 477-row
  swing between boost on and off moves `rankMs` by ~1ms, which is what
  "scales with pool size" is now worth here.
- **MMR is not the problem it looked like.** The measured ~6.5ms per
  type at N=200 is real, but only happenings reaches 200 in a typical
  story: entities, lore and threads are human-authored and sit in the
  low hundreds. Scoring, tokenization, MMR and budget fill together
  are ~40ms at dim 384. A story that saturates the pre-filter on all
  five types tokenizes and ranks 1000 rows, which the bench fixture's
  pool does not reach — the honest worst case, not the common one, and
  the one term in this table left unpriced.
- **The chapter-range admission is a first-class cost**, not a
  rounding error on the happenings pool. See
  [Chapter-match boost](#chapter-match-boost-on-happenings).

**Target.** Retrieval is a blocking prelude to the narrative call, so
its cost is additive to time-to-first-token — but that call is tens of
seconds, and the previous "<100ms total" target was never derived from
it. The budget is therefore expressed as a **scaling** obligation
rather than an absolute:

- One pass stays **under ~250ms at the top of the projected range** on
  desktop, which is under 1% of a turn.
- No term may scale with **awareness row count** or with total branch
  entries. Awareness is projected at 15-60k rows at 60 chapters and is
  the fastest-growing table in the schema; a term proportional to it
  is the one that ends a long story.
- Terms proportional to **happenings on the branch** are accepted but
  budgeted, because that count is bounded by the chapter threshold.

**The Q4-saturated pass at dim 768 is over that first bullet's
ceiling** — ~319ms against ~250ms, measured, and it is the worst case
the [Q4 cap](#q4-classifier-emitted-queries) allows rather than an
outlier. Nothing here resolves it. Whether the ceiling moves, the cap
tightens, or dim 768 stops being a desktop default is a decision this
doc records the number for rather than makes. The other two obligations
hold: query count is a fixed small constant, not a term proportional to
awareness rows or branch entries.

Desktop is nonetheless the least interesting part of the widening —
retrieval stays under 1% of a turn even saturated. The widening bites
in the two places this table does not cover, and both are obligations
on whoever sources Q4 rather than assumptions the design may make:

- **The embedder is excluded from every row of this table, and the
  bench cannot fill the gap.** It emits an `embedMs` span, but its
  fixture stubs the embed call with precomputed vectors, so that span
  reads 0.0 and prices nothing. The per-turn embed is **one batched
  call** whose text count goes from three to six, not three calls
  becoming six; a local ONNX runtime may still loop per text inside
  that call. Nothing has measured it against the wider stack, and a
  bench that could would need a real embedder wired into the fixture.
- **Mobile doubles an already-open risk** — see below.

**Mobile is unmeasured.** Every figure here is desktop. The PoC's
per-query KNN numbers under
[Performance characteristics](#performance-characteristics--poc-findings)
are the only mobile evidence and they predate the shipped pass, which
issues five KNN passes per live query rather than three total — up to
thirty with Q4 at its cap. Nothing has run the ranker on-device.
Treat the mobile budget as open, not as a scaled copy of this table.

### Pseudocode

```python
def rank_per_type(candidates, queries, scan_text, type_budget, λ_type, type_overhead, *, matched_chapters=None, keyword_injected=()):
    # 1. Compute raw score per candidate. A keyword-injected row is dropped from
    #    the pool outright rather than skipped during the fill: it is seated
    #    already, and never reaching the ranker is what keeps it out of the
    #    candidate records entirely (→ Keyword injection).
    seated_ids = {c.id for c in keyword_injected}
    scored = []
    for c in candidates:
        if c.id in seated_ids:
            continue
        sim = blend_similarity(c, queries)
        # Keyword hits match the scan surface — the user action plus the
        # trailing entries — NOT `queries`. See → Keyword scan surface.
        kw  = keyword_boost(c, scan_text)
        if c.kind == 'happening' and c.common_knowledge:
            score = sim + kw
        else:
            pin = pin_signal(c)
            rec = exp(-λ_type * c.chapters_old * (1 - pin)) if λ_type > 0 else 1.0
            # Second pin channel, for types where λ_type = 0 leaves `rec` at 1.0
            # regardless of the pin. k_pin is 0 for every decaying type, so a pin
            # is never counted twice.
            score = sim * rec * (1 + k_pin(type_of(c)) * pin) + kw

        # High-similarity bypass — revival of decayed memories
        if sim >= τ_revive:
            score = max(score, sim - τ_revive)

        # Chapter-match boost on happenings
        if c.kind == 'happening' and matched_chapters:
            if any(ch.contains(c.occurred_at_entry_id) for ch in matched_chapters):
                score *= 1.3

        scored.append((c, score))

    # 2. Pre-filter for MMR efficiency on large pools
    if len(scored) > 200:
        scored = top_n_by_score(scored, 200)

    # 3. MMR-rank
    mmr_ranked = mmr(scored, λ_div=0.75)

    # 4. Greedy budget fill — keyword-injected rows seat first and are
    #    capped at budget_share * type_budget (empty under mode='boost')
    selected = list(keyword_injected)
    remaining = type_budget - cost_of(selected)
    for c, mmr_score in mmr_ranked:
        if mmr_score < 0.15:
            break
        cost = tiktoken(c.rendered_text) + type_overhead
        if cost > remaining:
            continue
        selected.append(c)
        remaining -= cost

    return selected

def rank_all(pools, queries, scan_text, budgets, type_config, injected_by_type):
    # Chapters first — small pool, ranks fast, output feeds happenings
    matched_chapters = rank_per_type(
        pools['chapters'], queries, scan_text, budgets['chapters'],
        type_config['chapters'].λ, type_config['chapters'].overhead
    )

    # Happenings depend on matched_chapters (chapter-match boost)
    happenings = rank_per_type(
        pools['happenings'], queries, scan_text, budgets['happenings'],
        type_config['happenings'].λ, type_config['happenings'].overhead,
        matched_chapters=matched_chapters
    )

    # Other types run independently — no inter-type dependencies. Only these
    # carry a keyword-injected set: chapters and happenings stay on `boost`
    # unconditionally (→ Keyword injection), so theirs is always empty.
    others = {
        type: rank_per_type(
            pools[type], queries, scan_text, budgets[type],
            type_config[type].λ, type_config[type].overhead,
            keyword_injected=injected_by_type.get(type, ())
        )
        for type in ('entities', 'lore', 'threads')
    }

    return {**others, 'chapters': matched_chapters, 'happenings': happenings}
```

### Tuning surface

Defaults are conservative. v1 ships them hardcoded; the user-facing
override surface — an app-level default plus per-story override under
App Settings → Memory → Advanced — is parked
([parked.md → Tier-2 retrieval ranker-knob tuning surface](../parked.md#tier-2-retrieval-ranker-knob-tuning-surface)).
The Tier-2 knob set those controls would expose:

- Per-type `λ` decay rates.
- `λ_div` MMR diversity vs. relevance.
- `kw_boost` magnitude.
- `min_score_threshold` noise floor.
- `τ_revive` high-similarity bypass threshold (default 0.85;
  controls when decayed-but-extremely-similar rows resurface).
- Per-query weights (`w_action`, `w_digest`, `w_summary`, `w_direct`)
  — already in the
  [query stack](#query-construction--the-query-stack). `w_direct` is a
  pooled share across every emitted Q4, not a per-query weight.

Real signal from testing tunes these. v1 ships with defaults;
empirical calibration happens once test stories surface real
ranking-quality signal.
