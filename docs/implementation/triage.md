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
  dedicated clear action). Nullable fields are unaffected — the filter
  drops only `undefined`, so `null` still writes. Surfaced by M3.11
  Task 1 (2026-07-22).
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
  save bar forgot my edits", not as a visible duplicate. Suggested:
  warn on `id` collision in `__DEV__`, and give same-tab sections an
  explicit intra-tab rank. Surfaced by M3.11 Task 4 review
  (2026-07-22).
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
  attribute is `null`. A `role="tab"` without `aria-selected` is an
  axe `aria-required-attr` violation, and a screen reader cannot tell
  which tab is active. M3.11's Story Settings rail was lifted from
  this JSX and adds `aria-selected={selected}` alongside (a valid RN
  prop, so it is correct on native too). App Settings still ships the
  bug and wants the same one-line fix. Surfaced by M3.11 Task 7
  (2026-07-22).
- **`rehydrateStories`'s boolean is discarded, so a failed read
  reads as "story missing".** The hydration effect in
  `app/story-settings/[storyId].tsx` sets its `hydrated` flag
  unconditionally in `.then()`, but `rehydrateStories`
  (`lib/stores/stories/stories.ts`) logs and swallows read errors,
  then returns `false`. On a cold entry where that read fails the
  route shows "This story could not be loaded." across all eight
  tabs, conflating a transient failure with a deleted story.
  `app/reader-composer/[branchId].tsx` already models the three
  states its own branch hydration needs — failed, still-loading,
  empty — and is the shape to copy. Surfaced by M3.11 final review
  (2026-07-22).
- **The save-session context rebuilds on every snapshot change.**
  `components/story-settings/save-session.tsx` rebuilds its `api`
  object whenever `snapshot`, `saving`, or `pendingLeave` changes,
  and `useStorySettingsSection` subscribes to the whole object — so
  with every tab panel mounted by design, one section going dirty
  re-renders every mounted section. Harmless at M3 scale (zero
  sections today, one once 3.7 lands), but M4.4's basic surface and
  M7.2's deep tabs fill most of the eight tabs, and the cost scales
  with the number of registered sections. Splitting the stable
  registration surface (`publish` / `unpublish` / `attach`) from the
  volatile snapshot into two contexts would make that free.
  Surfaced by M3.11 final review (2026-07-22).
