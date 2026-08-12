# Slice 3.1b — Embedder lifecycle: drain, swap, staleness UI, Matryoshka

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.1a](./01a-embedder-core.md) (the C1
  service every piece here extends);
  [Slice 3.11](./11-story-settings-shell.md) — partial: only the
  embedding-status panel's host section waits on the shell (C7);
  swap flow, drain worker, and Matryoshka proceed regardless
- **Blocks:** none as a build gate — 3.4 imports this slice's
  swap-dialog open action per C8 (doc-contract; 3.4's Retry path
  tests independently and the switch routing verifies at
  integration)

## Goal

The lifecycle machinery around the core embedder: the opportunistic
`embedding_stale` drain worker, the crash-safe stage-then-flip
model-swap flow with its story-open resume / cancel prompt, the
two-surface staleness UI (top-bar pill + Settings · Memory
resolution panel), and the Matryoshka effective-dim machinery —
`effectiveDim` resolution with truncation + renorm at every
embed-write, plus the wizard step-5 memory-cost disclosure.

## Background

The core slice makes embeds work; this slice makes them survivable.
Rows dirtied while the embedder is unavailable accumulate as
`embedding_stale = 1` and need a worker that drains them once
conditions allow — a warm-cache optimization, never an excuse to
ignore failures (the blocking sync stage in 3.4 stays the
contract). Swapping a story's embedding model invalidates every
stored vector, so the swap is a non-destructive re-embed staged
next to the old vectors, then an atomic flip — resumable or
cancellable after a crash via the `embedding_swap_target` marker
(the settings field landed in M1.5). Matryoshka-trained provider
models let a story store truncated vectors at a fraction of the
cost; the capability flags already ship in the M1.5 app-settings
Zod, and `stories.settings.effectiveDim` is locked at creation.

## Required reading

- [`retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
  — the worker's role relative to the blocking sync stage.
- [`retrieval.md → Model swap UX`](../../../../memory/retrieval.md#model-swap-ux)
  — the three-option dialog, stage-then-flip transactions,
  crash-recovery resume / cancel, second-swap block, the standalone
  re-index button.
- [`retrieval.md → Matryoshka effective dim`](../../../../memory/retrieval.md#matryoshka-effective-dim)
  — schema, capability flags, truncation contract (truncate +
  re-normalize; server-side `dimensions` where supported), defaults,
  edge cases.
- [`model-management.md → Staleness UI`](../../../../memory/model-management.md#staleness-ui)
  — the resolution panel and the top-bar discovery pill.
- [`model-management.md → Removal`](../../../../memory/model-management.md#removal)
  — the recovery path staleness UI serves (the remove flow itself is
  M7.1; the panel must still handle "model missing" as a reason).
- [`wizard.md → Memory cost — Matryoshka effective dim`](../../../../ui/screens/wizard/wizard.md#memory-cost--matryoshka-effective-dim)
  — the step-5 disclosure: visibility conditions, curated ladder,
  custom dim, platform-aware suggestion, storage-only preview.
- [`probe.md → Embedding model swap`](../../../../memory/probe.md#embedding-model-swap)
  — captures stay valid across swaps; nothing here touches them.

## Scope: in

- **Drain worker:** between-turns opportunistic pass over
  `WHERE embedding_stale = 1` (partial index assumed from M1.5
  schema; verify) through the C1 service; backs off while the
  embedder is unavailable; never surfaces errors itself (the sync
  stage owns blocking UX).
- **Model-swap flow:** the three-option AlertDialog (re-index /
  keep / skip-with-relabel) fired from the switch-embedder action;
  the dialog-open action is exported per C8 (name fixed in this
  slice's first commit — 3.4's sync-failure surface imports it);
  stage-then-flip per canon — swap-start
  marker transaction, phase-1 foreground re-embed with progress
  ("re-indexing X / N — retrieval limited"), phase-2 atomic
  DELETE-old + settings flip + marker clear; cancel path deleting
  staged NEW vectors; story-open resume / cancel prompt while
  `embedding_swap_target` is set; "Change embedding model" disabled
  while set; standalone "Re-index this story now."
- **Staleness UI:** the per-story embedding-status resolution panel
  (stale count, reason, `Switch embedder` action) registered into
  the Story Settings shell's Memory tab per C7
  ([Slice 3.11](./11-story-settings-shell.md) hosts), and the
  top-bar error-state pill in affected stories routing to that
  panel.
- **Matryoshka machinery:** `effectiveDim` resolution inside the C1
  service — truncate to N + re-normalize on every stored vector and
  every query embed; server-side `dimensions` parameter where the
  provider supports it; dim encoded in the target vec0 table
  family; re-index reuses the story's stored dim.
- **Wizard step-5 memory-cost disclosure:** conditional visibility
  (provider backend + `matryoshkaSupported`), curated-ladder radios
  with platform-aware suggestion, `Custom…` input with validation
  gate on Finish, storage-only cost preview; writes
  `stories.settings.effectiveDim` at Finish (the third
  Finish-transaction toucher pinned in C5; step 5 is co-edited by
  3.6a's opening refine / regenerate in a non-overlapping region).

## Scope: out

- Blocking sync-stage UX (the Retry / Switch / Roll-back failure
  surface) — 3.4 owns the stage; the switch action routes into this
  slice's swap dialog.
- Model removal flow and cross-story staleness aggregate — M7.1.
- Per-story EP override — parked.
- Local-model truncation — canon scopes Matryoshka to provider
  mode.

## Acceptance criteria

- Rows flagged stale while the embedder is down are drained by the
  worker after the embedder recovers, without user action; the
  drained rows' vectors match a direct embed (vitest with a
  fault-injectable service).
- Full swap: re-index N rows, verify old-model vectors gone,
  new-model vectors present, `embedding_model_id` updated, marker
  cleared — one atomic phase-2 transaction (vitest).
- Kill mid-phase-1; reopening the story surfaces resume / cancel;
  resume skips rows that already have NEW-model counterparts and
  completes; cancel deletes NEW rows and keeps the story on the old
  model (vitest on marker states + manual smoke for the kill).
- Skip-with-relabel updates the recorded id without re-embedding
  (vec0 row identity is rewritten in SQL, since `model_id` is part
  of the vec0 pk) and shows the user-assertion disclaimer.
- With a Matryoshka-capable provider model and `effectiveDim = N`:
  stored and query vectors are length-N and unit-norm (float
  tolerance); a non-Matryoshka story stores native dim (vitest).
- Wizard disclosure appears only under its two visibility
  conditions; custom-dim validation blocks Finish out-of-range;
  the chosen dim lands in `stories.settings.effectiveDim`.
- Staleness pill appears in a story with stale rows, routes to the
  resolution panel, and clears once the drain empties the set.

## Tests

- Vitest: worker drain + backoff, swap state machine (all marker
  transitions incl. crash-resume matrix), truncation + renorm math,
  effective-dim persistence.
- Storybook: resolution-panel compound, swap dialog states,
  memory-cost disclosure.
- Manual smoke: kill-mid-re-index on desktop; staleness pill
  round-trip on Android.

## Open questions

All four planning-time questions (worker trigger, phase-1 progress
host, same-dim staging under the two-part vec0 pk, multi-family
vector cleanup) were resolved in slice planning on 2026-07-24; the
decisions are recorded under Implementation notes below.

Two questions opened during review on 2026-07-28. The
target-threading one was resolved the same day and its decision is
under Implementation notes below; the dim-ceiling one is resolved
below, with its remaining unprobed-model residue carried to M7.

- **Custom effective dim is bounded only once the model has been
  probed.** Canon specifies `1 ≤ N ≤ native_dim`
  ([`wizard.md`](../../../../ui/screens/wizard/wizard.md#memory-cost--matryoshka-effective-dim),
  [`retrieval.md`](../../../../memory/retrieval.md#matryoshka-effective-dim)).
  `matryoshkaSupported` and `matryoshkaDims` are independent flags —
  a model can pass the visibility gate advertising no ladder at all —
  so the ladder cannot stand in for the ceiling.

  **Direction (updated 2026-07-28):** native-dim probing and
  persistence landed as an M3.1b review followup: selecting a provider
  model probes once when its cached capability has no `embeddingDim`.
  The Custom control's native upper-bound UI and curated-ladder editing
  remain deferred to M7. Ladders are most likely manual user input as
  an advanced feature, with auto-detection plausible on top.

  **Resolved (2026-07-29, PR #401 review):** the probe made the
  ceiling knowable, so `capabilities.embeddingDim` now bounds the
  pick at both ends of the wizard. `validateCustomDim` takes an
  optional `nativeDim` and rejects above it; Finish runs
  `clampEffectiveDim`, which resolves an over-ceiling dim to `null`
  (native) rather than rejecting — the disclosure is collapsed by
  default and hidden on a non-applicable model, so a working state
  carrying a stale pick would otherwise fail an invisible field.
  Resolving to `null` also suppresses a `serverSide` `dimensions`
  hint the provider would reject. An UNPROBED model still has no
  ceiling and stays permissive; that residue is what M7's
  upper-bound UI closes.

## Implementation notes

Resolved developer decisions (slice planning, 2026-07-24):

- **vec0 pk widened to `<branchId>:<id>:<modelId>`** — widens the
  two-part pk recorded in
  [Slice 3.1a's notes](./01a-embedder-core.md#implementation-notes),
  so phase-1 swap staging inserts NEW-model rows next to OLD-model
  rows. All deletes go by real columns (`branch_id`, `id`,
  `model_id`), never by pk string, so pre-widen rows stayed readable
  and no destructive migration was needed. Canon updated
  ([`retrieval.md → Storage`](../../../../memory/retrieval.md#storage)
  and `data-model.md`).
- **Drain trigger** — pipeline-idle events (`run_complete` with no
  active run) plus a story-open kick; capped backoff (5 s / 30 s /
  120 s) while the embedder is unavailable. Embedder-recovery kicks
  (after test-embedder success or a download) are a ready seam
  (`kickStoryDrain`) deliberately left unwired to those surfaces.
  A kick received while another story's async pass is active is
  retained and scheduled as soon as that pass releases single-flight;
  it is not dropped at the `running` guard. An idle note defers to a
  retry already armed for the SAME story, so a story emitting idle
  events faster than the ladder cannot retry a down embedder at the
  idle cadence; a kick still overrides, being the explicit "the cause
  may be gone" signal.
  The worker drains only the open branch; the blocking sync stage
  covers everything else on read.
- **Phase-1 progress host** — inline in Story Settings · Memory;
  the story-open resume prompt routes there before resuming. The
  "upgrade to current default" story-open prompt was deferred to
  the triage inbox.
- **Server-side `dimensions`** — sent only when the story has
  `effectiveDim` and the model's `matryoshkaSupported` flag is set;
  client-side truncate-and-renorm runs unconditionally, and the
  service clamps to `min(effectiveDim, native)`. The dim guard
  accepts either native or effective dim when the param was sent.
- **Per-row vector cleanup** — `deleteVecOps` sweeps every existing
  dim family of the kind by columns (mirrors `deleteBranchVecOps`);
  partial indexes on `embedding_stale = 1` landed for all five
  embeddable tables (verified missing from M1.5).

Notable deviations and constraints for future slices:

- **Relabel rewrites vec0 identity in SQL** (insert-select with the
  new pk and `model_id`, then delete-old, plus a relabel-wins
  pre-delete of leftover target-model rows) — no re-embedding, but
  not "vec0 untouched"; canon's relabel wording was amended to
  match. A pure settings relabel would orphan every vector behind
  the `model_id` KNN filter.
- **Same-model, same-dim re-index is upsert-in-place** — one vector space, so
  partial progress is harmless; resume re-embeds everything
  (idempotent), and both vector deletes are skipped: the phase-2
  old-model delete _and_ the cancel path's staged-row delete, since with
  `target === current` the "staged" rows are the story's only vectors and
  deleting them would wipe the vector space rather than unwind a stage
  (found by manual smoke, 2026-07-25).
- **Cancel flags only the rows a cancel actually dirties**, not all
  five tables. Cross-model flags the staged set (staging cleared their
  flag, but it described the old-model vector being reverted to);
  same-model flags only the not-yet-re-embedded tail. Blanket flagging
  claimed rows were pending whose vectors were current, and the drain
  re-embeds anything flagged — no `source_hash` revalidation runs on
  that path — so a cancel silently completed the re-index it had just
  cancelled (found by manual smoke, 2026-07-27). A crash-recovered
  same-model cancel keeps the blanket flag: with `target === current`,
  a re-embedded row is indistinguishable from an untouched one.
- **Same-model id can still be cross-dimension.** The swap marker
  snapshots both storage families. Cancellation deletes only the
  staged target family and re-derives touched-row staleness from the
  preserved source family; crash recovery therefore does not confuse
  a provider/local same-id move with an in-place re-index.
- **Swaps cross backends** — the picker offers the app's provider
  embedding model to a local-backend story, so a swap target is a
  `{ modelId, backend, providerId }` triple rather than a bare model id
  (found by manual smoke, 2026-07-25: resolving a provider model against
  the story's own backend failed as `unknown-local-model`). The marker
  carries the target's backend and provider id unconditionally, since crash
  recovery has only the marker to resolve from, and phase-2 flips all three
  keys together. An absent `embedding_swap_backend` is therefore only ever a
  marker written before this change; it reads as "same backend as the story",
  so those resolve unchanged without a migration. Canon amended
  ([`retrieval.md → Model swap UX`](../../../../memory/retrieval.md#model-swap-ux))
  plus the `data-model.md` settings shape. Settings transitions moved to
  `json_patch` because these writes must also _clear_ a key (a local
  target carries no provider id) and merge-patch deletes on null where
  `json_set` would write a JSON null the settings Zod rejects. The target
  travels whole from the picker to the settings write — `SwapCandidate`
  carries one, `onReindex` / `onRelabel` hand one back, and
  `embeddingTargetKey` is the identity everything keys, compares and
  React-keys on. A model id installed locally _and_ offered by the
  provider is therefore two selectable rows told apart by a source label,
  rather than one row with the other copy unreachable; `isCurrent`
  compares the same triple, so only the variant a story actually runs on
  is disabled. Relabel's vec identity rewrite stays model-id-scoped — an
  unchanged id leaves every vector in place — while its settings write is
  not, so "same model, now served elsewhere" is expressible at all.
  **The triple deliberately stops short of vec row identity**
  (`vecRowPk`): vectors from the same weights are interchangeable
  whichever backend served them, which is the premise relabel rests on,
  so widening the pk would orphan exactly what relabel exists to keep.
- **Swap concurrency** — the engine takes resolved inputs and does
  not enforce single-flight; the app-deps layer serializes per
  story and owns the callback guards. `cancelRequested` is a
  deliberate single-swap global, cleared at operation boundaries.
- **`effectiveDim` is gated at wizard Finish** on current
  matryoshka applicability, so a stale mid-session pick silently
  falls back to native instead of truncating a non-MRL model's
  vectors. The settings schema now requires a positive integer.
  Activating Custom immediately validates and applies its current
  draft: blank/invalid drafts block Finish, while reselecting a valid
  retained draft restores that value instead of committing a prior
  ladder choice.
- **Provider native dimensions are durable capabilities.** Successful
  provider probes persist `embeddingDim`; App Settings and the
  per-story target picker ensure it on selection, and swap/wizard
  resolution threads it as `providerDim`.
- **Resume-prompt deferral is context-scoped.** "Later" suppresses the
  current story only while that story stays open with the same pending
  marker. Navigation or marker resolution clears the deferral, so a
  later interruption prompts again.
- **C8 caveat carried to 3.4** — `openEmbedderSwapDialog` only has
  a mount host in the story-settings route; a pointer question was
  added to [Slice 3.4](./04-retrieval.md#open-questions).
- **E2E** — the cross-model swap re-index path is uncovered end to
  end (triaged); the staging engine is covered by same-model
  re-index plus the vitest marker matrix, and dialog wiring by the
  relabel path.
- **Manual smoke — desktop kill-mid-re-index, 2026-07-25 and
  2026-07-27.** Ran; it is the evidence behind the two acceptance
  criteria vitest and E2E do not reach. It found the same-model
  cancel wipe, the blanket cancel re-flagging, and the cross-backend
  resolution failure — all three written up under the deviations
  above — plus five entries in
  [triage](../../../triage.md) dated to the same runs.
- **Manual smoke — Android staleness-pill round-trip: not yet run.**
  The remaining acceptance criterion with no automated coverage;
  E2E is desktop-only by
  [testing.md](../../../../testing.md#e2e-target-desktop-only), so
  nothing else exercises it.
