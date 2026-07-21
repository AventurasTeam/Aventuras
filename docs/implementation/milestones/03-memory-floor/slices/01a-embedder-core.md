# Slice 3.1a — Embedder core: vec0 tables, runtimes, catalog, creation gate

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one; M1.5 substrate + M2 wizard are
  merged prerequisites)
- **Blocks:** [Slice 3.1b](./01b-embedder-lifecycle.md),
  [Slice 3.3](./03-classifier.md) (disambiguation embeds),
  [Slice 3.4](./04-retrieval.md) (vec0 + query embeds).
  [Slice 3.6](./06-wizard-world-cast.md) pairs via the C5
  wizard-commit seam — doc-as-contract, not a gate.

## Goal

The embedding substrate: the per-type vec0 virtual tables (the one
schema-landing job M1.5 deliberately excluded), a single embedder
service with local-ONNX and provider backends behind lazy init, the
curated-catalog download flow with license attestation, the minimal
app-settings embedder surface, and the story-creation hard gate —
the wizard's Finish now embeds cast and lore inside its commit
transaction and blocks until an embedder is configured.

## Background

Retrieval compares vectors, so every story needs an embedder before
it has anything to retrieve — v1 makes it a hard requirement at
story creation rather than shipping a degraded LLM-only fallback.
The sqlite-vec extension itself has loaded since M1.2; this slice
adds the physical `*_vec` tables and the service that writes them.
M2.3's wizard already commits `embeddingBackend: 'local'` and an
`embedding_model_id` into fresh story settings; this slice makes
those values real. Downloads are curated: a bundled catalog pins a
HuggingFace revision and file hashes, and the license is fetched
live and attested per download. The full embedder-management tab is
M7.1; only the gate-required minimum ships here.

## Required reading

- [`retrieval.md → Embedding infrastructure`](../../../../memory/retrieval.md#embedding-infrastructure)
  — runtimes, logical schema, per-type vec0 physical layout,
  per-branch single-model invariant, `source_hash` tripwire.
- [`retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
  — sync-before-read contract, `embedding_stale` flag semantics,
  blocking-failure posture (this slice lands the helpers; 3.4 lands
  the sync stage).
- [`model-management.md → Curated catalog`](../../../../memory/model-management.md#curated-catalog),
  [`Storage layout`](../../../../memory/model-management.md#storage-layout),
  [`Download flow`](../../../../memory/model-management.md#download-flow),
  [`License attestation`](../../../../memory/model-management.md#license-attestation)
  — catalog shape, per-platform embedders root, fetch + verify +
  attest semantics, `@huggingface/hub` implementation note.
- [`model-management.md → Embedder failures`](../../../../memory/model-management.md#embedder-failures)
  — lazy init, test button, wizard-commit failure surface.
- [`model-management.md → Embedder config`](../../../../memory/model-management.md#embedder-config--where-it-lives-in-settings)
  — the three settings surfaces; only the gate-required subset
  ships here.
- [`ui/patterns/embedder-download.md`](../../../../ui/patterns/embedder-download.md)
  — the shipped `EmbedderDownloadDialog` per-state UI this slice
  wires.
- [`wizard.md → What Finish does`](../../../../ui/screens/wizard/wizard.md#what-finish-does--atomic-commit)
  and
  [`Embedder-unavailable on Finish`](../../../../ui/screens/wizard/wizard.md#embedder-unavailable-on-finish)
  — the embed-in-transaction exception to sync-before-read and its
  failure surface.
- [`data-model.md → App settings storage`](../../../../data-model.md#app-settings-storage)
  — `embedding_model_id` / `embedding_provider_id` /
  `embeddingBackend` placement.

## Scope: in

- **vec0 migration:** the five per-type table families at the
  bundled default's 384 dim (`entities_vec_384`, …) with `branch_id`
  partition key, `model_id` metadata column, and `source_hash`
  auxiliary column; other dims created lazily by the write helper
  (per-`(type, dim)` layout per
  [`retrieval.md → Storage`](../../../../memory/retrieval.md#storage),
  amended at planning). Creation via Drizzle's `sql` escape hatch
  per the PoC finding.
- **Embedder service module (C1):** lazy init; batched embed entry
  point resolving backend + model from story settings with app
  default; local backend via ONNX Runtime against the installed
  model folder (catalog `default_ep`, CPU-default posture);
  provider backend via the M2.1 provider layer's embedding
  endpoint; typed init-vs-call failures; vec0 write helper
  (vector + metadata + `source_hash`) and the per-row
  `embedding_stale` recompute-and-revalidate helper.
- **Catalog + download:** bundled catalog JSON (v1 model list is a
  planning decision); download flow wiring the shipped
  `EmbedderDownloadDialog` — live model-card fetch at pinned
  revision, license accept / decline / cancel semantics, resumable
  download, SHA256 verify, `LICENSE.txt` + `.attestation` writes,
  partial-file cleanup on every abort path.
- **Minimal settings surface:** installed-models list (catalog
  entries + install state), `Test embedder` (init + smoke embed +
  result surface), and the App Settings · Memory default selection
  (backend toggle + model pick). No custom import, no EP picker, no
  remove flow (M7.1).
- **Story-creation hard gate:** wizard Finish (and wizard entry)
  checks for a usable embedder configuration; blocked state routes
  to the settings surface and back.
- **Wizard Finish embed step (C5):** every `entities` / `lore` row
  in the commit embeds in-transaction; any embed failure rolls back
  the entire commit and surfaces
  `Couldn't initialize the embedder. [Retry] [Settings] [Cancel]`.
  Implemented against the M2 commit shape (lead entity only); 3.6's
  rows flow through unchanged.

## Scope: out

- Pre-retrieval sync stage and query embeds — 3.4 (consumes C1).
- Drain worker, model-swap flow, staleness UI, Matryoshka —
  [Slice 3.1b](./01b-embedder-lifecycle.md).
- Custom file import, per-model EP picker, remove flow, HF-id
  import, cross-story staleness aggregate — M7.1.
- Onboarding-flow embedder screen — M7.4 (the gate exists from this
  slice; the guided first-launch path comes later).
- Any embedding of `story_entries` prose — not embedded in v1 (scene
  digests are per-turn ephemeral).

## Acceptance criteria

- Migration applies idempotently on Expo (Android) and Electron
  desktop; the five 384-dim `*_vec` tables exist and accept an
  insert and KNN round-trip; the write helper lazily creates a
  non-default dim family (768) on first write (vitest against the
  desktop runtime; manual smoke on Android).
- With no embedder configured, opening the wizard surfaces the
  blocked state and routes to settings; after a curated download
  completes (license dialog shown, SHA256 verified, `.attestation`
  written), the same wizard path proceeds to Finish.
- Finish embeds every cast / lore row in the commit transaction —
  post-commit, every committed row has `embedding_stale = 0` and a
  vec0 counterpart; a fault-injected embed failure rolls back the
  entire commit (no stories / branches / entities / lore rows
  persist) and shows the retry surface (vitest on the transaction,
  manual smoke on the dialog).
- Decline leaves no files; cancel mid-download deletes partials and
  records no attestation; SHA256 mismatch aborts with the
  verification-failed message (vitest on the state machine, fixture
  server for the fetch paths).
- `Test embedder` reports success for a correctly installed model
  and a typed failure for a corrupted one, without crashing at boot
  (lazy init asserted — no embedder code runs before first call).
- Provider backend: a story with `embeddingBackend: 'provider'`
  embeds through the configured provider's endpoint and lands
  vectors in vec0 with the right `model_id` (vitest against a stub
  endpoint).

## Tests

- Vitest: vec0 round-trip + branch/model filtering; C1 service
  (backend resolution, typed failures, `source_hash` compute +
  revalidation); download state machine incl. abort paths; Finish
  transaction rollback on embed failure.
- Storybook: any new settings-surface compounds (the download
  dialog already has stories).
- Manual smoke: full download → create-story → play-a-turn on
  desktop + Android; kill-app-mid-download resume on desktop.
  Android verifies in-session network-blip resume only — a kill
  mid-download restarts the affected file from zero (staged
  `.part`, no corruption); cross-launch resume is descoped for v1
  (resolved at planning, 2026-07-20).

## Open questions

All three closed during implementation; resolutions are in
[Implementation notes](#implementation-notes) below.

- **Catalog v1 contents** — **resolved:** two entries, see
  [Catalog](#catalog). The question's original
  `Xenova/all-MiniLM-L6-v2-q8` id was wrong — quantization is a file
  choice inside the repo, not part of the model id.
- **`source_hash` physical placement** — **resolved:** vec0
  auxiliary column, see
  [Storage and schema](#storage-and-schema).
- **ORT packaging on Electron** — **resolved:** main process,
  behind an `embedder:*` IPC namespace mirroring the M1.2 DB
  service; see [Runtimes](#runtimes).

## Implementation notes

Resolved developer decisions and deviations worth carrying forward.
Traps that generalize beyond this slice landed in
[lessons-learned](../../../lessons-learned/README.md) instead.

### Storage and schema

- **Per-`(type, dim)` table families** (canon amended at planning,
  commit `926ca3a2`): the migration creates the five 384-dim
  families; other dims are created lazily by the write helper via
  `CREATE VIRTUAL TABLE IF NOT EXISTS` through an `execRaw` seam,
  outside the atomic ops batch. Verified on both platforms — the
  768 families materialized on first Gemma write.
- **vec0 enforces the primary key globally, not per partition**
  (verified live during planning). The same row id in two branch
  partitions is rejected, so rows carry a synthetic
  `<branch_id>:<id>` pk alongside the plain `id` metadata column.
- **`source_hash` is a vec0 auxiliary column** (`+source_hash`),
  resolving the placement canon left open.

### Runtimes

- **Desktop ONNX runs in the Electron main process** behind an
  `embedder:*` IPC namespace mirroring the M1.2 DB service, via
  `@huggingface/transformers`. Two Electron-specific traps had to
  be worked around at the pipeline call — see
  [Running ONNX inside Electron main](../../../lessons-learned/onnx-in-electron-main.md).
- **Every embedder runtime is lazily imported.** No ORT,
  transformers.js, or `react-native-quick-crypto` symbol is
  reachable at module-eval, because the `lib/embedder` barrel is
  imported by the config-presence gate that runs before any model
  is installed.
- **`onnxruntime-react-native` needs a two-part pnpm patch** —
  a Gradle 9 fix (upstream still references the removed
  `VersionNumber` at 1.24.3) and an autolinking config the package
  doesn't ship. The added file needs re-appending if the patch is
  ever regenerated
  ([why](../../../lessons-learned/pnpm-patch-drops-added-files.md)).

### Catalog

- **Two entries ship in v1**: `Xenova/all-MiniLM-L6-v2` at 384 dim
  (the mobile default) and `onnx-community/embeddinggemma-300m-ONNX`
  at 768 dim. Size, tags, pinned revision, and per-file SHA256s live
  in `catalog-data.json`.
- **EmbeddingGemma-300m survived on-device curation** on both
  desktop and Android at 768 dim, so the named fallback
  (`multilingual-e5-small`) was not needed and the entry is no
  longer a severable tail.
- Entries carry `config.json` (transformers.js fatally requires it)
  and, for sharded exports, the weights sidecar keyed by **the
  basename the ONNX graph references** — renaming it breaks
  loading.
- License text resolves in two tiers: standard HF tags fetch real
  license text from the pinned `choosealicense/licenses` dataset
  mirror; proprietary tags (`gemma`, `license: other`, none) fall
  back to the model card, labeled as such, with the card's dynamic
  `license_link` when present. The catalog maintains **no** license
  URLs — the developer ruled a hand-maintained license map
  infeasible.
- HuggingFace's documented endpoints are called directly rather
  than through `@huggingface/hub`; Range resume, incremental
  SHA256, and per-file progress all need raw `Response` control,
  and the SDK wraps the same URLs. Canon's implementation note was
  replaced accordingly.

### Surfaces

- **The entry gate is an AlertDialog over the wizard shell**, not a
  fullscreen takeover (canon left the shape open; matched to the
  autosave-continue precedent at device review). It renders only
  while the wizard screen is focused, and the shell renders
  immediately rather than swapping in a placeholder while the
  check resolves. The gate stays hard: Finish re-checks the config
  and every modal exit leaves the wizard.
- **The download dialog has no header ×.** Every state carries an
  explicit affordance, and a header close bypassed the machine's
  cancel path (partial-file cleanup). `DialogContent` gained a
  `hideCloseButton` prop; `DialogHeader` gained default right
  padding so other dialogs' titles clear their ×.
- The Embedding models tab ships only the gate-required subset;
  no remove flow, EP picker, or custom import until M7.1.

### Verification

Cross-platform smoke passed on desktop (Linux) and Android:
curated download with license attestation, wizard gate, story
creation embedding the lead inside the atomic batch, lazy 768
family creation, corrupted-model typed failure, in-session
network-blip resume, and a provider-backend embed with capability
detection. Two findings from that pass are recorded above; the
`source_hash` sign bug it exposed is in
[Known-answer vectors can share a blind spot](../../../lessons-learned/known-answer-vectors-share-blind-spots.md).
