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
- **Every future model-removal path must evict the native session cache.**
  `lib/embedder/local/runtime.native.ts` holds a lazy `bundles`
  `Map<modelId, SessionBundle>`; a removed then re-downloaded model reuses
  its dir, so without eviction the cache keeps serving inferences from the
  deleted model — and the resulting vectors land tagged with the _new_
  model id, so nothing marks them for re-embedding. The hook now exists
  (`evictBundle`) and is wired into the native driver's `deletePartial`,
  mirroring desktop's `evictPipeline`; what remains is that the M7.1
  model-remove flow, and any other future deletion path, must call it too.
  Nothing enforces that mechanically. Surfaced by M3.1a implementation
  (2026-07-20), partially resolved during M3.1a review (2026-07-21).
- **The `onnxruntime-react-native` patch carries two upstream gaps worth
  reporting.** `patches/onnxruntime-react-native.patch` drops a Gradle-9
  incompatibility (`VersionNumber`, removed in Gradle 9, guarding a fbjni
  fallback that only applies below RN 0.71) and adds the
  `react-native.config.js` the package omits, without which RN autolinking
  skips it and `NativeModules.Onnxruntime` is null at runtime. Both are
  upstream bugs, not app-specific workarounds, so the patch has to be
  re-verified on every ORT-RN bump until they land upstream. Decide whether to
  file them against microsoft/onnxruntime. Surfaced by M3.1a review
  (2026-07-21).
- **Custom-import file set may need `config.json` on desktop.**
  [`model-management.md → Custom file import`](../memory/model-management.md#custom-file-import)
  specifies three files (`model.onnx`, `tokenizer.json`,
  `tokenizer_config.json`), but M3.1a found transformers.js fatally
  requires `config.json` to build a pipeline, which is why the curated
  catalog entries carry it. The native runtime constructs its tokenizer
  directly and does its own pooling, so it may not need the file at all —
  making the required set platform-dependent, which the custom-import
  spec doesn't model. Resolve when M7.1 plans the import flow; verify the
  native requirement rather than assuming symmetry. Surfaced by M3.1a
  device review (2026-07-21).
- **Story settings has no unset affordance for optional keys.**
  `updateStorySettings` ignores `undefined`-valued patch keys, so an
  explicit `undefined` reads as "leave untouched" rather than "clear
  this key". The three optional fields in
  [`stories.settings`](../data-model.md#story-settings-shape) —
  `embedding_swap_target`, `embedding_provider_id`, `effectiveDim` —
  therefore have no clear path through the action. Nothing reads or
  writes them today, so nothing regresses; but
  [Slice 3.1b](./milestones/03-memory-floor/slices/01b-embedder-lifecycle.md)
  clears `embedding_swap_target` atomically at its swap phase-2 commit
  and will need an explicit affordance (a `null` sentinel, or a
  dedicated clear action). The shape is already specced:
  [`retrieval.md → Model swap UX`](../memory/retrieval.md#model-swap-ux)
  writes that commit as
  `UPDATE stories SET settings = jsonb_remove(settings, '$.embedding_swap_target')`.
  Suggested shape is a `StorySettingsPatch` type distinct from
  `Partial<StorySettings>`, widening those three keys to `T | null`
  with `null` meaning clear and `undefined` still meaning leave
  untouched — deliberately left to 3.1b, which owns the semantics and
  is the only consumer. Nullable fields are unaffected — the filter
  drops only `undefined`, so `null` still writes. Resolved for the
  swap flow 2026-07-24 by dedicated raw json ops in
  `lib/db/stories/settings-ops.ts` (`json_set`/`json_remove`, committed
  atomically with vec0 ops); the swap flow never routes through
  `updateStorySettings`, so the `StorySettingsPatch` widening remains
  unneeded until some other writer needs a clear affordance through the
  action layer. Surfaced by M3.11 Task 1 (2026-07-22), scoped to 3.1b
  2026-07-22.
- **`compositeText` space-joins fields, diverging silently from its
  spec.** `lib/db/embeddings/source-hash.ts:104` joins embedded fields
  with a space. `.impl-plans/M03-01a-embedder-core.md:187` specified
  `'\0'` and gave the rationale ("unambiguous separator"), but that
  plan file carries literal NUL bytes at five sites, and its test at
  line 179 is _named_ "single-space separator" while its assertions
  expect NUL — the plan contradicted itself and the space won.
  Implementation and test moved together, so the suite is green and no
  gate can see the divergence. The obvious fear does **not**
  materialize: `lib/embedder/service.ts:120-142` hashes the very
  composite it embeds, so two field partitions that collide on the
  hash also embed to an identical vector, and keeping that vector is
  correct rather than stale. What remains is that the separator is
  load-bearing for the _embedder_ — `['Kara Vex', 'a scout']` and
  `['Kara', 'Vex a scout']` are one string to the model — and nothing
  records whether that is intended. A NUL inside provider JSON is a
  fair reason to prefer the space; if field boundaries should be
  visible, the clean split is to hash a NUL-joined composite and embed
  a space-joined one, which also decouples the two uses. Needs the
  M3.1a owner. Surfaced by M3.11 Task 4 review (2026-07-22).
- **Story Settings sections must own disjoint top-level settings
  keys.** The save session merges each section's patch shallowly
  (`{ ...merged, ...patch }`) and commits once, and
  `updateStorySettings` deliberately replaces nested objects rather
  than merging them (pinned by test). So two sections contributing
  different parts of the SAME nested object — `translation`, `models`,
  `retrievalBudgets`, `packVariables` — silently clobber one another,
  and the winner is decided by `Map` insertion order, i.e. section
  mount order, i.e. whichever tab the user opened first.
  Non-deterministic data loss with no delta to recover it. No
  collision exists in M3 (3.7's section owns only top-level keys), and
  3.11 adds a `__DEV__` collision warning so the next one is loud
  rather than silent. But the rule needs a real home before M7.2,
  where a Translation tab section plausibly splits
  `translation.enabled` from `translation.granularToggles`. Options:
  enforce one-section-per-top-level-key at registration, give sections
  a declared key-ownership manifest, or introduce a merge strategy at
  the aggregation layer that is consistent with the action's
  shallow-replace contract. Surfaced by M3.11 Task 5 (2026-07-22).
- **The unsaved-changes guard lives in a single-domain folder.**
  [`save-sessions.md → Navigate-away guard`](../ui/patterns/save-sessions.md#navigate-away-guard--global-intercept)
  specifies the intercept as **global** — "same modal, same copy, same
  actions across every surface that uses the save-session pattern" —
  but M3.11 shipped `UnsavedChangesDialog` under
  `components/story-settings/`, a single-domain folder, with its copy
  in the `storySettings` i18n namespace. World, Plot, App Settings,
  the Vault calendar editor, and the chapter-timeline cards all
  inherit the same pattern and would have to reach across domains or
  duplicate it. Taxonomy-correct home is `components/compounds/`, with
  the four `save.unsaved*` keys moving to `common`. Deliberately
  deferred in M3.11 rather than churning the route's import path for a
  surface with no second consumer yet; the move is a `git mv` plus a
  key relocation whenever the second guard lands. Surfaced by M3.11
  Task 6 (2026-07-22).
- **Story Settings section `id` has no uniqueness guard, and same-tab
  siblings tie on `order`.** `save-session-state.ts` sorts sections by
  `order`, tie-breaking on `id.localeCompare`. `order` now derives
  from the route's tab map (`storySettingsTabOrder`), so a tab
  insertion can no longer desync it — but two sections sharing a tab
  still tie, and the tie-break is alphabetical by internal slug,
  unrelated to on-screen position, so the save bar lists same-tab
  siblings in the wrong order with nothing looking broken. Separately,
  `id` uniqueness is an unstated invariant, and the two helpers
  disagree about duplicates in a way that hides the symptom:
  `upsertSection` matches with `findIndex`, so a second registrant
  overwrites the first's slot rather than both surviving, while
  `removeSection` filters _every_ match, so one section unmounting
  takes its twin's dirty state with it. The result presents as "the
  save bar forgot my edits", not as a visible duplicate. **Partly
  closed by M3.11 review:** `attach`'s cleanup is now identity-checked,
  so a twin unmounting no longer detaches the survivor's callbacks, and
  `SectionDirtyState` carries `tab` rather than a raw `order`. What
  remains is the intra-tab rank for same-tab siblings, and a `__DEV__`
  warning on `id` collision — the shared-`id` publish slot is still
  last-writer-wins. Surfaced by M3.11 Task 4 review (2026-07-22),
  narrowed 2026-07-22.
- **`save-sessions.md` overstates delta participation.**
  [`save-sessions.md → Session semantics`](../ui/patterns/save-sessions.md#session-semantics)
  says "Save commits all session changes as deltas under a single
  shared `action_id`. CTRL-Z reverses the entire session as one step."
  That holds for the World / Plot detail panes it was written from,
  but not for either settings surface: `stories` and `app_settings`
  are both absent from the twelve tables
  [`deltas.target_table`](../data-model.md#diagram) enumerates, so
  settings saves are direct writes with no delta and no CTRL-Z. The
  sentence needs a scope qualifier. Cross-cutting (App Settings is
  equally affected), so not 3.11's to own. Surfaced by M3.11 planning
  (2026-07-22).
- **`AppActionsMenu`'s Ctrl-K is not focus-gated.** The reader and
  Story Settings both mount `AppActionsMenu`, and expo-router's Stack
  keeps the pushed-under screen alive — so with Story Settings open
  there are two live `capture: true` Ctrl-K listeners, the reader's
  included. Observed behaviour is benign today (only the focused
  screen's menu paints, and one Escape closes everything), but that is
  an emergent property of how the blurred screen is frozen and
  portaled, not something the code guarantees. Same family as the
  Ctrl-Z hazard M3.11 Task 9 closed; `SaveBar` registers an equally
  ungated Ctrl-S, and the trigger there is a mounted-but-blurred save
  bar rather than two at once — with a dirty session, the Diagnostics
  jump pushes over Story Settings and leaves one live `capture: true`
  Ctrl-S listener behind the new screen. Not a one-liner:
  `useGlobalHotkey` is called inside a shared compound that Storybook
  mounts with no navigator, and `useIsFocused` throws outside one — so
  focus state has to be threaded down as a prop from each route, or the
  compound needs a navigator-optional focus hook. Surfaced by M3.11
  Task 9 (2026-07-22).
- **Storybook vitest project applies no NativeWind classNames.**
  `storybookTest` in `vitest.config.ts` does not carry
  `framework.options.pluginReactOptions.jsxImportSource: 'nativewind'`
  into the vitest project, so components render with `style=null` and
  only react-native-web's own classes — no `rounded-md`, no `hidden`,
  no theme tokens. The CSS rules are present in the loaded
  stylesheets; nothing carries the classes. Consequence: **any story
  assertion about styling passes vacuously under `pnpm test:run`**,
  and the repo currently has zero style-level test coverage in CI. The
  Storybook dev server is unaffected. Found while trying to assert
  that an inactive tab panel is hidden — `toBeVisible()` and
  `checkVisibility()` both passed against a panel that is
  `display: none` in the real app. Any future visual-regression or
  style assertion needs this fixed first. Surfaced by M3.11 Task 7
  (2026-07-22).
- **`accessibilityState={{ selected }}` emits no `aria-selected` on
  web.** `app/settings/index.tsx:119` sets `accessibilityRole="tab"`
  with `accessibilityState={{ selected }}`, but react-native-web does
  not translate that into an `aria-selected` attribute — verified, the
  attribute is `null`. This is **not** an axe finding: axe-core's
  `tab` role lists `aria-selected` under `allowedAttrs` with no
  `requiredAttrs`, so no rule fires. The damage is real anyway — a
  screen reader cannot tell which tab is active, and because no
  linter flags it the bug is invisible. M3.11's Story Settings rail was lifted from
  this JSX and adds `aria-selected={selected}` alongside (a valid RN
  prop, so it is correct on native too). App Settings still ships the
  bug and wants the same one-line fix. Surfaced by M3.11 Task 7
  (2026-07-22).
- **A settings save is not atomic against a concurrent writer.**
  `updateStorySettings` reads `stories.settings`, merges, then writes
  in a separate `runInTransaction` call. `stories.settings` is one
  JSON blob, so any interleaved writer — `resetStorySettings`, a
  second Electron window, or 3.1b's pipeline writing `effectiveDim` —
  loses one side of the merge entirely, not just the overlapping key,
  and both writers report success. Not fixable at the action layer as
  the bridge stands: `runInTransaction(ops: SqlOp[])` takes only SQL
  ops and resolves `void`, so the read cannot join the transaction and
  a compare-and-set (`WHERE updated_at = ?`) cannot be verified
  without a row count. Needs a bridge capability — a transaction that
  can read, or one that returns `changes` — before the action can do
  better. Surfaced by M3.11 review (2026-07-22). **Blast radius grew in
  M3.1b:** the loser is no longer just a settings key. A save landing
  during a swap's phase 1 can carry a pre-swap snapshot that the flip then
  overwrites, leaving every vector re-embedded under the new model, the
  flags clean, and the settings still naming the old one — with nothing
  that re-derives staleness. Phase 2 now re-asserts the marker in its
  preflight (`assertStoryLive`), which converts that silent loss into a
  loud, resumable failure but does not close the race
  (M3.1b review, 2026-07-28).
- **Electron reload is unguarded while a save session is dirty.**
  M3.11 routes the desktop window-close intent through the main
  process (`native:set-close-guard` / `native:close-requested`), so
  closing the window raises the surface's own Save / Discard / Cancel
  dialog. A renderer-initiated reload (Ctrl-R, devtools) does not go
  through `win.on('close')` and so bypasses the guard, dropping the
  session. A renderer `beforeunload` would catch it but cancels
  **silently** under Electron — the docs are explicit that returning a
  non-void value gives no prompt — so the naive fix trades data loss
  for a mystery no-op. Wants either a main-process
  `webContents.on('will-prevent-unload')` handler that shows the
  dialog, or an in-app reload command that routes through
  `requestLeave`. Browsers are unaffected: they get the native
  `beforeunload` prompt. Surfaced by M3.11 review (2026-07-22).
- **Reloading any deep route in a packaged desktop build renders a
  black screen.** `resolveBundlePath` in `electron/main.ts` maps a URL
  path straight onto `dist/`, and its only fallback is a traversal
  guard — a _missing_ file falls through to `net.fetch` on a
  nonexistent `file://` path, which rejects. `protocol.handle` has no
  rejection handler, so the main-frame load fails and the window shows
  its `#000000` background. `app.json` sets web `output` to `single`,
  so `dist/` holds one `index.html` and no per-route directories:
  `/settings`, `/story-settings/<id>`, `/reader-composer/<id>` and
  `/diagnostics` all miss. Dev is unaffected — `isDev` loads the Metro
  dev server, which does its own SPA routing, so the `app://` handler
  never runs unpackaged. Confirmed on a packaged Linux build
  (2026-07-22): Ctrl-R on App Settings blacks out, Ctrl-R on the story
  list reloads fine. Wants an existence check falling back to
  `index.html` — extension sniffing breaks on dotted route params —
  plus a rejection handler on `protocol.handle`. Distinct from the
  unguarded-reload entry above: that one loses the session, this one
  stops the page coming back. Pre-existing and repo-wide, not
  introduced by M3.11, but M3.11's window-close guard would compound it
  into a window that is also unclosable once a section can be dirty.
  Surfaced by M3.11 review (2026-07-22).

- **`systemFailure` is missing from the canonical entry-metadata
  shape.** `entryMetadataSchema` (`lib/db/story-entries/entry-metadata.ts`)
  carries a `systemFailure` object — `kind` / `failure` / `detail` /
  `submission` — that appears nowhere in
  [`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape),
  nor anywhere else in that file. It backs the reader's system-entry
  error surface and preserves the reversed user action's text so Retry
  survives a restart. Confirmed as intentional and worth documenting
  (2026-07-23) — the fix is adding it to the shape block with its
  open-string rationale, not deleting the field. Surfaced while auditing
  metadata editability during M3.2 review. Canonical edit — route through
  a design / cleanup pass.

- **Entry-metadata shape annotations contradict the user-editability
  prose.** The shape block in
  [`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)
  annotates `sceneEntities` and `currentLocationId` as "classifier-authored"
  while marking only `worldTime` "classifier-authored, user-editable" —
  but the "Metadata edits are delta-logged" paragraph forty lines below
  explicitly sanctions `sceneEntities` and `currentLocationId` user-edits
  and gives them the same reversible-delta treatment. A planner reading
  only the shape block would conclude the scene fields are off-limits,
  which is the wrong premise for the scheduled world-state-block edit
  surface (see [`followups.md`](../followups.md)). Prose is the more
  specific statement; the annotations should be brought in line.
  Surfaced 2026-07-23. Canonical edit — route through a design / cleanup
  pass.

- **`piggyback.md` understates the accepted new-location tolerance.**
  The `currentLocationId` row in
  [`piggyback.md → What piggyback writes`](../memory/piggyback.md) says a
  location introduced this turn that has no entity yet "leaves this field
  unchanged (stale/null)… retrieval for that location is degraded for a
  few turns." The staleness does not stay in that field: `apply.ts`
  inherits the previous location and the computed bookkeeping then writes
  it as `current_location_id` on every in-scene character, so entity rows
  carry an affirmatively false location, not merely a missing one — and
  the next turn's `wasInScene` comparison builds on it. The fix angle is
  already parked
  ([`parked.md → Early classifier trigger on new-entity introduction`](../parked.md#early-classifier-trigger-on-new-entity-introduction-introducednewrelevantentity)),
  so this is purely a canon-accuracy edit: state the tolerance's real
  blast radius so accepting it stays an informed decision. Surfaced
  during M3.2 review 2026-07-23.

- **`data-model.md`'s "future user-triggered time-advance affordance"
  now has a parked entry to point at.**
  [`data-model.md → In-world time tracking`](../data-model.md#in-world-time-tracking)
  justifies the `user_action` `worldTime` edit hook as enabling that
  future affordance but names no destination. The affordance was
  specified and parked on 2026-07-23 —
  [`parked.md → Time-advance selection at user-entry submit`](../parked.md#time-advance-selection-at-user-entry-submit)
  — so the sentence should carry the anchor. Small canonical edit;
  fold into the next cleanup pass touching that section.

- **A profile's `structuredOutput: 'force-on'` never reaches the
  provider.** The flag exists on the profile schema
  (`modelProfileSchema.structuredOutput`, `auto | force-on | force-off`)
  and round-trips through the DB, but has no UI to set it (DB-only until
  the settings editing surface lands) — and even when set,
  `createProviderModel` (`lib/ai/providers.ts`) never passes
  `supportsStructuredOutputs` to `createOpenAICompatible`, so a force-on
  structured call emits `response_format: { type: 'json_object' }` with
  no schema on the wire (and force-on skips prompt-injection, so no
  schema reaches the model at all). To wire it: thread the resolved
  profile's `structuredOutput` into provider creation and set
  `supportsStructuredOutputs` when force-on **and** the endpoint supports
  `json_schema` (capability-gate — most openai-compatible / local
  endpoints don't); the structured schemas then also need
  `optional`→`nullable` to satisfy strict json_schema (the classifier's
  `currentLocation?` / `summary?`). Low priority — prod and E2E rely on
  the prompt-embedded (auto) path; `e2e/tests/structured-force-on.spec.ts`
  pins current behavior and flags the change if the flag is wired.
  Surfaced by the M3 E2E harness work (2026-07-24).

- **E2E coverage — remaining backfill after the coverage-expansion
  pass.** The coverage-expansion pass (2026-07-24) added nine specs —
  creative-mode create, resume-draft, embedder-gate-blocked, undo/redo,
  edit, rollback, failure → retry, cancel mid-turn, and composer modes —
  closing most of the gap
  [`docs/testing.md → Coverage`](../testing.md#coverage-thorough-not-exhaustive)
  named. What still isn't E2E'd, by deliberate scope: **opening-only-branch
  turn** (a marginal variant of the covered turn happy path — it differs
  only in an empty content tail); **settings-corrupt recovery** and the
  rest of the **config surfaces** (settings / story-settings / diagnostics
  are stub-heavy today — revisit when their real tabs / sections land);
  and **regenerate** (the `EntryCard` control exists but `onRegen` is
  unwired in the reader, so there is nothing to drive). **Bad-branch
  hydration failure** was written then cut: the only way to reach it —
  hard-navigating to a deep route — trips the packaged `app://` deep-route
  protocol bug (the black-screen entry above), so it can't be
  packaged-green until that's fixed, and there is no clean in-app route to
  a non-existent branch. Surfaced by the M3 E2E harness work (2026-07-24),
  narrowed by the coverage-expansion pass (2026-07-24).
- **`EntryCard` action controls are not internationalized.**
  `components/compounds/entry-card.tsx` hardcodes English on its per-row
  controls — `Edit entry`, `Delete entry`, `Regenerate`, `Branch from
here`, `Flip era`, the edit textarea's `Edit entry content`, `Save` /
  `Cancel`, and the system-entry `Retry` / `Dismiss` — rather than routing
  through `t()` like the rest of the chrome. No user-facing regression yet
  (English-only today), but it breaks the i18n discipline and forces E2E to
  match literals: `e2e/locators/reader.ts` centralizes them so the eventual
  i18n pass is a one-line locator change. Fix is to move the strings into
  the `reader` / `common` namespaces and swap the locators to `t()`.
  Surfaced by the coverage-expansion pass (2026-07-24).

- **"Upgrade to current default" story-open prompt deferred from 3.1b.**
  Canon ([`retrieval.md → Model swap UX`](../memory/retrieval.md#model-swap-ux))
  names a second dialog entry point: a prompt when opening a story whose
  embedding model differs from the current app default; accepting it fires
  the swap dialog. Slice 3.1b shipped only the Story Settings entry point
  (planning decision 2026-07-24) — the prompt needs its own "stops nagging
  until the next manual swap attempt" persistence decision. Owner: a future
  reader/settings slice. Surfaced by M3.1b Task 14 (2026-07-24).

- **`resetStorySettings` drops creation-locked embedding fields.**
  `lib/actions` reset flow rebuilds settings via `buildStorySettings` from
  current app defaults, which (a) relabels `embedding_model_id` to the
  current app default and (b) drops `effectiveDim` — both violate the
  locked-at-creation invariant ([`retrieval.md → Matryoshka effective dim`](../memory/retrieval.md#matryoshka-effective-dim))
  and would silently invalidate every stored vector without a re-index.
  Pre-existing gap surfaced by M3.1b Task 11 review (2026-07-24); more
  consequential now that `effectiveDim` is actually written. Fix belongs
  with whoever next touches the reset flow: preserve the locked trio
  (`embedding_model_id`, `embedding_provider_id`, `effectiveDim`) across
  reset, or route a model change through the swap flow. Surfaced by M3.1b
  Task 11 review (2026-07-24).

- **Cross-model swap re-index has no E2E coverage.**
  The E2E suite exercises the staging engine via same-model re-index and the
  dialog wiring via relabel, but the `swap-reindex` dialog action's full
  cross-model path is uncovered: the harness's second model is an id-copy of
  MiniLM, and a synthetic id fails catalog dim resolution, while real
  cross-model coverage needs the 768-dim catalog model (~330 MB) downloaded
  per CI run. Unit coverage: the engine's cross-model matrix in
  `lib/actions/embedder-swap/engine.test.ts`. Revisit if a small second
  catalog model lands or CI caches grow acceptable. Surfaced by M3.1b
  Task 12 (2026-07-24).

- **A local model whose files are gone still resolves as healthy.**
  `resolveEmbedderConfig` validates a local backend by looking the model id
  up in the bundled catalog (`localModelDim`); it never checks that the
  model's directory exists. So a model removed from disk resolves `ok`, is
  offered as a swap candidate, and produces no reason line — the Memory
  panel's `modelMissing` reason only fires for an id absent from the
  _catalog_, which is the one shape a real removal never produces.
  [`model-management.md → Removal`](../memory/model-management.md#removal)
  expects the panel to explain "model missing"; today the failure surfaces
  only per-embed, as a generic `That didn't work` toast with the cause in
  a `logger.error` the user cannot see. Wants a files-exist check in the
  resolution path (or an `installed`-set intersection at the panel), which
  also gates the swap picker from offering an uninstallable target. Owner
  is plausibly the M7.1 removal flow, but the gap is live now, since the
  directory can vanish without going through any app flow. Surfaced by
  M3.1b manual smoke (2026-07-25).

- **The swap resume dialog can trap the user when the target cannot
  embed.** A staging failure leaves the marker set — `runStagingSwap`
  reaches `refreshStores` only on success — so the story-open resume
  prompt fires correctly. But the dialog is non-dismissible and its
  primary action re-runs the identical embed, so when the target model is
  the reason staging failed (files removed, provider unreachable), Resume
  can never succeed and each attempt reports only the generic
  `actionFailed` toast. The escape exists and is correct — `Cancel switch`
  never embeds, so it clears the marker and re-flags rows — but nothing in
  the copy distinguishes "retry a transient failure" from "this target is
  unusable, abandon it", and the failure reason is never surfaced.
  Confirmed by hand on desktop (2026-07-25): resume → generic toast →
  dialog persists. Wants the dialog to carry the last failure reason, or
  Resume to pre-flight the target's resolvability and steer to Cancel when
  it can't be met. Pairs with the files-exist gap above — a resolvability
  pre-flight fixes both surfaces at once. Surfaced by M3.1b manual smoke
  (2026-07-25).

- **A probed embedding dim is displayed once and thrown away.** Provider
  dim detection already works — `testEmbedder` returns the native dim and
  the card prints it (`OK · dim 1024 · 12 ms`) — but nothing persists it.
  `providerCapabilitiesSchema` has no field to hold it, so
  `resolveEmbedderConfig`'s `providerDim` option has **no production
  caller**: every provider config carries `dim: null` and the service's
  dim-mismatch guard is permanently inert in provider mode, meaning a
  provider that silently changed dim mid-story would be caught by nothing.
  `validateCustomDim` has no upper bound for the same reason — an
  over-declared dim is silently clamped at embed time
  (`min(effectiveDim, native)`), so the wizard's storage preview can promise
  a size that never materializes. Fix: persist the probed dim on the cached
  model (an `embeddingDim` capability written by the probe and by the first
  successful embed), thread it as `providerDim`, bound the custom-dim
  validator by it, and re-arm the guard. The local side has the mirror gap —
  `InstalledModelInfo` carries only `id` and `sizeBytes`, so a
  custom-imported model has no dim source either, which is why
  `embedder-default-card`'s local branch still falls back to `dim: 0` and
  cannot Test a non-catalog model. Needs no new UI, so it is independent of
  the Matryoshka item below. Surfaced by M3.1b manual smoke (2026-07-25).

- **Matryoshka support is not detectable, so M7 should let the user
  assert it.** No OpenAI-compatible endpoint advertises MRL training, and
  the obvious probe is a false-positive machine: sending `dimensions: N`
  and getting N floats back proves only that the _server_ honoured the
  parameter, which a naive slice of a non-MRL model satisfies identically
  while returning quality-destroyed vectors. The property that actually
  distinguishes MRL is rank preservation under truncation, which is
  measurable — embed a fixed probe set at native and at candidate dims,
  then rank-correlate the pairwise-similarity matrices — but it yields a
  statistical result against a judgment threshold, not a boolean, and a
  wrong answer degrades retrieval silently. So the contract stays capability
  flag plus user assertion (matching the relabel disclaimer this slice
  already ships), with **manual override as the primary path**: an advanced
  user who knows a model is Matryoshka-trained enables the flag and fills in
  the dims directly. A rank-preservation sweep, if built, belongs beside that
  control as evidence shown to the user rather than a gate that decides for
  them — and the sweep is also how the curated ladder's rungs would be found
  rather than assumed. Deferred to **M7** (developer decision 2026-07-25):
  the override needs the model-capability editing surface to host it, and
  most users will never touch the feature. Note for whoever builds it:
  `dimLadder`'s hardcoded `[512, 1024, 2048]` fallback becomes wrong under
  a user-assertion model, since enabling the flag would always come with
  user-supplied dims — the fallback currently fabricates rungs nobody
  asserted, and can offer dims above the model's native size. Surfaced by
  M3.1b manual smoke (2026-07-25).

- **Staleness pill can stay lit for stale rows on non-open branches.**
  The drain worker warms only the open branch while the pill's mount
  refresh counts story-wide; a story with stale embeddable rows on a
  non-open branch keeps a lit pill the drain never clears (the blocking
  sync stage still covers correctness on read; `Re-index this story now`
  clears it). Cosmetic-only; resolve if per-branch status or a
  story-wide drain scope lands. Surfaced by M3.1b final review
  (2026-07-25).

- **The drain still embeds unconditionally instead of revalidating.**
  [`retrieval.md → Compute lifecycle`](../memory/retrieval.md#compute-lifecycle)
  specifies that an edit or rollback returning content to its embedded
  value "revalidates to 0 with no re-embed, since the existing vector is
  still correct". `recomputeStaleOps` implements exactly that hash
  comparison, and the cross-model cancel now uses it — but the drain still
  loads `WHERE embedding_stale = 1` and hands every row to
  `embedAndBuildVecOps`, so a rollback to previously-embedded content
  re-embeds rather than revalidating. Wire the same helper into the drain's
  row load, or narrow canon to say revalidation happens only where a caller
  already knows the row set. Surfaced by M3.1b manual smoke (2026-07-27);
  the cancel half resolved in M3.1b review (2026-07-28).
