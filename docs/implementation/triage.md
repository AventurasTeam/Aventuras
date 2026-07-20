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

- **Scoped coverage is not push-button reproducible.** The
  dual-project vitest setup (storybook browser + unit node) drops a
  single `lib/*` module from the merged `--coverage` report, and CLI
  `--coverage.include` overrides crash the storybook project loader.
  Slices that assert per-module line coverage (e.g.
  [Slice 2.8](./milestones/02-first-user-loop/slices/08-id-substitution.md))
  can only confirm the bar by inspection. A `lib`-only coverage
  script or project would make it verifiable on demand. Surfaced by
  Slice 2.8.
- **Wizard live-session loses draft provenance.** The auto-save
  `wizard_sessions` `'live'` singleton writes `storyId: null` and the
  `wizard_sessions.storyId` column is never read. So the sequence
  resume-a-draft → edit (autosave) → Cancel (session preserved) →
  Continue-session finishes as a **new** active story while the
  original draft survives (duplicate story + orphaned draft). Fix:
  thread the resumed `sourceDraftId` into `saveLiveSession`'s `storyId`
  and recover it in `loadLiveSession` / `onContinueSession`. Partly
  [Slice 2.4](./milestones/02-first-user-loop/slices/04-story-list.md)'s
  concurrent-trigger territory. Recoverable via delete; doc
  under-specifies the resume→cancel→continue interaction. Also fold in:
  suppress the 500 ms autosave debounce once Finish / Save-as-draft
  starts (a pending timer can recreate a stale `'live'` row just after
  `clearLiveSession`). Surfaced by Slice 2.3 final review.
- **Harden the draft-promote all-or-nothing test.** M2.3's
  `createStoryWithBranch` promote path (`replaceExistingStoryId`) is
  structurally atomic (one transaction), but its forced-failure test
  fails on `ops[0]` (the DELETE, via a stray-branch FK), so it proves
  "first-op-rejected", not "an already-executed delete is rolled back".
  Forcing a post-delete op to fail is blocked today by the fresh-UUID
  design (no PK can collide) and the eager `vitest.setup` domain-load
  (can't `vi.mock` `generateId`). Revisit if a deterministic
  post-delete failure becomes reachable. Surfaced by Slice 2.3.
- **Calendar summary "year" row doc/schema drift.** The
  [calendar-picker pattern doc](../ui/patterns/calendar-picker.md)
  shows a summary row `year · rule: Gregorian leap`, but the
  `earth-gregorian` built-in carries the leap inside `day.table.leap`
  (indexed by year), not as a top-level `rule` on the `year` tier — so
  M2.3's generic summary formatter can't mechanically derive that
  string without special-casing "Gregorian". Reconcile the doc example
  to the actual schema shape (or add the derivation the doc implies).
  Surfaced by Slice 2.3.
- **Wizard assist prompts hard-code their JSON schema.** The wizard-group
  templates (`WIZARD_OPENING`, `WIZARD_TITLE_CHIPS`, `WIZARD_DESCRIPTION`)
  hand-write the "Return a JSON object with these fields…" block as prose,
  while the reply is validated against a separate Zod schema
  (`openingOutputSchema` etc.). Two sources of truth that drift silently — a
  renamed or added schema field won't update the prompt. Derive the field
  list from the Zod schema instead (zod-to-json-schema, a small schema→prose
  renderer, or native structured outputs where the provider supports them).
  **Reconcile at the end of M2**, alongside the pack/render-surface work.
  Surfaced by Slice 2.3.
- **Theme is never persisted/restored, and Generate can flip it.**
  `ThemeProvider` seeds its active theme once from `useColorScheme()` into
  local state and never reads or writes `app_settings.themeId` — the column
  is effectively dead (schema default `'system'`, yet a runtime value such as
  `'aventuras'` can exist with no write path from settings). Nothing calls
  `setTheme` at runtime outside the Storybook theme-picker, yet pressing
  Generate in the wizard AI-assist popover was observed flipping light→dark.
  The assist code touches nothing theme-related, so a provider remount
  re-seeding from `useColorScheme()` is the likely trigger — needs a live
  desktop repro to confirm. Fix: wire the provider to persisted `themeId`
  (restore on boot, persist on change) and identify the remount. Pre-existing
  (the theme system predates M2.3); no single slice owns it. Surfaced by
  Slice 2.3.

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
- **Native `crypto.randomUUID` uses `Math.random`, not a CSPRNG.** ULID was
  dropped, so every id now flows through `generateId` → `crypto.randomUUID`, and
  the `lib/polyfills` shim fills Hermes's missing global `crypto` with a
  `Math.random`-backed v4 `randomUUID` (native only; web, Electron, and Node keep
  their secure `crypto`). Fine for these local, single-user primary keys — they
  need uniqueness, not unpredictability. Revisit only if an id ever becomes
  externally exposed or guessing-sensitive, or a real crypto need appears (e.g.
  asset sha256 content-addressing): point the shim at `expo-crypto`'s `randomUUID`
  — one file, one native dep, a dev-client rebuild. Cross-cutting, no single slice
  owner.
- **Per-turn turn-capture stamping is not kind-gated.** `orchestrator.handleEvent`
  calls `turnCaptureSink.recordTargetEntry` on any `createStoryEntry` delta. Correct
  while `per-turn` is the only registered pipeline kind, but `recordTargetEntry` sets
  `anchorEntryId`+`targetEntryId` with per-turn semantics; a future `chapter-close`
  (M5.2) or other kind that emits a `createStoryEntry` delta would mis-stamp its run's
  anchor. Gate on `run.kind === 'per-turn'` (or "beginTurn set no anchor") when the
  second such kind lands. Surfaced by Slice 2.7.
- **`submitTurn` tail read + the M2 metadata placeholder shape.** (a) `submit-turn.ts`'s
  tail read has no `kind` filter: an un-cleared `system`-error tail (metadata null) would
  reset the inherited `worldTime` to 0 (position unaffected). Only reachable via a second
  `submitTurn` caller — the sole caller (the reader) clears the system tail before submit.
  Harden (worldTime from the last non-system entry; position from overall MAX) before a
  second caller lands. (b) The `{ sceneEntities: [], currentLocationId: null, worldTime }`
  placeholder is now hand-built in both `submit-turn.ts` (user_action) and `pipeline.ts`
  (ai_reply); extract a shared helper when M3's classifier fills real scene/location
  values. Surfaced by Slice 2.7.
- **Buffer-size floor + entries-hydrate-window duplication.** (a)
  `buildPerTurnGenerationContext`'s `slice(-partialChapterBuffer)` returns the whole
  buffer when the value is 0 (`slice(-0)`); no M2 path sets 0, but the story-settings UI
  edits this field later — add a `>= 1` floor (schema `.min(1)` or a guard) when that UI
  ships. (b) The last-50-desc-then-reverse entries-hydrate window is duplicated across
  `loadOpenStory` and the reader's `reload()` with an independent `50` under two constant
  names; a shared `lib/actions/story-entries` helper removes the drift risk. Surfaced by
  Slice 2.7.
- **`narrativePhase` store-consistency defense-in-depth.** The phase guards
  `currentStoryStore.branchId === ctx.branchId` but reads the entry buffer + worldTime tail
  from the separate `entriesStore` (whose `loadedBranch` it never asserts). Not reachable
  in M2 (both stores track the single mounted branch; the branch-guarded patcher never
  moves `loadedBranch`), but a future multi-branch/background path could desync them into a
  silent degenerate prompt. Assert `entriesStore.getLoadedBranch() === ctx.branchId`, or
  read the buffer from `ctx.db`. Surfaced by Slice 2.7.
- **Corrupt-config story open has no interim user feedback (pre-2.10).** `openStory` now
  returns a resolved `{ status: 'open-failed' }` on a config parse failure, which
  `runAction`'s rejection-only toast can't surface — so a corrupt-config tap is silent
  except the `logger.error` + the `openFailures` store write.
  [Slice 2.10](./milestones/02-first-user-loop/slices/10-recovery-ui.md) owns the
  parse-failure badge that renders this; confirm 2.10 also covers the tap-with-no-feedback
  interim (or accept silent-until-badge). Surfaced by Slice 2.7.
- **`generation-pipeline.md → New-entity emission` "(or piggyback)"
  parenthetical contradicts the memory write-set canon.** The section
  opens "The classifier (or piggyback) creating a brand-new entity…", but
  [`cadence.md → Concurrency`](../memory/cadence.md#concurrency) and
  [`piggyback.md`](../memory/piggyback.md) give piggyback zero creation
  rights — creation is classifier-only (disambiguation lives there by
  design). Surfaced by the M3 promotion audit (2026-07-20). The
  id-allocation mechanic the section describes is correct either way; the
  fix is dropping or rewording the parenthetical. Canonical edit — route
  through a design / cleanup pass, not a planning commit.
