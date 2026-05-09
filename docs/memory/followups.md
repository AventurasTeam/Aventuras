# Followups and Settings UX

What needs to happen for this design to land: Settings UX
implications, v1-blocking work, and parked / post-v1 items. The
schema delta and cross-doc updates this design forced have all
landed in their canonical homes (`data-model.md`, `architecture.md`,
top-level `followups.md`, `parked.md`).

---

## Settings UX implications

The Memory section in Story Settings gets denser:

- Existing: `chapterTokenThreshold`, `chapterAutoClose`.
- Dropped: `compactionDetail`.
- New: `recentBuffer`, `fullChapterInBuffer`, `classifierCadence`,
  `piggybackMode`, `embeddingBackend`, `retrievalMode` (read-only
  after creation), per-type retrieval budget sliders (5 sliders:
  entities, lore, happenings, threads, chapter summaries).

Worth structuring into sub-sections (Recent context / Classifier /
Retrieval / Models) at the design pass for the Memory tab. App
Settings → Memory gets a parallel Story Defaults shape plus the
global `embedding_model_id` selector and the model swap re-index
dialog.

Wireframe and per-control affordance design land at the Story
Settings Memory tab pass.

---

## Followups

### v1-blocking

- **Threshold tuning** — empirical calibration pass for the ranker's
  defaults (`λ_type` per candidate type, `λ_div`, `kw_boost`,
  `min_score_threshold`, `chapter_boost` magnitude, `τ_revive`
  high-similarity bypass), for name-collision reconciliation
  (`τ_high`, `τ_low`), for the frequency-driven candidate set size
  (top-N), and for the consolidation cluster threshold (cosine
  similarity, involvements overlap percentage, time-proximity
  window). Lands once test stories exist to calibrate against;
  defaults ship for v1, advanced settings expose them.
- **Local embedder integration + on-device perf demo (PoC done — production wiring remains)** —
  PoC ran on the `poc/embedder-demo` branch (kept as audit trail,
  not merged). The design is validated; v1-blocking work that
  remains is the production integration (downloader, license dialog,
  settings UI), tracked under that scope below.

  **Runtime path.** ONNX everywhere — `onnxruntime-react-native` on
  Expo, `onnxruntime-node` on Electron. Same ONNX file used on both
  platforms for vector consistency. Transformers.js dropped from
  consideration: pure-JS WASM inference unsuitable for mobile, and
  ONNX-export embeddings differ from transformers.js outputs in
  practice — going ONNX-only on both sides keeps stored vectors
  comparable.

  **Tokenizer (pivoted from original ort-extensions plan).** The
  original spec was `onnxruntime-extensions` custom ops baked into
  the ONNX graph. PoC proved this doesn't work on ORT-RN: its JSI
  string-tensor binding cannot pass strings into custom ops; every
  tested input-shape variant failed with the same buffer-size
  mismatch (`expected 24, got 8`) at `tokSession.run`. The
  tokenizer.onnx file itself is correct — verified in Python with
  cosine 1.000000 vs reference — the bug is in ORT-RN's binding
  layer.

  Pivoted to **`@huggingface/tokenizers`** in JS: pure JS/TS, zero
  dependencies, ~8 KB gzipped, supports BPE / WordPiece / Unigram /
  Legacy (covers every tokenizer family on production HF models).
  Same proven library transformers.js uses internally; consumes
  standard HF `tokenizer.json` directly. Tokenization happens in JS
  (Hermes-compatible — verified working in the PoC), model runs in
  ORT-RN's native code path. No JS-side numerics in the model
  inference; tokenizer is pure transformation.

  **Bundle format.**
  `{model.onnx, tokenizer.json, tokenizer_config.json, meta.json}`.
  The previous `tokenizer.onnx` format is dropped.

  **Sourcing — three paths.** Curated HF download is the in-app
  primary path with **live model-card fetch** at download time so
  the user agrees to the current license rather than a
  curation-time snapshot — defends against authors editing model
  cards post-curation. We store the agreed-to license text
  alongside the model file so the agreement is frozen even if the
  source changes later. Two power-user paths sit in App Settings ·
  Embedding models alongside curated:
  - **HF id input** — user types a `<namespace>/<model>` id; the
    dialog fetches model card + file listing live, validates the
    required ONNX/tokenizer files are present, runs the same
    license + download flow as curated. SHA256s computed (not
    pre-known) and stored in `.attestation` for reference. EP
    picker before download. Brings the convenience of curated
    auto-fetch to non-curated models without forcing manual
    download. Requires `@huggingface/tokenizers` to handle the
    standard HF tokenizer.json directly — pivoting to that JS
    library (away from the original ort-extensions plan) is what
    makes this path viable.
  - **Custom file import** — user provides the three standard HF
    files from filesystem (`model.onnx`, `tokenizer.json`,
    `tokenizer_config.json`). License is user-attested. EP picker
    at import time. The escape hatch for air-gapped or
    pre-downloaded models.

  **PoC findings — embedder (Galaxy Fold 7 — last-gen flagship;
  low-end testing parked, see below).**
  - **Warm per-embed:** CPU 10 ms mean / 1-30 ms range; NNAPI 13 ms
    mean, much tighter distribution. NNAPI's stability is more
    valuable for P99-bounded budgeting than its slightly higher
    mean.
  - **Embed-cost variance under load:** tight-loop microbenchmark
    measures ~10 ms warm; single-shot embeds (with idle gaps) come
    in closer to ~30 ms. CPU governor downclock between calls
    accounts for the gap. Same pattern under both CPU and NNAPI EPs.
    Real per-turn budgeting must use the single-shot number, not the
    loop number — three single-shot query embeds is realistically
    ~100 ms under normal use, not 30 ms.
  - **Cold init:** ~270 ms (asset extraction from APK dominates).
    Warm re-init: ~120 ms. Asset extraction accounts for ~150 ms of
    cold start.
  - **EP divergence:** CPU vs NNAPI cosine = 1.000000. Either ORT
    enforces fp32 at partition boundaries or the quantized-int8 ops
    are deterministic across implementations. The
    `(model_id, execution_provider)` cache-key broadening raised
    pre-PoC is **resolved as no** — single-key `embedding_model_id`
    is sufficient.
  - **xnnpack EP** crashes the app on embed. Op-coverage gap or
    quant incompatibility. Not blocking — CPU + NNAPI both work and
    are interchangeable.

  Embedder cost is comfortable. Mobile feasibility settled with
  significant headroom on flagship hardware; a 4-year-old mid-range
  device could be 10x slower and still pass.

  **PoC findings — retrieval pipeline (same device).**
  - **JS-side cosine scan + ranker + MMR**, pure-JS implementation:
    - Cosine scan scales linearly: ~24-30 µs per 384-dim dot
      product on Hermes. At 100k candidates × 3 query vectors,
      cosine alone is ~3 s.
    - MMR initially ~280 ms regardless of pool size (iteration
      overhead dominated FLOPs); rewrite using `Uint8Array` bitmap
      - incremental `maxSimToSelected[]` tracking dropped it to
        ~15-18 ms. ~17x speedup.
    - Cache-locality experiment with a contiguous flat
      `Float32Array(N×dim)` pool was **worse** than per-vector
      `Float32Array[]`, not better. Hermes pays a tax on
      offset-indexed typed-array access that exceeds whatever
      cache benefit a flat layout yields.
    - JS-only retrieval is comfortable up to ~10-15k effective
      candidates. At 50k it's ~1.5 s; at 100k ~3.5 s.
  - **`sqlite-vec` (bundled with `expo-sqlite` since SDK 55):**
    - Wired in via the standard plugin flag
      (`withSQLiteVecExtension: true`). Drizzle wrapper packages
      considered then rejected (`@aeriondyseti/drizzle-sqlite-vec`
      is single-version, no source link, ~zero downloads); Drizzle's
      `sql` template-literal escape hatch handles vec0 operations
      natively, which is the canonical pattern.
    - Per-query KNN against vec0: ~11 / 43 / 61 / 122 ms at 1k /
      10k / 50k / 100k. With three queries per pass, total
      retrieval (incl. embed and merge) is ~478 ms at 100k —
      ~5-8x faster than JS-side at large pools, comparable at
      1-10k.
    - Slower than the published 75 ms@100k benchmark — likely a
      mix of mobile ARM lacking AVX2 SIMD, expo-sqlite's bridge
      overhead, and our 3-query workload vs published 1-query.
    - **Insert cost:** ~600 µs/row → 60 s to populate 100k
      vectors. UX implication: bulk-population events
      (first-story embed, model-swap re-index) need progress
      indicators. Per-turn incremental writes are not a concern.
    - **Decision: vec0 is the canonical retrieval path for v1.**
      No JS-only fallback in production — splitting paths just
      for the early-game window where JS is competitive adds
      maintenance cost without real benefit.
  - **Multi-query KNN cost — pre-blend escape hatch (post-v1; see
    [Parked / post-v1](#parked--post-v1)).** Three separate KNN
    queries triple per-pass cost vs single-query. Pre-blending
    the three query vectors before KNN is mathematically rank-
    equivalent to weighted score-blend for L2-normalized embeddings
    (the original "vector-blend ≠ score-blend" framing was wrong on
    the math); the real trade-offs are recall at the top-K cutoff,
    loss of per-query debug visibility for tuning, and inability to
    express non-linear blends. Kept as an optionality lever for
    future high-dim-provider-on-mobile signal, not a v1 target.

  **Open — cross-device tier-finding.** PoC tested only the flagship.
  Tier-finding question (one model serves all device classes vs
  tiered selection per detected class) is genuinely unanswered.
  Demo will be distributed to additional testers to gather
  cross-device perf data. v1 ships with the curated default
  (`Xenova/all-MiniLM-L6-v2-q8`); the off-ramp (demote local to
  desktop-only / opt-in, leave provider as mobile default if low-end
  devices fail) remains on the table until cross-device data lands.

  **Open — production integration.** Production wiring is fully
  designed in [`model-management.md`](./model-management.md):
  catalog (with per-platform `default_ep`), onboarding, on-disk
  layout, download flow, license attestation, removal, embedder
  failures (lazy init, test button, embed-failure-as-blocking-
  error), staleness UI. v1-blocking work that remains is
  implementation: real downloader with SHA256 verification against
  catalog hashes, license-dialog wiring, Settings · Memory tab,
  test-button affordances, the staleness panel + top-bar pill, and
  the per-model EP override surface. No automatic provider-mode
  fallback in v1 — embed failures are resolved by the user
  (retry / switch embedder / roll back) per the lifecycle contract
  in [`retrieval.md → Compute lifecycle`](./retrieval.md#compute-lifecycle).

- **Per-story embedding provider id.** The schema has
  `stories.settings.embeddingBackend` (`provider | local`) and
  `embedding_model_id`, but no `embedding_provider_id`. When backend
  is `provider`, the system needs to resolve which provider
  (configured under `app_settings.providers`) supplies the embedding
  endpoint — users may run a different provider for embeddings than
  for narrative LLM calls. Schema delta: add
  `stories.settings.embedding_provider_id?: string` (required when
  backend is `provider`); mirror in
  `app_settings.default_story_settings`. UI surfaces in App
  Settings · Memory and Story Settings · Memory (provider dropdown
  grouped by configured providers, model dropdown filtered to that
  provider's embedding-capable models). Not routed through the
  Profiles tab — embedders share none of the LLM-profile parameter
  shape (temperature, max output, thinking, structured-output).

- **Memory probe affordance** — debug UI for "what was retrieved
  and why this turn." **Load-bearing for the empirical-tuning
  pass** — without it, calibrating decay rates, similarity
  thresholds, MMR diversity, chapter-boost magnitude against
  realistic-scale stories (thousands of happenings, tens of
  thousands of awareness rows;
  [scale assumptions](./retrieval.md#scale-assumptions)) is
  guesswork. Contract + simulator math + screen UX landed in
  [`probe.md`](./probe.md) and
  [`docs/ui/screens/memory-probe/memory-probe.md`](../ui/screens/memory-probe/memory-probe.md);
  what remains is implementation (capture writer, simulator
  module, screen wiring, schema migrations).
- **Lore-creation cap tuning** — default 3 lore creates per chapter
  is a starting guess. Real usage will tune the right cap (might
  need to be lower for tight worlds, higher for first chapters of
  rich-worldbuilding stories). Belongs in the same empirical
  calibration pass as the threshold tuning.
- **Matryoshka effective-dim selector** — designed; contract +
  truncation rules + screen wiring landed in
  [`retrieval.md → Matryoshka effective dim`](./retrieval.md#matryoshka-effective-dim)
  with schema delta in
  [`data-model.md`](../data-model.md) and UI surfaces in
  [wizard](../ui/screens/wizard/wizard.md#memory-cost--matryoshka-effective-dim),
  [Story Settings · Memory · Embedder](../ui/screens/story-settings/story-settings.md#embedder),
  and
  [App Settings · Story Defaults · Memory](../ui/screens/app-settings/app-settings.md#memory)
  - capability badge in
    [App Settings · Providers · Models](../ui/screens/app-settings/app-settings.md#models--split-by-capability).
    Implementation work that remains: client-side truncation +
    re-normalization in the embed pipeline, server-side `dimensions`
    parameter wiring per provider, capability detection from
    `/models` metadata, wizard cost-preview math.

### Parked / post-v1

- **Multi-axis salience.** Single-number `decay_resistance` collapses
  orthogonal relevance dimensions. Real signal (long stories where
  retrieval misses load-bearing facts in scene-mismatched contexts)
  triggers the design.
- **Pin contradiction reconciliation.** Auto-detection that a `death`
  pin is invalidated by a later "actually alive" reveal. v1 floor:
  manual unpin.
- **Spillover policy on per-type budgets.** Hard partitions in v1;
  cross-type spillover when one type underfills lands post-v1.
- **Polymorphic naming support.** Schema-level support for two
  distinct entities with the same name (without one being renamed).
- **Auto-promotion `retired → active`.** Agent-driven path; v1 is
  user-only.
- **Per-type query pools.** Different queries per candidate type
  (e.g. lore retrieved against thematic queries vs. happenings against
  scene queries). v1 uses uniform query bundle.
- **Cutaway / multi-scene entries** — full structural support for
  meanwhile-style prose with multiple scenes per entry. v1 ships
  single-scene-per-entry.
- **Cross-chapter semantic dedup of happenings** — phase 3e handles
  the within-chapter case (clusters happenings by similarity + cast
  - time, agent decides merge / keep distinct / delete redundant;
    awareness rows merge as a side effect). The residual case is
    happenings that describe related events across chapter
    boundaries — phase 3e operates on the closed range only, so
    cross-chapter related happenings stay distinct. Probably rare;
    parked until signal.
- **Lore-mgmt cross-arc callback detection** — agent at chapter
  close identifies "this chapter calls back to chapter 3" patterns
  and re-pins relevant old rows. Powerful but expensive (agent
  needs wide context window) and hard to do reliably (LLM
  judgment on cross-chapter relationships at scale). v1 relies on
  the high-similarity bypass + retrieval-frequency feedback to
  surface revivals organically. Lands if real signal shows
  callbacks consistently miss.
- **Storage-tier triggers** — periodic stale pruning of cold
  awareness rows, per-character awareness volume cap, retrieval-
  frequency-driven pruning. Not in v1; levers if testing shows
  the awareness-graph long tail genuinely bites.
- **Pre-blended query vector — escape hatch for high-dim provider
  on mobile.** Three-query KNN scales linearly with dim and triples
  per-pass cost vs single-query. For users running heavy provider
  embeddings (Qwen3-Embedding-8B at 4096-dim, OpenAI
  `text-embedding-3-large`) on mobile, retrieval-pass cost grows
  into multi-second territory at 100k pools. Pre-blending the three
  query vectors before KNN is mathematically rank-equivalent to
  weighted score-blend for L2-normalized embeddings (with
  per-batch-constant scaling — the original "vector-blend ≠
  score-blend" framing was wrong on the math). Real trade-offs:
  - **Recall at top-K cutoff.** Score-blend retrieves top-K from
    each query separately; candidates that excel at one query but
    average poorly still enter the candidate pool. Pre-blend
    operates on a single top-K of the blended query — those
    "specialist" candidates can fall off entirely. Mitigated by
    raising K, but recall recovery isn't free.
  - **Lost per-query debug visibility.** The empirical-tuning pass
    leans on the [memory probe](./probe.md) to inspect per-query
    similarity contributions. Pre-blend collapses three signals
    into one; "why was this row retrieved" gets murkier.
  - **Forecloses non-linear blends.** Pre-blend can only express
    linear combinations of query vectors. Future levers like
    per-query thresholds, max-of-cosines, or harmonic mean become
    impossible without going back to score-blend.

  Lands as a story-level toggle ("Use combined query — faster, less
  precise") if cross-device data shows mid-range mobile users with
  high-dim provider models hitting unworkable retrieval latency.
  Not v1.
