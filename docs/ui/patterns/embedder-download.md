# Embedder download dialog pattern

**Wireframe:** [`embedder-download.html`](./embedder-download.html) — interactive

Multi-state modal that walks the user through installing an
embedding model — license fetch + presentation, accept/decline,
download with progress, SHA256 verification, and the various
failure modes that can interrupt any of those steps. Three install
paths share the dialog: **curated catalog** (the default), **HF id
input** (power-user, fetches from any HuggingFace model that
exposes the right files), and **custom file import** (filesystem-
supplied).

Used by (single canonical component invoked from three surfaces):

- [Onboarding · Step 4 — Pick an embedder](../screens/onboarding/onboarding.md#step-4--pick-an-embedder),
  triggered when the user picks a curated entry and hits `Finish`.
- [App Settings · Embedding models · Add model](../screens/app-settings/app-settings.md#installed-local-models),
  triggered by `+ Add model` → curated catalog entry.
- [Story Settings · Memory · Switch embedder](../screens/story-settings/story-settings.md#memory-tab) →
  [Model swap UX](../../memory/retrieval.md#model-swap-ux),
  triggered when picking a non-installed curated entry as the
  story's new embedder.

Design context for what each step actually does on disk lives in
[`memory/model-management.md → Download flow`](../../memory/model-management.md#download-flow)
and
[`memory/model-management.md → License attestation`](../../memory/model-management.md#license-attestation).
This pattern doc owns the **dialog UI shape** — the host docs own
the data semantics, and the dialog uses the same machinery
regardless of caller.

## Why a pattern, not three copies

The dialog is invoked from three surfaces but the contract is
identical at every callsite: the host hands the dialog a catalog
entry; the dialog drives the state machine end-to-end and resolves
with `installed | declined | cancelled | error(reason)`. The host
takes the resolution and routes accordingly (onboarding seeds
defaults; App Settings adds to inventory; Switch embedder fires
re-index). Single component, single state machine, three
invocation sites — pattern doc carries the canonical shape.

## State machine

```
                    ┌──────────┐
                    │   open   │
                    └────┬─────┘
                         │ fetch model card
                         ▼
            ┌────────────────────────┐
       ┌────│  card-fetch in-flight  │────┐
       │    └────────────┬───────────┘    │
       │                 │ ok             │ network / 5xx / not-found
       │                 ▼                ▼
       │       ┌──────────────────┐  ┌──────────────┐
       │       │  license dialog  │  │ fetch failed │
       │       └──────┬───────┬───┘  └──────┬───────┘
       │       Decline│       │Accept        │ retry
       │              │       ▼              └────────┐
       └──────────────┘  ┌────────────┐               │
                         │ downloading│◄──────────────┘
                         └─────┬──────┘
                  cancel       │ all 3 files done
                  ┌────────────┘
                  │           ▼
                  │     ┌──────────────┐
                  │     │   verifying  │ (SHA256 per file)
                  │     └──────┬───┬───┘
                  │       ok   │   │ mismatch
                  │            ▼   ▼
                  │      ┌─────────┐ ┌──────────────┐
                  │      │  done   │ │ verification │
                  │      └────┬────┘ │   failed     │
                  │           │      └──────┬───────┘
                  │           │             │
                  ▼           ▼             ▼
              dismissed   resolved      dismissed
              (cancelled) (installed)   (error: hash-mismatch)
```

Resolutions handed back to the host:

- `installed` — model files written, `LICENSE.txt` + `.attestation`
  alongside per
  [model-management.md → Storage layout](../../memory/model-management.md#storage-layout).
- `declined` — license declined pre-download. No state change on
  disk, no acceptance recorded.
- `cancelled` — cancel hit during download or verification.
  Partial files deleted, no acceptance recorded.
- `error(reason)` — fetch / verify / disk failure. Detail surfaces
  in the dialog; host gets the reason for any logging or follow-up
  routing it owns.

## Per-state UI

### License dialog

The center of the flow. Renders the model card's license content
fetched **live** at the catalog entry's pinned
`huggingfaceRevision` (per model-management.md's defense against
post-curation edits).

```
┌─────────────────────────────────────────────────────────────┐
│ Install MiniLM-L6 (lightweight)                       ×     │
│ ─────────────────────────────────────────────────────       │
│ Source:  huggingface.co/Xenova/all-MiniLM-L6-v2-q8          │
│ Revision: abc123def456…                                      │
│ Size: 25 MB · 3 files                                        │
│                                                               │
│ License — Apache 2.0                                         │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Apache License                                           │ │
│ │ Version 2.0, January 2004                                │ │
│ │ ...                                                      │ │
│ │ <scrollable license text fetched live from the model   │ │
│ │  card>                                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│                            [ Decline ]  [ Accept & download ] │
└─────────────────────────────────────────────────────────────┘
```

- Source URL + revision hash visible so users can cross-check.
- License text scrolls inside a fixed-height region; no user-
  interaction-blocking inside the text.
- `Decline` resolves with `declined` immediately. No on-disk
  changes.
- `Accept & download` advances to the downloading state.

### Card-fetch in-flight

Brief loading state between trigger and license rendering. Live HF
fetch shouldn't take long but isn't instant.

```
┌─────────────────────────────────────────────────────────────┐
│ Install MiniLM-L6 (lightweight)                       ×     │
│ ─────────────────────────────────────────────────────       │
│                                                               │
│   Fetching model card from huggingface.co…                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

Cancel during this state resolves as `cancelled`.

### Fetch failed

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ Couldn't reach the model source                     ×     │
│ ─────────────────────────────────────────────────────       │
│ Aventuras tried to fetch the license from                    │
│ huggingface.co. The request failed:                          │
│                                                               │
│   Network unreachable (no response after 3 retries)          │
│                                                               │
│ The license is fetched live to defend against post-          │
│ curation edits — we can't proceed with a cached copy.        │
│ Check your connection and try again.                         │
│                                                               │
│                                  [ Cancel ]  [ Retry ]        │
└─────────────────────────────────────────────────────────────┘
```

Retry returns to the in-flight state and re-attempts the fetch.
Cancel resolves with `error(card-fetch-failed)`.

### Downloading

Three files (`model.onnx`, `tokenizer.json`, `tokenizer_config.json`)
download in sequence. Per-file progress + overall progress.
Resumable on network blip (continuation, not restart).

```
┌─────────────────────────────────────────────────────────────┐
│ Downloading MiniLM-L6 (lightweight)                  Cancel │
│ ─────────────────────────────────────────────────────       │
│                                                               │
│   model.onnx              ████████████░░░░░  72%   18 / 25 MB │
│   tokenizer.json          waiting…                            │
│   tokenizer_config.json   waiting…                            │
│                                                               │
│   Total: 18 / 25 MB · ~12 s remaining                        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

Cancel mid-download deletes any partial files and resolves as
`cancelled`. License acceptance is **contingent on completion** —
cancellation discards the not-yet-finalized acceptance, the user
re-accepts on a future retry. Per
[model-management.md → License attestation](../../memory/model-management.md#license-attestation).

### Verifying

After all three files arrive, SHA256 verification per file. Brief.

```
┌─────────────────────────────────────────────────────────────┐
│ Verifying MiniLM-L6 (lightweight)                            │
│ ─────────────────────────────────────────────────────       │
│                                                               │
│   ✓ model.onnx              hash matches                     │
│   ✓ tokenizer.json          hash matches                     │
│   …  tokenizer_config.json  verifying…                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

No cancel here — verification is fast and partial verification
isn't a meaningful state.

### Verification failed

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠ Verification failed                                  ×     │
│ ─────────────────────────────────────────────────────       │
│ One of the downloaded files doesn't match the expected      │
│ hash:                                                         │
│                                                               │
│   ✗ tokenizer.json   sha256 mismatch                         │
│                                                               │
│ This may indicate a corrupted download or an upstream        │
│ change the bundled catalog hasn't caught up to. The          │
│ partial install has been deleted.                            │
│                                                               │
│                                              [ Close ]        │
└─────────────────────────────────────────────────────────────┘
```

No auto-retry. Per model-management.md → Failure modes: SHA256
mismatch may indicate corruption or rotated upstream; we don't
silently retry. Close resolves with `error(hash-mismatch)`.

### Done

After verification passes, files are persisted with their
`LICENSE.txt` and `.attestation` artifacts. Brief success state
before auto-dismiss, or no separate state at all (dialog closes
immediately and the host surfaces success in its own UI — toast
in onboarding, list refresh in App Settings · Embedding models,
re-index trigger in Switch embedder).

## Custom HF id variant

A power-user path: instead of picking a curated entry, the user
types a HuggingFace model id (`<namespace>/<model>`) or pastes a HF
URL. The dialog fetches the model card + file listing live,
validates the model exposes the files we need, and then proceeds
through the standard license → download → verify flow.

The variant sits between curated (catalog-managed) and custom file
import (filesystem-supplied) on the convenience-vs-flexibility
axis: users get HF's auto-fetch without having to download files
manually, but without curated metadata (display name, dim,
size, recommended tags, pre-known SHA256s, default EP).

### State machine extension

Pre-license phase replaces curated's catalog-driven entry:

```
        ┌───────────────┐
        │ hf-id-input   │  user types <namespace>/<model> or pastes URL
        └────────┬──────┘
                 │ enter
                 ▼
        ┌──────────────────────────┐
   ┌────│ resolving (card + files) │────┐
   │    └──────────┬───────────────┘    │
   │               │ ok                  │ network / 5xx / not-found
   │               ▼                     ▼
   │         ┌──────────┐           ┌───────────────┐
   │         │  license │           │ resolve-failed│
   │         └──────────┘           └───────────────┘
   │                                     │ retry / cancel
   │     │ files missing for required shape
   │     ▼
   │ ┌────────────────────┐
   │ │ validation-failed  │ ──── close ────┐
   │ └────────────────────┘                │
   │                                       │
   └─── cancel ────────────────────────────┘
```

After license accept, the flow rejoins the curated path's
downloading → verifying → done states with two differences:

- **No pre-known SHA256s.** Hashes are computed during verify and
  stored in `.attestation`; nothing is checked against. The
  "verifying" state still shows progress per file but no per-file
  pass/fail (just hash computation).
- **EP picker** appears as a final step before download, since
  there's no catalog `default_ep` to fall back on. Same picker as
  custom-import variant; same warning copy.

### Validation rules

The dialog rejects models that don't satisfy the file-shape
contract before getting to the license dialog. Required files at
the model's repo root (or under `onnx/` for HF's standard ONNX
export convention):

- `model.onnx` (or `onnx/model.onnx`).
- `tokenizer.json`.
- `tokenizer_config.json`.

If any is missing, `validation-failed` shows:

> **This model doesn't have the required ONNX exports.**
> Aventuras needs `model.onnx`, `tokenizer.json`, and
> `tokenizer_config.json` at the repo root or under `onnx/`. Some
> HF models ship in Python-only formats (PyTorch / safetensors) —
> check the model card for ONNX export instructions, or try the
> curated catalog.

### Sharded ONNX

Larger ONNX models can split weights into a sidecar `model.onnx_data`
file referenced by `model.onnx`. The dialog detects this from the
file listing and fetches both. Embedder-sized models (typically
25-500 MB) usually fit in a single file, so this is rare.

### License copy when none specified

Some HF models lack a clear license declaration in their model
card. When the model card has no License section the license
dialog renders:

> **No license specified by the model author.** Proceed at your
> own risk — the user is responsible for compliance with whatever
> terms (if any) the author intends.

The user can still proceed; the warning is informational. The
attestation file records the empty-license state and the model
card's raw text for reference.

### Naming collision with curated

If the user types a HF id that matches an existing curated entry
(or an already-installed model), the dialog surfaces:

> **This model is already in your curated catalog.** Use the
> curated entry instead — you'll get pre-verified hashes and
> known metadata.

Routes the user to the curated picker. Doesn't double-install.

## Custom-import variant

The custom-file-import path (App Settings · Embedding models · Add
model · Import custom…) reuses the same dialog component but skips
the license-fetch state. Path:

1. User picks the three files from filesystem (handled by host
   before opening the dialog).
2. Dialog opens directly on a **confirmation state** (see below).
3. On Import, dialog runs smoke-test under the picked EP per
   [model-management.md → Custom file import](../../memory/model-management.md#custom-file-import),
   computes SHA256s, copies files into the model folder.

The confirmation state replaces the license dialog:

```
┌─────────────────────────────────────────────────────────────┐
│ Import custom embedding model                         ×     │
│ ─────────────────────────────────────────────────────       │
│ You're importing a custom model. By using it, you assert     │
│ that you have a license to do so. The file SHA256 hashes     │
│ are recorded for your reference.                             │
│                                                               │
│   Model id          my-org/my-finetune                       │
│   Files             model.onnx (42 MB)                       │
│                     tokenizer.json (1.2 MB)                  │
│                     tokenizer_config.json (3 KB)             │
│   Execution         [ cpu ▾ ]   ⚠ wrong choice may crash     │
│   provider                                                    │
│                                                               │
│                                  [ Cancel ]  [ Import ]       │
└─────────────────────────────────────────────────────────────┘
```

Import progresses through `validating → done` (validate via
smoke-test embed under picked EP). Validation failures surface
their own state: `validation-failed (smoke-test crashed under EP X)`
with a Cancel-and-pick-different-EP affordance routing back to the
EP picker.

The license-related states (fetch in-flight, fetch failed) don't
apply — there's no live license to fetch, and the user's
self-attestation doesn't need a hash check beyond the file SHA256s
already shown in the confirmation.

## Invocation contract

The host hands the dialog one of three init payloads:

- **Catalog entry** (curated path) — model id, file sources,
  expected SHA256s, `default_ep[platform]`, display metadata. The
  dialog skips file-listing validation (catalog already pre-
  verified) and uses the catalog default for EP unless overridden.
- **HF id** (power-user path) — a `<namespace>/<model>` string.
  The dialog resolves the model card + file listing live,
  validates the required files are present, then runs the standard
  flow with computed (not pre-known) SHA256s and a user-picked EP.
- **Import bundle** (filesystem path) — three file paths plus the
  user-picked EP. The dialog skips license fetch entirely; the
  user attests license at the confirmation step.

Plus a **resolution callback** — `(result) => void` — that fires
when the dialog resolves with one of the values listed under
[State machine](#state-machine). The host owns what to do with each
outcome.

## Mobile expression

Renders as a Modal at every tier per
[`overlays.md`](./overlays.md) and
[mobile/layout.md → Modal](../foundations/mobile/layout.md#modal).
Phone gets the modal with margin gutters (`max-w-[calc(100%-2rem)]`),
desktop gets a 560px-capped centered shape.

The license-text scroll region fills the viewport-height minus the
header and footer at every tier; touch scroll inside the region
works the same as desktop scroll.

`Cancel` button is always reachable — even when the dialog body
is scrolled, the action footer stays anchored at the bottom of the
modal frame.

## Accessibility

Standard modal contract: focus trap inside the dialog while open,
Escape closes (resolves as `cancelled` or `declined` per state),
title bound to `aria-labelledby`, license text region has its own
`aria-label` so screen readers can navigate into it. License text
is not paraphrased — it's read verbatim as fetched.

## Open items

- **License re-fetch on retry.** When the user cancels mid-
  download then re-opens for the same model, the license fetch
  re-runs (live; not cached). Acceptable cost. Caching the most
  recent fetch within a session would be a nice-to-have but adds
  complexity and risks the user agreeing to a stale snapshot.
  Park the optimization until real signal.
- **Pinned-revision invalidation.** When the catalog ships a new
  app version with a bumped `huggingfaceRevision` for an existing
  model, the dialog fetches the new revision on subsequent
  installs. Existing on-disk attestations record the older revision
  per
  [model-management.md → License attestation](../../memory/model-management.md#license-attestation);
  the dialog never disturbs them.
- **Driver effects for HF-id and import paths.** The container's
  `downloading` and `verifying` effects currently guard on
  `init.kind === 'catalog'`. The HF-id and import paths can enter
  `downloading` / `verifying` states via the reducer but no effect
  drives them through to completion. Wiring lands with the
  platform-specific driver implementations per consumer (Onboarding
  Step 4 lands first per
  [onboarding.md → Step 4](../screens/onboarding/onboarding.md#step-4--pick-an-embedder)).
- **`init` prop referential stability.** Three container effects
  depend on the whole `init` object reference. If a host re-renders
  mid-download with a structurally-equal but newly-allocated `init`
  object, the effect's cleanup arm cancels the in-flight download
  and the loop restarts from `files[0]`. The cancellation flag
  preserves correctness-of-state but resets user progress. Either
  narrow the effect deps to stable primitives (`init.entry.id`,
  `init.entry.revision`) or document a host requirement to memoize
  the `init` prop. Defer until a real consumer surfaces the
  regression.
