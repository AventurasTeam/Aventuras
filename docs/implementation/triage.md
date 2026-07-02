# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

### Composer-mode wrap: canonical reframe to in-code i18n

Decided in M2.6 (pack-engine) planning: composer-mode send-time wrap
(`Do` / `Say` / `Think` × `first` / `third`) is implemented in-code,
i18n-keyed, in
[Slice 2.5](./milestones/02-first-user-loop/slices/05-reader.md) — NOT
as pack/Liquid macros. The wrapped string is target-language user
content, but a pack is English-source with no per-language variant; an
in-code wrap keeps the `user-action-translation` phase fed clean
monolingual input. Slice 2.6 already dropped the wrap macros from scope.

Still needs the reframe (no single slice owns it):

- [`principles.md → Composer mode`](../ui/principles.md#composer-mode--send-time-transform-narration-aware)
  says wrapping is "driven by pack templates" — change to the in-code
  i18n model.
- [`architecture.md → Macros`](../architecture.md#macros--reusable-liquid-snippets-not-code-side-formatters)
  uses the composer wrap as a macro-as-formatter example — drop or
  recharacterize it.
- [`Milestone 2 → C2`](./milestones/02-first-user-loop/milestone.md#c2--pack-engine-render-surface)
  pins wrap macros into the pack and lists Slice 2.5 as a wrap consumer
  — remove the wrap clause; removing it likely also drops 2.5's only
  dependency on 2.6 (revisit the dep graph).

M2 is English-only (same-language short-circuit), so nothing here blocks
M2; the in-code implementation is Slice 2.5-owned and surfaces at 2.5
planning. Route the canonical reframe via aventuras-design or a focused
doc-amendment before Slice 2.5.

- **Story-delete cascade must drive asset trashing once refcount-trashing
  lands.** [Slice 2.4](./milestones/02-first-user-loop/slices/04-story-list.md)'s
  `deleteStory` cascade bulk-removes `entry_assets` rows but only drops the
  junction rows — it does **not** trash the now-orphaned `assets` (matching
  M1b/06-content's posture, since refcount-driven trashing is M4/M9 and the
  boot sweep is M9.3). Per the
  [trash-can pattern](../data-model.md#assets-images--future-media), removing
  the last `entry_assets` reference should set `pending_delete_at` + rename to
  `.trash`. When M4/M9 builds refcount-trashing, it must hook the **story-delete
  cascade path** for both the `entry_assets` junction removals **and** the
  `stories.cover_asset_id` field (cleared, or its row deleted, on story delete),
  not just the standalone entry/branch delete arms, or deleting a story with
  attached assets or a cover leaks blobs. No live impact in M2 (M2 stories carry
  no assets or covers). Route into the M4/M9 refcount-trashing slice's Open questions when
  that slice is authored.
- **Store hydrate/rehydrate seam — fold into the store namespace?** Sweep
  every store in `lib/stores/*` (`appSettingsStore`, `storiesStore`, the
  `working-set-store` factory stores, etc.) and decide a single rule: should
  `rehydrate(db)` be a **method on the store object** (`storiesStore.rehydrate(db)`)
  so the store owns its own refresh, instead of a separate free export sitting
  next to it in the barrel? Apply the answer consistently. Concrete cleanups to
  fold in while there: (1) `bootstrap.ts` inlines
  `hydrateAppSettings(() => readAppSettingsRow(ctx.db))`, which is byte-identical
  to `rehydrateAppSettings(ctx.db)` — switch boot to the convenience; (2) once it
  does, `hydrateAppSettings`(thunk) + `readAppSettingsRow` have no production
  callers, so app-settings can collapse to `appSettingsStore` +
  `rehydrateAppSettings` the way stories collapsed in 2.4 (drop the thunk + read
  from the public surface; point the boot-order test at the surviving symbol).
  Cross-cutting (stores layer + boot), no single slice owner.
- **Sweep every store for `readonly` guards on read-view types.** `storiesStore`'s
  `StoriesSnapshot` was returned from `getStories()`/fed to selectors with mutable
  `rows`/`openFailures`, so a caller could `getStories().rows.push(...)` and mutate
  store state in place — bypassing `set`, firing no subscriber notification. Fixed in
  2.4 by making the snapshot fields `readonly StoryRow[]` / `Readonly<Record<…>>`.
  At the end of M2, sweep `lib/stores/*` (`appSettingsStore`, the `working-set-store`
  factory stores, etc.) and apply the same guard wherever a store exposes a read view
  (getter return, selector input, public-export snapshot type): make array/record
  fields `readonly` so `.push`/`.sort`/index-assignment become compile errors at the
  call site. Array/record level is enough — deep-per-field readonly is overkill unless
  a consumer actually mutates a nested field. Cross-cutting (whole stores layer), no
  single slice owner.
