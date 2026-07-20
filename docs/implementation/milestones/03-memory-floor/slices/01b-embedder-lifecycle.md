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
  provider supports it; dim recorded per row; re-index reuses the
  story's stored dim.
- **Wizard step-5 memory-cost disclosure:** conditional visibility
  (provider backend + `matryoshkaSupported`), curated-ladder radios
  with platform-aware suggestion, `Custom…` input with validation
  gate on Finish, storage-only cost preview; writes
  `stories.settings.effectiveDim` at Finish (the third
  Finish-transaction toucher pinned in C5; step 5 is co-edited by
  3.6's opening refine / regenerate in a non-overlapping region).

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
- Skip-with-relabel updates the recorded id without touching vec0
  and shows the user-assertion disclaimer.
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

- **Worker trigger** — timer-based between turns vs hooked on
  pipeline-idle events; pick at planning (must not contend with an
  in-flight sync stage).
- **Progress UI host for phase-1** — inline panel in Story
  Settings · Memory vs the generation-status pill; canon says
  foreground job with progress indicator, host unpinned.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
