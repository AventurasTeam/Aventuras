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
- **Storybook vitest project applies no NativeWind classNames, so every
  style assertion in a story passes vacuously.** Components render with
  only react-native-web's own generated class — no `rounded-md`, no
  `hidden`, no theme tokens — so the repo has zero style-level test
  coverage in CI. The Storybook dev server is unaffected. Confirmed by
  probe (2026-08-18): a `<View className="hidden rounded-md">` renders
  `class="css-view-g5y9jx"`, `style="null"`, computed `display: flex`,
  `border-radius: 0px`.
  **The obvious fix is disproven.** Carrying
  `framework.options.pluginReactOptions.jsxImportSource: 'nativewind'`
  into the vitest project does not work: adding
  `rnw({ jsxRuntime: 'automatic', jsxImportSource: 'nativewind' })` to the
  storybook project's plugins changes nothing, in either plugin order, and
  `esbuild.jsxImportSource` changes nothing either. The plugin genuinely
  runs — pointing it at a nonexistent module fails the build on
  `<module>/jsx-runtime` — so the option is read but the transform that
  actually compiles the story is not the one it configures.
  **Root cause is the interop registration, not the JSX transform.** The
  stylesheets are fine (6 sheets, 861 rules, the `.hidden` rule present).
  What is missing is `cssInterop` registration for the RN core components:
  adding `cssInterop(View, { className: 'style' })` by hand makes the same
  probe render `class="css-view-g5y9jx hidden rounded-md"` with
  `display: none` and `border-radius: 6px`. A bare `import 'nativewind'`
  does **not** register — the explicit call is the lever.
  `components/wizard/cast-row-layout.stories.tsx:16` already carries that
  hand-registration as a local workaround. Closing this properly means
  either winning the transform so `nativewind/jsx-runtime` compiles the
  stories, or a storybook-project setup file that registers the core
  components — the latter duplicates a list NativeWind owns and can drift.
  Revisit when style or visual-regression assertions are wanted; until
  then, treat any style assertion in a story as unproven. Surfaced by
  M3.11 Task 7 (2026-07-22), root-caused 2026-08-18.
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
  and **bad-branch hydration failure**, which was written then cut: the
  packaged `app://` deep-route bug that blocked the hard-navigation route
  to it is fixed (2026-08-18), but there is still no clean in-app route to
  a non-existent branch. Surfaced by the M3 E2E harness work (2026-07-24),
  narrowed by the coverage-expansion pass (2026-07-24).
- **`Compounds/EntryCard → StreamingReasoning` reportedly renders empty
  in the Storybook dev server while passing under
  `vitest --project storybook` (20/20).** The vitest harness is not
  blind to render throws — verified with a deliberately-throwing story,
  which it does fail. A browser probe against `pnpm storybook` reported
  `#storybook-root` empty with a `ReanimatedError` about a missing
  dependency array, the same shape as an unguarded `useAnimatedStyle`
  with no deps array — the pattern the reader's `SuggestionStrip`
  splits web/native specifically to avoid. Real desktop is unaffected
  (Metro applies the worklet plugin there), and both the dev-server and
  vitest-storybook paths load the same `.storybook` config directory,
  so it isn't an obvious config split. Mechanism unresolved; worth ten
  minutes with `pnpm storybook` open. Surfaced by M3.7a Task 9
  (2026-07-26).
- **A typed `PipelineInputMap` via declaration merging is the shape to
  reach for once a second pipeline needs caller inputs.**
  `suggestion-refresh` is the first pipeline kind to give a phase
  a caller-supplied parameter (`refreshGuidance`), and
  it rides the base `PhaseContext.inputs?: unknown`
  (`lib/pipeline/types.ts`) narrowed by its own type guard
  (`readRefreshInput` in `lib/pipeline/definitions/suggestion-refresh.ts`)
  rather than a typed per-kind context. That's the right amount of
  machinery for one consumer. `lib/actions/action-map.ts`'s
  `PipelineActionMap` already establishes the declaration-merging idiom
  this repo uses for the analogous per-domain-additive problem; a
  `PipelineInputMap` keyed by pipeline kind is the natural generic seam
  once a second pipeline kind needs its own caller inputs. Not needed
  yet — recorded so the next consumer doesn't have to rediscover the
  idiom. Surfaced by M3.7a Task 7 (2026-07-25).
- **`lib/actions/entities/register.ts` carries the same null-flattening
  shape that produced this slice's undo defect, but lands on the safe
  side of it.** Task 7 fixed a real bug in
  `lib/actions/story-entries/register.ts`: a field-wise undo partial
  can't express "this column was NULL," so reversing onto a NULL
  `metadata` produced an unparseable blob. `entities/register.ts` has
  the analogous shape for entity `state`, but its flattened default is
  a schema-valid empty object rather than an invalid one, so undo there
  restores an empty-but-parseable `state` rather than breaking the next
  read — and a NULL `state` row is only reachable via legacy import or
  a manual DB edit, not any path this slice touches. Deliberately left
  alone; recorded so the asymmetry with `story_entries.metadata` is a
  known, chosen difference rather than an oversight the next reader
  "fixes" into inconsistency. Surfaced by M3.7a Task 7 (2026-07-25).
- **The reversal barrier (`awaitRunTerminal(kind, 'cancel')`) is
  specified in `generation-pipeline.md` but never invoked by any
  reversal path, and `applyDeltaAction` never consults
  `reversalInProgress`.** Both exist in
  `lib/pipeline/runtime/orchestrator.ts` /
  `lib/stores/generation/generation.ts` and predate this slice, and
  nothing reaches them today. `suggestion-refresh` briefly looked like
  the first consumer — it shipped `no-gate`, which would have made it
  the first run able to be mid-flight while a user reversal (CTRL-Z /
  rollback) fired against the same entry — but it was moved to
  `hard-gate` on 2026-07-30, so reversals now reject at the action
  layer for its duration. That leaves no live `no-gate` kind: the
  declared `periodic-classifier` has no pipeline file yet. Whoever
  lands the first real one inherits this, and should note that
  re-reading the target after the call (as this phase does) is not
  equivalent — it proves the row survived, not that the context the
  call was built from did. Surfaced by M3.7a Task 7 (2026-07-25),
  re-scoped when the gate flipped (2026-07-30).
- **`abortRun` reverse-replays every delta under a run's `actionId`,
  which would reverse a `suggestion-refresh` run's already-committed
  stage-1 emission.**
  [`reader-composer.md → Next-turn suggestions`](../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions)'s
  "Re-roll cancel during translation stage" edge case states that on a
  translation-stage cancel "the stage-1 emission has already
  committed" — but `abortRun` (`lib/pipeline/runtime/orchestrator.ts`)
  doesn't distinguish committed-and-chained-forward deltas from
  in-flight ones; it reverses everything tagged with the run's
  `actionId`. Unobservable today because `suggestionTranslationPhase`
  (`lib/pipeline/definitions/suggestion-refresh.ts`) is a synchronous
  no-op — there's no window between stage 1 committing and stage 2
  finishing for a cancel to land in. Becomes real once the M8.1
  translation call replaces that no-op. Surfaced by M3.7a Task 7
  (2026-07-25).
- **Two of the three suggestion-emission paths share a log event name with
  different payload shapes.** `classifier.suggestions_parse_failed` is
  emitted by the narrative fold (`lib/pipeline/definitions/per-turn.ts:225`)
  with `blockFound`, `failed`, and `dropped` fields, and by the classifier
  fold (`lib/pipeline/definitions/per-turn-piggyback.ts:239`) with `received`
  and `dropped` fields — two structurally different shapes under one event
  name — while the refresh path
  (`lib/pipeline/definitions/suggestion-refresh.ts:153`) uses a distinct
  `classifier.suggestions_refresh_unusable`. Filtering diagnostics by event
  name can't separate the two folds sharing one. Either all three emission
  paths should share a name or none should; two-of-three is the
  inconsistency. Surfaced by the M3.7a whole-slice review (2026-07-26).
- **The next-turn-suggestions feature is invisible to every story created
  before this slice.** `suggestionsEnabled` (`stories.settings`) is a
  non-optional persisted boolean, so pre-slice stories carry whatever
  `false` they were written with, and 3.7a ships no toggle to flip it — the
  Story Settings editor lands in 3.7b. Today the only route to `true` on an
  existing story is `resetStorySettings` ("Reset settings to defaults"),
  which discards every other story setting to get there. This is a correct
  consequence of the copy-at-creation rule
  (`story-settings-defaults.ts → buildStorySettings`) rather than a defect,
  but it means existing users see nothing new until 3.7b ships, and nothing
  records that today. Surfaced by the M3.7a whole-slice review (2026-07-26).

- **"Upgrade to current default" story-open prompt deferred from 3.1b.**
  Canon ([`retrieval.md → Model swap UX`](../memory/retrieval.md#model-swap-ux))
  names a second dialog entry point: a prompt when opening a story whose
  embedding model differs from the current app default; accepting it fires
  the swap dialog. Slice 3.1b shipped only the Story Settings entry point
  (planning decision 2026-07-24) — the prompt needs its own "stops nagging
  until the next manual swap attempt" persistence decision. Owner: a future
  reader/settings slice. Surfaced by M3.1b Task 14 (2026-07-24).

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

- **Native-dim-dependent M7 validation remains.** M3.1b now persists a
  provider model's successful native probe as `embeddingDim` and threads
  it through production config resolution. The wizard still does not bound
  Custom by that value; an over-declared dim can therefore make its storage
  preview overpromise even though the service clamps to native. The local
  side also still needs a dim source for future custom imports:
  `InstalledModelInfo` carries only `id` and `sizeBytes`, so a non-catalog
  model cannot be tested. M7 owns both UI-facing gaps. The original provider
  persistence defect was surfaced by M3.1b manual smoke (2026-07-25) and
  resolved by the 2026-07-28 review followup.

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

- **`buildGenerationContext` should own the store reads, not receive a
  finished dataset.** The planned shape is a unified **data source**: call
  sites hand the builder identity and it reads `entriesStore` /
  `entitiesStore` itself, with templates doing the shaping in Liquid per
  [`architecture.md → Formatting lives in Liquid`](../architecture.md#formatting-lives-in-liquid-not-in-the-context-builder).
  Today all three phases (`per-turn.ts`, `per-turn-piggyback.ts`,
  `suggestion-refresh.ts`) duplicate the same branch-filter-and-sort and
  hand in pre-shaped arrays, and the builder flattens entries to
  `{ content }` — which contradicts that canon in the one place it matters
  most, since a template can reach neither `entry.position` nor
  `entry.metadata`. Four things the implementer must handle, none obvious
  from the call sites: (a) `sceneEntities` is derived from `.at(-1)` of the
  array the caller passed, so template-side truncation silently makes it
  describe the branch tail instead of the consumer's own — it has to become
  template-derived in the same change or the refresh renders the wrong scene
  block; (b) `entry` is absent from `SUBSTITUTABLE_PREFIXES`
  (`lib/ids/prefixes.ts`), so raw entries expose real UUIDs where a pack
  author can print them, against
  [`data-model.md → ID shape`](../data-model.md#id-shape--kind-prefixed-uuids-throughout)
  — nothing prints one today, but a pack author could; (c) no consumer
  needs a new filter: per-turn already truncates via `recent`, the
  classifier fold's tail pair is exactly `recent: 2`, and
  `suggestion-refresh` stopped truncating at all once its anchor became
  the branch tail by construction (2026-07-30);
  (d) `generation-context.test.ts` has 17 call sites passing fixtures
  directly, and the builder is currently pure, so store-reading means
  hydrating stores in each — the bulk of the mechanical cost. Also needs a
  clause edit to [`architecture.md → The single-context principle`](../architecture.md#the-single-context-principle),
  whose "a phase reads the domain stores directly" no longer holds (the
  "calls the group's context builder per render" half is unchanged).
  Surfaced by M3.7a post-merge review (2026-07-30).
- **The classifier's tuning signal is `unresolvedRefs`, not
  `window_head_fallback`.**
  [Slice 3.3](./milestones/03-memory-floor/slices/03-classifier.md) called
  head-fallback warnings dominating the log the trigger for the M7.5 prompt
  tuning pass. The first real-provider run says otherwise: against a local
  4B-class Q4 model the pass logged 7 and 19 `classifier.unresolved_refs`
  against a single `classifier.window_head_fallback`. The model invents its
  own handles rather than reusing the `[c1]` placeholders the prompt hands
  it, so the refs it emits point at nothing. These are refs to entities that
  already exist, so the reserved `new:` namespace does not cover them.
  Consequence: the graph gains happenings with sound titles, descriptions
  and resolved `occurredAtTurn` anchors, but almost no edges — involvements
  and awareness are what get dropped. **Caveat: two runs, one model.** Enough
  to redirect what M7.5 measures, not to set a threshold — and small-model
  placeholder compliance may not generalise to the frontier models the
  tuning pass will target. Route into the M7.5 slice's Open questions once
  that milestone is authored; it has no owner today. Surfaced by the Slice
  3.3 real-provider smoke (2026-07-31), reproducible via
  `e2e/tests/classifier-real-provider.smoke.spec.ts`.

- **`lib/actions/` has drifted from a transactional write layer into
  the app's general command surface, and wants an extraction pass.**
  The layer's own bar
  ([`code-conventions.md → Action layer`](../code-conventions.md#action-layer))
  is writes that persist to SQLite or cross stores; three groups of
  residents don't meet it. **(a) Pipeline triggers.**
  `suggestions/refresh-suggestions.ts` and `classifier/run-now.ts`
  write nothing — both are an `ensureRegistered` call plus
  `runPipeline` — and they live here because `@/lib/actions` is what UI
  and boot are permitted to import. That fusion is what forces the
  module cycle the repo already works around: `turns/submit-turn.ts`
  imports `@/lib/pipeline`, so `lib/pipeline` cannot import
  `@/lib/actions` back and instead deep-imports `@/lib/actions/types`
  under a dedicated `boundaries/dependencies` exception in
  `eslint.config.js`, with the rationale comments in
  `lib/pipeline/runtime/action-port.ts` and `lib/boot/bootstrap.ts`.
  Extracting the triggers is what would let that exception go.
  **(b) `classifier/deps.ts`.** Three of its five exports aren't
  writes: `embedClassifierDescriptions` never touches the DB (it reads
  two stores and calls `embedTexts`, and sits here only because
  `resolveDrainConfig` lives in `../embedder-swap`), and
  `unprocessedTurnCount` / `readClassifierStatus` are reads. The two
  genuine writes bypass `defineAction`, issuing `ctx.db.run(sql...)`
  directly. **(c) `embedder-swap/`.** Roughly 1,100 lines of resumable
  state machine — single-flight locks, injected sinks, cancellation,
  seven exported error classes — whose `index.ts` already documents
  that the raw engine primitives must stay unreachable because each
  assumes the caller holds the per-story lock. A folder curating an
  unsafe inner API behind a barrel is a lib module wearing an
  action-layer folder name; only its transactional entry points belong.
  What stays and shouldn't be churned: the `register.ts` (delta-logged,
  handler returns ops for the engine to commit) versus `operational.ts`
  (non-delta write, own transaction, own store patch) split is the
  layer's real organizing rule, and reads deliberately colocated with
  their writes to pin a shared invariant (`story-entries/recent-window.ts`
  and `ENTRIES_WINDOW_SIZE`) are correct where they are. Triage needs a
  destination decision before any move: a dedicated command seam for the
  triggers versus pushing them back to their callers, and whether
  `embedder-swap` becomes its own `lib/` module — the latter risks a new
  cycle with `lib/embedder`, which is the thing to check first. No M3
  slice owns this. Surfaced by a 2026-08-01 read of the folder.

- **The phone list state hides a dirty save bar.** `StorySettingsShell`
  renders the bar inside the detail pane, and `MasterDetailLayout`
  drops that pane on phone when no tab is selected. No data loss —
  panels stay mounted, and `←` and window-close both route through
  the guard — but the unsaved state is invisible. Canon argues
  against the obvious fix:
  [`save-sessions.md → Save bar`](../ui/patterns/save-sessions.md#save-bar--the-visible-ui)
  says the bar "spans the editable pane only — never the rail," and
  [`story-settings.md → Mobile expression`](../ui/screens/story-settings/story-settings.md#mobile-expression)
  puts it at "the bottom edge of the detail-route's scroll region."
  Accepted at M3.7b planning; the call belongs to M4.4, the surface's
  real owner. Surfaced by M3.7b implementation (2026-07-31).

- **M2.5's composer modes are unreachable on every real story.**
  `composerModesEnabled` defaults to `false` in
  `lib/db/stories/story-settings-defaults.ts`, and app-level
  `defaultStorySettings` carries only `activePackId`, so no story is
  ever created with it on and no UI can flip it — the same
  dead-feature shape M3.7b just fixed for `suggestionsEnabled`. Canon
  puts its toggle and wrap-POV in the same Authoring aids grouping
  M3.7b's section lives in, so M4.4 completing that grouping is the
  natural owner. Surfaced by M3.7b implementation (2026-07-31).

- **The Generation tab renders two `role="status"` live regions at
  once.** `@dnd-kit` mounts its own inside
  `SuggestionCategoriesEditor`'s web branch, while `SaveBar`
  (`components/compounds/save-bar.tsx`) uses that role for its
  unsaved-changes notice — so a screen reader sees two competing
  status regions, and role-based queries against the save bar are
  ambiguous. Surfaced by M3.7b implementation (2026-07-31).

- **Background content behind an open `AlertDialog` is not
  `aria-hidden`.** Contrary to the usual Radix `hideOthers`
  assumption, an E2E locator scoped only by role matched both the
  save bar's Discard button and the unsaved-changes dialog's Discard
  button while the dialog was open — confirmed by an actual run
  (`e2e/locators/story-settings.ts`). Fixed in the spec by scoping
  through the dialog, but the root cause (portal nesting?) was never
  investigated, and any future locator or a11y assumption about
  background-hiding on this stack is unsafe. Surfaced by M3.7b
  implementation (2026-07-31).

- **`action_layer.story_settings_save_blocked` logs a localized
  string.** The event's `reason` payload
  (`components/story-settings/save-session.tsx`) carries translated
  UI text, so it can't be aggregated or grepped across locales. The
  producing section has a stable discriminant
  (`validateDraft`'s `problem` field,
  `'empty-label' | 'duplicate-label'`) and discards it at the channel
  boundary; carrying a code alongside the reason would need the C7
  contract widened. Surfaced by M3.7b implementation (2026-07-31).

- **Twelve `pointerEvents="..."` prop-form call sites remain across
  `components/`.** React Native flags the prop form as deprecated in favour
  of `style.pointerEvents` on every render, so the warning is in every test
  run. `save-bar.tsx` was converted on 2026-08-18 and the warning did not
  go away — `toast.tsx` and `sheet.tsx` mount globally under the Storybook
  preview decorator, so at least one fires regardless of the story. The
  remaining sites are in `spellcheck-textarea.tsx`, `story-card.tsx`,
  `list-row.tsx` (x3), `collision-list-row.tsx`, `banner.tsx`,
  `toast.tsx` (x2), `sheet.tsx`, and `ai-assist.tsx`. Mechanical, but four
  of them already carry a `style` prop that has to be merged rather than
  replaced, and three of those are overlay/portal code (`sheet`, `toast`,
  the reader tooltip) where nothing tests pointer behaviour — so this wants
  its own change with a look at each overlay, not a drive-by regex. Split
  out of the save-bar entry 2026-08-18.
- **The save bar's invalid-reason notice is not tab-qualified.**
  `computeSnapshot` (`components/story-settings/save-session-state.ts`)
  reports the first dirty-and-invalid section in rail order, and the
  bar lists dirty fields from every tab — so once M4.4 adds more
  sections, a user on one tab can be shown a blocking reason sourced
  from another with nothing indicating where to go. Moot at one
  section; `{ tab, reason }` would be a single optional field on the
  existing `SaveSessionSnapshot` type. Surfaced by M3.7b
  implementation (2026-07-31).

- **The two suggestion-emission macros diverge on the worked
  example, so the first category is privileged on one emission path
  only.** `lib/prompts/bundled/suggestion-emission.ts` (tagged block,
  narrative fold) renders a skeleton via
  `{% assign exampleSlot = suggestionSlots | first %}`, making the
  lowest-`order` enabled category a one-shot exemplar;
  `lib/prompts/bundled/suggestion-emission-json.ts` (per-turn
  fallback classifier and suggestion-refresh) has no example at all,
  because the schema carries the shape. Consequence: which category
  the model favors depends on which path fired, and on the narrative
  path the exemplar works against the diversity nudge sitting
  immediately above it. The JSON macro's own header comment states
  the split exists so the framing rules, ref convention, diversity
  nudge and length cap cannot drift between the two — this is a
  drift in exactly that class, living in the skeleton rather than
  the shared prose, which is why the split did not catch it. Two
  open questions: whether slot 1 should be exemplar at all (an
  alternative is naming no ref in the skeleton, at the cost the file
  comment warns about — a literal placeholder is something a model
  copies), and whether the JSON path wants a matching example for
  parity. Effect size is unmeasured here; the claim that an exemplar
  anchors harder than list position is general, not observed in this
  app. Related: nothing caps the category list — both macros loop
  the full enabled palette, so `order` has no truncation effect and
  this exemplar is the only place list position does real work.
  Surfaced while reviewing the reorder affordance's justification
  after M3.7b (2026-08-01).
- **`disabledReason` never reaches the accessibility tree on web.**
  `Button`, `SwitchRow`, `swap-dialog`'s `CandidateRow` and
  `ColorPicker` all pass the reason to `accessibilityHint`, which RN
  Web drops outright — probed in Chromium, a disabled `Button` carries
  no `title`, `aria-describedby` or `aria-label` of its own. The web
  tooltip works (the `DisabledReasonTooltip` ancestor is reachable by
  hit-test from every point on the control, verified), but an ancestor
  `title` is not a dependable accessible-description source, so screen
  reader users get "dimmed and unavailable" with no reason. Button's
  own prop doc claims both channels; on web only the tooltip half is
  true. RN Web does forward `aria-describedby` (verified), so the fix
  is a visually-hidden reason node plus `useId` in the shared wrapper —
  modest, but it needs a hidden-text primitive the repo lacks and it
  changes a shared UI contract, so it wants a design pass rather than a
  drive-by. Cross-cutting: every `disabledReason` consumer, present and
  future. Predates M3.7b; surfaced by the M3.7b review (2026-08-01).
- **The retrieval pass has never been measured on mobile.** Every
  figure in
  [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  is desktop. The only mobile evidence is the PoC's per-query KNN
  numbers, which predate the shipped pass — that PoC issued three KNN
  queries against one family, where the pass issues fifteen across five
  plus a by-id vector fetch. The ranker has never run on-device at all,
  and `retrieval.md`'s own PoC section puts a 384-dim Hermes dot at
  ~24-30 µs, which would make MMR's 19,900 dots ~500 ms per type if it
  holds. That is not turn-dominating against a narrative call measured
  in tens of seconds, but it is unknown rather than small, and it
  cannot be settled from a desktop runner. `bench/retrieval-cost.test.ts`
  is the harness to port. Owner is whoever does Android bring-up;
  desktop is v1 prod alongside it. Re-derived from the M3.4 MMR entry
  (2026-08-08), whose desktop half is now canon.
- **Q3's dialogue signal mis-pairs across unbalanced quotes.**
  `lib/retrieval/prose-extract.ts` finds quoted spans over the whole
  narrative entry (needed, because a quote legitimately opens in one
  sentence and closes in a later one) and awards
  [`retrieval.md → Q3`](../memory/retrieval.md#q3-heuristic-prose-extract)'s
  Medium "dialogue" weight to any sentence overlapping a span. On
  well-formed prose this is correct. On an **unclosed** opener it
  mis-pairs: that opener binds to the _opening_ quote of the next
  speech, so the pure narration between them collects a spurious +2,
  and every subsequent quote in the entry is off by one. Measured:
  `'"Run, she said. He left the room. "Wait." Done here.'` yields one
  span covering the first two sentences, flagging `He left the room.`
  as dialogue. Two things bound the damage — a lone stray `"` with no
  later quote produces **no** span at all (it does not swallow the rest
  of the entry), and the multi-paragraph dialogue convention (each
  paragraph opening a quote, only the last closing it) happens to flag
  correctly. LLM narrative does emit unbalanced quotes, so this is
  reachable. A stateful open-quote tracker was considered and rejected
  during M3.4 as needing its own pairing and nesting logic per quote
  style; any regex pairing degrades on unbalanced input, and the
  shipped version is strictly better than the per-sentence one it
  replaced, which lost the signal entirely whenever a quote spanned a
  sentence break. Worth revisiting only if probe captures show the
  dialogue weight firing on obvious narration. Surfaced by M3.4 Task 8
  review (2026-08-02).
- **`loadHappeningRows`' OR-ed predicate cannot use an index.**
  `lib/retrieval/source-rows.ts` filters happenings with
  `branch_id = ? AND (id IN (...) OR occurred_at_entry_id IN (...))`.
  `EXPLAIN QUERY PLAN` degrades that to
  `SEARCH happenings USING INDEX sqlite_autoindex_happenings_1 (branch_id=?)`
  — a scan of every happening on the branch — where the `id IN (...)`
  half alone uses the composite PK as a **covering index** seek. The
  `occurred_at_entry_id` half has no index to use in either form. Only
  ~3 ms at canon's 6k-happening ceiling, so it is not urgent, but it
  partly reintroduces the branch-wide scan the M3.4 `loadSourceRows`
  cleanup removed, and it grows with the table. Fix is two indexed
  queries unioned in memory plus an index on
  `(branch_id, occurred_at_entry_id)` — the OR defeats index use even
  once the column is indexed, so both halves are needed. Surfaced by the
  M3.4 cost re-derivation (2026-08-08).
- **The app chunks SQL bind lists against a variable limit neither
  runtime has.** Two constants code to SQLite's pre-3.32 999-variable
  floor: `ADMIT_ID_CHUNK` (990, `lib/retrieval/run.ts`) and
  `STALE_ID_CHUNK` (400, `lib/db/embeddings/stale.ts`, three call
  sites). Both runtimes are far past that floor — desktop `node:sqlite`
  on Node 24.14 ships SQLite 3.51.2 and refuses only above 32766
  (probed directly), and `expo-sqlite` 55.0.16 vendors 3.50.3
  (sqlcipher 3.49.1) with the same 32766 default and no override. The
  cost is not theoretical for the 400: a swap-cancel re-flagging a
  6000-happening branch emits fifteen `UPDATE` ops inside one
  transaction where one would serve, and `recomputeStaleOps` issues the
  same fan-out per family table as awaited round trips. `ADMIT_ID_CHUNK`
  is inert by comparison, since its input is capped at three times
  `KNN_K`, but its own comment argues narrowing multiplies cost because
  each chunk repeats a full partition scan — which is an argument for
  raising it, not keeping it. Wants one pass that establishes the real
  floor once, decides whether to chunk at all below it, and covers the
  unchunked builders too — `awareness.ts`, `engine.ts`'s branch-id
  lists, `field-rows.ts`, `vec-tables.ts` — so the next reader does not
  have to re-derive which are bounded by construction. Note the
  interaction with the `loadHappeningRows` index entry above: that fix
  splits one OR-ed query into two indexed ones, which changes the bind
  arithmetic this pass would reason about, so land the index work first.
  Surfaced by CodeRabbit review of the M3.4 triage PR (2026-08-08),
  which read the 999 comments as fact and reported a bind-limit defect
  that does not exist.

- **Tighten the unprobed-dim escape hatches once M7 makes probing
  mandatory.** `validateCustomDim` skips its `above-native` check and
  `clampEffectiveDim` returns the value untouched whenever the model's
  native dim is unknown (`components/wizard/memory-cost-logic.ts`),
  both deliberately — rejecting on a ceiling nobody has measured would
  block valid picks. The cost is one representable cell: an unprobed
  provider with `effectiveDim` above native. There the pass reads the
  dim family named by `effectiveDim` while the embed service clamps
  the vectors it writes to the native dim, so the sync commits one
  family and clears the flags before the query embed refuses on the
  mismatch. The story has no in-app recovery — no post-creation
  `effectiveDim` editor exists, and a swap reuses the locked dim. M7
  is slated to force a probe before a model is selectable, which
  removes the cell; when it lands, both permissive branches should go
  with it rather than being left as a latent re-opening. Surfaced by
  the M3.4 review (2026-08-07).

- **`probe.md`'s light-mode simulatable list is mostly unreachable.**
  Seven of the nine parameters it lists feed `score`, which drives
  `mmrRank`'s greedy pick order, which needs the per-row vectors light
  mode does not store.
  [`probe.md → Simulatable parameters`](../memory/probe.md#simulatable-parameters)
  reads as though `λ_div` were the only parameter needing
  candidate-vs-candidate cosines; the cosines are needed for any MMR
  recomputation at all. The two that apply after MMR do not both
  survive either: the per-type budgets do — **verified during the
  Slice 3.5 whole-implementation review (2026-08-09)**: `belowFloor` in
  `rankPerType` is a latch, so the first captured `below_threshold` row
  pins the partition and no budget change can move it, and re-walking
  captured `mmr_rank` order against `tokens_estimated` reproduces the
  fill exactly — but `min_score_threshold` compares
  against `mmrScore`, and the capture stores only `final_score`, which
  is the **pre-MMR** raw score (`trace()` in `lib/retrieval/ranker.ts`
  sets `finalScore: s.score`; `mmrScore` is dropped). So the honest
  light-simulatable list may be the per-type budgets alone. Decide light
  mode's real offer — accept the narrower list, capture `mmr_score` per
  row (one float, recovers the threshold), or store the kept-set
  pairwise cosine matrix (~80 KB per type at a saturated pool, recovers
  everything) — before M7.5 builds the simulator. Slice 3.5 left the
  list itself unchanged and ran its parity test on deep captures, the
  only mode that can reach `mmrRank`; its whole-implementation review
  added an under-review caveat above the list, so a probe.md reader
  cannot build against the unqualified promise. Surfaced during Slice
  3.5 planning (2026-08-08), sharpened during Task 15 (2026-08-09),
  budgets verified 2026-08-09.
- **`distributeQueryVectors` assumes a short embed result dropped its
  trailing texts.** It fills present slots positionally
  (`out[i] = vectors[next++] ?? null`, `lib/retrieval/queries.ts`), so a
  provider returning all-but-the-middle would record Q3's vector as
  Q2's. `sims` would still be truthful about _which slots hold a
  vector_, and blend replay stays exact because it reconstructs from
  `sims` itself — so this does not threaten probe parity. But it is
  undetectable today and bounds how far the "one source of truth"
  property actually reaches. Surfaced by the Slice 3.5 Task 1 review
  (2026-08-08).
- **`RankAllInput` carries no `capturedTokens`, so a whole-bundle probe
  replay is impossible.** `rankPerType` takes it; `rankAll` does not,
  and object-literal excess-property checking rejects passing it
  through. Slice 3.5's parity test replays per type, so nothing is
  blocked today — but this is deliberate-by-omission rather than
  designed, and an M7.5 simulator that wants to re-run a whole captured
  pass at once will need `RankAllInput` widened. Surfaced by the Slice
  3.5 Task 2 review (2026-08-08).
- **`lib/db/world-json-types.ts` has outgrown its name.** It now holds
  ~85 lines of probe-capture cluster (`CaptureCandidate`,
  `CaptureQuery`, `CaptureParamsSnapshot`, `CaptureTokenizer`,
  `ProbeCapturePayload`, `CAPTURE_VERSION`) beside `ClassifierStatus` —
  a genuine JSON column — and `DropReason`, which is neither. The
  capture payload is not a JSON column at all; it is a gzipped BLOB.
  Splitting the cluster into `lib/db/probe-capture-types.ts` restores
  the name's meaning and keeps the `@/lib/retrieval` import off the file
  `stories.table.ts` imports. Deferred out of Slice 3.5 deliberately: a
  `git mv`-shaped change with inbound references, not worth reshuffling
  files mid-slice. Surfaced by the Slice 3.5 Task 8 review (2026-08-08).
- **The fork-exclusion guard is structural and goes stale the moment
  fork lands.** Branch fork is unimplemented (M6.1), so Slice 3.5 could
  not test the real behavior: `lib/probe/fork.test.ts` instead
  source-scans `lib/**` for `probe_captures` references outside an
  audited list, plus a direct query assertion that a sibling branch
  stays empty. Neither catches the regression most likely to actually
  happen — if M6.1 copies branches **generically** (iterating a manifest
  or introspecting branch-scoped tables from the schema), the fork code
  will never contain the literal `probe_captures`, the scan stays green,
  and captures copy anyway. The manifest row now exists in
  [`data-model.md → Branch model`](../data-model.md#branch-model), so
  a generic copier has a canonical exclusion to read. **When M6.1 lands
  branch fork, replace the structural scan with the both-sides
  behavioral test** the slice AC originally described. Surfaced by the
  Slice 3.5 Task 14 review (2026-08-09).
- **A non-embedder retrieval fault writes no capture, which is the
  case the probe most wants.** `runRetrieval` converts only
  `VectorInvariantError` into a captured failure and rethrows
  everything else — correctly, since routing a SQL fault to the
  "Switch embedder" surface would offer a re-index as the fix for a
  locked database. But the rethrow escapes `retrievalPhase` before the
  capture site, so a vec0/SQLite error, a dead IPC bridge or a ranker
  bug produces no capture at all. `failure_reason` is an
  `EmbedderErrorKind`, and `lib/embedder/types.ts` deliberately ties
  that union to the IPC envelope's own tag, so a third tier cannot be
  added to one side only — closing this needs a **capture-failure
  taxonomy separate from the embedder's**, threaded through
  `RetrievalPartial`, plus a capture-then-rethrow in the phase.
  `probe.md` was narrowed to state the gap rather than promise the
  behavior. Surfaced by the Slice 3.5 review (2026-08-09).
- **The probe browse route decodes every payload in the story to
  render a list that shows none of them.** `capturesForStoryQuery`
  selects `pc.payload`, `decodeCaptures` gunzips and `JSON.parse`s all
  of them, and `app/dev/probe-captures.tsx` retains the lot — while the
  list rows render only column data (`id`, `branch_id`, `capture_mode`,
  `payload_size`, `failure_reason`). Harmless at light-capture scale
  (~3-6 kB each, measured on a real dev story), but a deep capture runs
  ~18 MB uncompressed at dim 768 on a scale-assumption pool, and the
  slice's own manual AC asks for deep captures to be browsed. Failure
  is self-trapping: Delete is unreachable without loading first. Fix is
  a payload-free list query plus decode-on-View, which also moves
  corruption detection onto the specific row. Deferred as latent.
  Surfaced by the Slice 3.5 review (2026-08-09).
- **The desktop-Popover / phone-Sheet tier wrap is written twice.**
  `components/wizard/ai-assist.tsx` and
  `components/ui/searchable-overlay-list.tsx` each carry the same
  phone branch — a single `View` wrapping the trigger plus a
  `Sheet`, with its own copy of the reasoning for why the wrap
  exists (the `@rn-primitives/dialog` Root renders a real portaled
  sibling while closed, so a Fragment leaks two layout children into
  the consumer's row). Only the phone half is a genuine duplicate:
  the desktop halves legitimately differ, because
  `SearchableOverlayList` drives raw `PopoverPrimitive` for a
  controlled-open bridge and trigger-width matching that the shared
  `Popover` wrapper does not support, so unifying that half would
  either bloat the wrapper or strip its escape hatches. The drift
  cost is already demonstrated rather than hypothetical: the preset
  browser's first commit diverged from the assist component's
  already-correct trigger-labelling pattern and needed a follow-up
  fix to re-derive it — it has since been rebuilt on
  `SearchableOverlayList` and no longer carries a copy, which is why
  this counts two rather than three. Extract a small shared
  phone-wrap helper when a third caller appears, or the next time
  both need the same change in lockstep — not before. Surfaced by
  the Slice 3.6a Task 8 review (2026-08-10).
- **`validateRegistry` cannot catch a template using an undeclared
  variable.** It checks two things — every `TemplateId` has a
  `TEMPLATE_GROUPS` mapping, and every name in `DISPLAY_GROUPS`
  resolves to a `VariableDef` — but it never reads template Liquid
  source, so the direction that actually matters for prompt
  correctness is unchecked: a template referencing a variable nobody
  declared renders blank at runtime and passes every test. The
  project already knows this (`templateContextMap.test.ts` says
  "validateRegistry only walks display groups toward variables,
  leaving both reverse directions unchecked"), so this entry is
  about whether to close it rather than a new discovery. Closing it
  means parsing `{{ ... }}` and `{% ... %}` out of each registered
  template and asserting every root identifier is declared for that
  template's group — cheap, and it would make the context map a real
  contract instead of documentation. Surfaced by the Slice 3.6a Task
  9b review (2026-08-10).
- **Four assist result types are hand-redeclared beside their
  schema-inferred equivalents, and the inferred ones are dead.**
  `components/wizard/wizard-assist.ts` declares `LoreAssistValue`,
  `GenreAssistValue`, `ToneAssistValue` and `SettingAssistValue` by
  hand; `lib/wizard` simultaneously exports `LoreSuggestions`,
  `LabeledPromptOutput` and `SettingOutput` inferred from the Zod
  schemas, and nothing imports them. A field added to a schema will
  not appear in the hand-written type and will not fail the build,
  because Zod's `ZodType` stays assignable — it is simply typed
  away. Collapse the hand-written ones onto the inferred ones.
  (`GenreAssistValue` and `ToneAssistValue` are also byte-identical
  to each other.) Surfaced by the Slice 3.6a whole-slice review.
- **The preset browser drops canon's hover body preview.**
  [`wizard.md → Step 3`](../ui/screens/wizard/wizard.md#step-3--world)
  specifies each preset row as `displayName · tagline · preview body
on hover`; the shipped rows render label and tagline only, so the
  multi-paragraph `promptBody` is invisible until after the pick —
  which is exactly the pick the replace-confirm exists to protect.
  Either build the hover preview or amend canon. Surfaced by the
  Slice 3.6a whole-slice review.
- **Post-3.6a tidy in `components/wizard/`.** Three small
  consistency items, none behavioral: the refine seams are named
  `refineOpening` / `refineDescription` in one file and
  `genreRefine` / `toneRefine` / `settingRefine` in another, and
  3.6b has to pick one; `blank()` is defined twice in the folder
  (`step-world-logic.ts` and `lore-list.tsx`); and
  `assist-list-logic.ts` breaks the folder's `<component>-logic.ts`
  pairing convention since it belongs to `ai-assist.tsx`. Surfaced
  by the Slice 3.6a whole-slice review.
- **Emoji stand in for icons across the app; sweep and replace.**
  User-facing chrome carries literal emoji and glyphs where the
  design system has an icon primitive — `✨` prefixes every AI-assist
  heading and several trigger labels, `⭐ Set as lead` and the
  `▼ More options` / `▼ Visual` disclosures are specced as glyphs in
  `wizard.md`, and arrows like `→` are baked into locale strings
  (`common:calendarPicker.manageInVault`, and entries across
  `settings`, `embedder`, `landing`, `reader`). Emoji render
  inconsistently across platforms and font stacks, cannot be themed
  or sized with the rest of the chrome, and land inside translatable
  strings where they are not translatable content. Sweep `components/`,
  `app/`, and `locales/` together: replace with `Icon`/`IconAction`
  where the glyph is decoration or an affordance, keep it only where
  it is genuinely textual. Canon in `wizard.md` specifies some of
  these as glyphs, so amending the doc is part of the work rather
  than a follow-on. Raised 2026-08-11.
- **A generation sheet is easy to dismiss and takes unsaved output
  with it.** Every overlay dismiss path — tap-outside, swipe-down,
  Escape, hardware back — routes through `resetOnClose`, which aborts
  the in-flight request and clears `assist` and `listItems`
  unconditionally. That is correct for an untouched overlay and
  destructive once a result exists: a generated preview, or an
  accumulated multi-page list with rows already checked, is gone with
  no undo and no way back but regenerating. The exposure grows with
  the sheet, since swipe-down is both the cheapest gesture and the
  easiest to trigger accidentally. Decide the shape: confirm before
  discarding a dirty overlay, keep results across a dismiss and
  restore them on reopen, or block the swipe once a result has
  landed. Applies to `AiAssist` first but the same reset pattern will
  reach 3.6b's cast suggestions. Raised 2026-08-11.
- **`formatWorldTime` re-parses its Liquid template on every call.**
  `lib/calendar/render.ts` runs `parseAndRenderSync` per invocation,
  so a screen that formats N times parses the calendar's
  `displayFormat` N times. Measured at the reader's 50-entry window:
  2.1 ms of a 16.9 ms decoration walk, against 13.0 ms in
  `worldTimeToTuple` — the smaller half, and Slice 3.8 absorbed the
  duplicate-value rows with a call-local memo, so nothing is blocked.
  It became worth naming because 3.8 turned this from one call per
  render into one per row. Caching the parsed template by
  `displayFormat` is a small change in `render.ts`. The `worldTimeToTuple`
  half is no longer the larger one: the tier walk stopped scaling with the
  year on 2026-08-18 (top-tier costs are periodic, so both conversions do
  cycle arithmetic), which took the same 50-row walk from 24.0 ms to
  3.4 ms — re-measure before treating the Liquid parse as the small half.
  Raised 2026-08-15 by the Slice 3.8 Task 2 review.
- **`worldTime === 0` is overloaded: story origin and flashback
  sentinel.** The opening entry and every user action that inherits
  from it sit at 0, `lib/calendar/render.ts` special-cases 0, and the
  classifier emits 0 for flashbacks. The monotonicity check therefore
  cannot see a genuine backwards jump that lands exactly on 0 — it is
  indistinguishable from a flashback and stays unflagged.
  `docs/ui/patterns/entry-card.md` prescribes this convention, so
  Slice 3.8 implements it as specified; the note exists so the next
  person to ask "why is this regression not warned about?" finds the
  answer. Revisit if flashbacks ever get their own marker.
  Raised 2026-08-15 by the Slice 3.8 Task 2 review.
- **A narrow story decorator silently detaches nodes captured in
  `play`, turning interaction assertions vacuous.** `FormRow` guesses
  `stacked` from `useTier()` (which reads the window: 1200 px in the
  vitest browser), then corrects it from `onLayout` against the real
  container width. When those disagree, the JSX branch swaps ~1-5 ms
  after mount and `children` remount at a new position — so a field
  node captured before that is detached, keystrokes land on the dead
  node, and the component keeps its seed state. A story that "types a
  value and asserts the result" then passes green having typed
  nothing. Width sweep on the same file confirms the boundary is
  exactly `NARROW_THRESHOLD_PX = 640`: detaches at 560 and 639, clean
  at 641, 900, 1100. Two traps found alongside it: NativeWind width
  classes do **not** compute in the vitest storybook browser (both
  `w-[560px]` and `w-24` measure 1200 px) while inline `style={{
width }}` does, so a class-width decorator and a style-width
  decorator are not comparable controls; and first-story immunity is
  incidental, not a rule — `useWindowDimensions()` sometimes returns 0
  on first mount, which happens to make the guess match. Reachable
  wherever a play-driven story puts a `FormRow` under an effective
  width below 640 and captures a node before typing.
  `entry-card.stories.tsx` has no `FormRow` and is unaffected (20/20
  green); `components/wizard/wizard-shell.stories.tsx` uses an inline
  375 px phone frame and is worth a check. Decide whether the fix is a
  lint/guard on narrow decorators, a `FormRow` that does not guess
  before measuring, or a documented story-authoring rule. Raised
  2026-08-15 by the Slice 3.8 Task 4 review.
- **Storybook viewport globals: named keys only, and the default is
  desktop.** `@storybook/addon-vitest` applies
  `setViewport(parameters, globals)` before each story runs, so a
  story can select a tier with `globals: { viewport: { value:
'mobile1' } }` — no `vi`, no `Dimensions.set()`, no
  `@vitest/browser/context` import. Two traps found while using it in
  Slice 3.8. First, `setViewport` only honours a key present in
  `{...MINIMAL_VIEWPORTS, ...options}`, so the `'{width}-{height}'`
  form documented in `storybook/dist/viewport/index.d.ts` (e.g.
  `'320-480'`) **silently falls back** to the default instead of
  failing — a story written that way claims a tier it never ran at.
  Second, `DEFAULT_VIEWPORT_DIMENSIONS` is 1200x900, so every story
  without a viewport global runs at **desktop** tier (>= 1024), not at
  some neutral width; a story that means to exercise phone or tablet
  behaviour and omits the global tests desktop and passes for the
  wrong reason. Worth a documented story-authoring note, and worth
  auditing any existing story whose name or docblock claims a
  narrow-tier behaviour. Raised 2026-08-15 by the Slice 3.8 Task 5
  review.
- **`useTier()` now runs per `EntryCard`, and on native it re-fires on
  keyboard show/hide.** Slice 3.8's tier fork put a `useTier()` call
  inside every `EntryCard`, and `components/reader/reader-surface.tsx`
  renders one per row in a non-virtualized `.map()`, so every window
  dimension change re-renders the whole loaded window. On desktop that
  is resize-only and rare. Inside the expo-dom WebView on native,
  `useWindowDimensions()` also fires when the soft keyboard shows or
  hides — which happens on every composer focus and every world-time
  edit on phone, i.e. exactly during the interactions this slice adds.
  Not measured. Options if it shows up in a profile: hoist the tier
  read to `ReaderSurface` and pass it down, or give `EntryCard` a tier
  override prop defaulting to its own read. Raised 2026-08-15 by the
  Slice 3.8 Task 5 review.
- **A BC-style origin renders every non-opening entry in the wrong
  era.** `formatWorldTime` short-circuits at `worldTime === 0` and
  renders the origin tuple directly, which is the only path that can
  express a year below a tier's `startValue`. One second later the
  normal path takes over, and `tupleToBaseUnits` cannot represent
  `year < 1` for `earth-gregorian` (its loop `for (v = 1; v < -43;
v++)` never runs), so the era is silently lost. Observed with origin
  `{year: -43, month: 3, day: 15}`: `worldTime 0` renders
  `"March 15, 44 BC 0:0"` and `worldTime 1` renders
  `"March 15, 1 AD 0:0"` — a hard discontinuity one second past the
  origin. The zero short-circuit is not the bug, it is the mask; the
  real fix is in `tupleToBaseUnits` / `baseUnitsToTuple`, which have no
  representation for values below a tier's `startValue`. Nothing in v1
  ships a BC origin, and Slice 3.8 deliberately left the guard intact
  rather than widening its scope. Raised 2026-08-15 by the Slice 3.8
  calendar fix.
- **`components/ui/popover.tsx` renders nested `role="dialog"`
  elements.** Radix's own content wrapper plus `NativeAwareContent`'s
  inner View both carry the role, so an unfiltered
  `getByRole('dialog')` resolves to two elements and trips Playwright's
  strict mode and Testing Library's multiple-match error. Only the
  inner node carries an accessible name, so a name-filtered query
  happens to resolve uniquely today — which means the hazard is
  invisible until someone writes the unfiltered form. Affects every
  Popover consumer, not one slice. Either drop the role from the inner
  View or stop `NativeAwareContent` re-declaring it. Raised 2026-08-15
  by the Slice 3.8 Task 5 and Task 7 reviews.
- **`getCalendar` consults only code builtins, never the
  `vault_calendars` table.** The seeded story sets `calendarSystemId:
'cal_default'` and a matching `vault_calendars` row exists, but the
  registry holds only `earth-gregorian`, so every story falls through
  to the default and renders Gregorian dates regardless of the
  calendar it was configured with. Slice 3.8 relies on that fallback
  being load-bearing and correct, so nothing is broken today — but it
  means the registry-hit path is unexercised by seed data and a
  user-authored calendar would be silently ignored once the vault can
  hold one. Decide whether resolution is meant to be registry-only,
  DB-backed, or registry-with-DB-overlay. Raised 2026-08-15 by the
  Slice 3.8 Task 6 implementation.
- **Vitest treats a value returned from `beforeEach` as a teardown
  callback.** A concise arrow body — `beforeEach(() => mock.mockReset())`
  — implicitly returns the mock, which Vitest then _invokes_ after each
  test. When the mock's implementation throws, the throw surfaces as a
  test failure whose stack points at the `throw` statement, reading
  exactly like "the code under test does not handle errors" when the
  code is fine. Cost real debugging time during Slice 3.8. Use a block
  body in `beforeEach`. Worth a line in the testing conventions or a
  lint rule, since the failure mode actively misdirects. Raised
  2026-08-15 by the Slice 3.8 Task 6 fixes.
- **Post-3.8 tidy in the reader and UI layers.** Four small items, none
  behavioural. The reader route still uses bare `void action(...)` on
  `handleCommitEdit` despite `runAction` existing in `lib/utils.ts`
  specifically to replace it, and there is no global unhandled-rejection
  handler, so a thrown action error produces no toast and no log. The
  calendar-fallback expression is duplicated verbatim between the
  reader route's world-time hook and `app/wizard.tsx`, and belongs in
  `lib/calendar` as a `resolveCalendar` policy alongside the registry;
  its trailing `?? null` is unreachable and its `useMemo` is
  unnecessary, both of which dissolve in that move.
  `DisabledReasonTooltip` is now used for a warning on an _enabled_
  control, so its name and TSDoc no longer describe it — a rename or a
  thin generic alias would fix it. And `saveEdit` in
  `e2e/locators/reader.ts` is page-scoped, which was unambiguous until
  3.8 added a second Save button to the reader; not reachable today
  since the two overlays cannot both be open, but it is one strict-mode
  violation away. Raised 2026-08-15 by the Slice 3.8 reviews.
- **`per-turn-retrieval.test.ts` fails intermittently, but only when
  `pnpm test:run` runs the unit and storybook projects in one
  invocation.** Originally observed 2 failures in 4 consecutive
  `pnpm test:run` invocations while closing Slice 3.8. The failing pair is
  always `retrieval phase — embedder config > fails blocking when the
embedder config does not resolve` (hits the default 5 s test timeout at
  ~5020 ms, so `runRetrievalPhase()` hangs) and `retrieval phase — abort >
survives a post-sync recount that rejects, warning instead of failing`
  (fails in ~11 ms, consistent with a cascade). What was ruled out: the
  file passes 60/60 five times run alone, 3/3 more while a full storybook
  run saturates the machine concurrently, and the storybook project alone
  passes 3/3 — so plain CPU contention is not the trigger.
  **Mechanism identified, fix unverified (2026-08-18).** `retrievalPhase`
  imports `@/lib/actions` lazily, to break a require cycle, and that import
  sits _after_ the working-set guards — so the first test to get past those
  guards is exactly the one that flakes, and it is the one that pays the
  cold resolution of that barrel plus, through the `vi.mock` factory's
  `importOriginal`, the real module graph behind it. Ten other unit test
  files import the same barrel **statically**, resolving it at module load
  where no test timeout applies; only this file and
  `lib/boot/classifier-scheduler.test.ts` defer it into a test body. That
  asymmetry is the only structural difference that explains why this one
  test, in a combined invocation, exceeds a budget it otherwise uses 204 ms
  of (measured in isolation — a 24x margin). A `beforeAll` now resolves the
  barrel ahead of the tests. **This is mechanism-directed hardening, not a
  verified fix: the flake did not reproduce here (4/4 combined runs green,
  3970 tests), so the hardening could not be shown to change an
  observed failure.** If it recurs after this, the mechanism is wrong and
  the next suspect is shared state across the two projects rather than
  module-resolution latency. Raised 2026-08-15 while closing Slice 3.8.
  Separately and still open: a git worktree with a symlinked `node_modules`
  cannot run the storybook project at all (the addon setup file 404s outside
  the vite root), which blocks every reviewer working from a worktree.
- **`patches/js-tiktoken.patch` is load-bearing for Android and nothing
  fails if it is dropped.** `js-tiktoken`'s `Tiktoken` constructor stages
  the decompressed BPE ranks in a plain object before copying them into
  its two `Map`s. That staging object reaches 199,998 properties, and
  Hermes caps object property storage at 196,607
  ([facebook/hermes#851](https://github.com/facebook/hermes/issues/851)),
  so `new Tiktoken(o200kBase)` throws `RangeError` on Android. It is
  reached on the reader route via `useOpenRegionTokens` → `countTokens`,
  which means **opening any story crashes on Android** — since Slice 3.4b
  wired the hook, not since 3.8. The patch swaps the staging object for a
  `Map`; verified equivalent, not merely plausible: same 199,998 pairs,
  zero rank mismatches, and zero duplicate byte-keys or ranks, so the
  differing iteration order cannot change either `Map`'s contents. The
  hazard is that **no test can catch its removal** — Node has no property
  cap, so the whole suite passes green with the patch reverted, and a
  `js-tiktoken` bump that fails to reapply it silently re-breaks Android.
  Options: a bundle-level assertion that the staging object is gone, an
  Android smoke in CI, or upstreaming the `Map` change. Raised 2026-08-16
  by the Slice 3.8 Android smoke.
- **`updateEntryWorldTime`'s read-modify-write is serialized only
  against itself, not against the pipeline's writes to the same row.**
  `updateStoryEntryMetadata`'s handler is a whole-column replace
  (`.set({ metadata })`, no merge), and `updateEntryWorldTime` reads
  `current.metadata` outside the transaction, then dispatches. Its
  `withKeyLock` key is per-action, so it does not serialize against
  `suggestion-refresh` or `per-turn-piggyback` dispatching the same
  kind at the same entry — an interleave is a silent lost update in
  whichever direction loses. What actually prevents it today is that
  both pipeline writers run under `hard-gate` pipelines, which
  `isUserEditBlocked` rejects; the gate is now re-checked immediately
  before the dispatch, which closes the awaited-read window but not the
  dispatch itself. The trap for whoever fixes this properly: sharing
  the key with `applyDeltaAction` **deadlocks**, since `withKeyLock` is
  not reentrant and the inner call would await the outer's own promise.
  The real fixes are a reentrant lock or building the payload inside
  the transaction; both are larger than a slice. Raised 2026-08-16 by
  the Slice 3.8 review.
- **The calendar-registry fallback now backs a write path, not just
  rendering.** Already filed above for display: every story falls
  through to `earth-gregorian` because the registry never consults
  `vault_calendars`. Two corollaries the display framing does not
  cover. (1) The fallback calendar defines the world-time edit form's
  tiers _and_ its inverse conversion, so a user edits Minute/Second
  fields the story's own calendar does not have and those seconds are
  written to `metadata.worldTime`; when the registry eventually
  resolves the real calendar, previously-saved values silently mean
  something different. (2) The reader and the prompt disagree —
  `generation-context.ts` calls `getCalendar` with no fallback and
  sends `calendarVocabulary: null`, so the reader shows Gregorian dates
  while the model is told there is no calendar. Raised 2026-08-16 by
  the Slice 3.8 review.
- **`Select`'s dropdown trigger drops the current value from its
  accessible name once `label` is set.** `@rn-primitives/select`
  forces `role="button"` on the web trigger, overriding Radix's
  `combobox`, so the element carries no value semantic at all — the
  selected option reaches assistive tech only as the trigger's text
  content. Adding `aria-label` (the fix for triggers that renamed
  themselves on every pick) then suppresses that content: the month
  picker in `tier-tuple-input.tsx` announces "Month, button,
  collapsed" and never "January". Neither state is complete —
  before the label there was a value and no field identity, after it
  there is identity and no value. Reviewed and deliberately kept as
  identity-only: the value is one open away (Radix renders options
  with `role="option"` / `aria-selected` and focuses the selected one),
  while identity is unrecoverable because `FormRow` renders its label
  as plain `Text` with no `htmlFor` / `aria-labelledby`. The real fix
  is a `combobox` role on the trigger, where content is read as the
  value beside the label. Plausible-but-unverified path: the web build
  destructures `role: _role` out of the trigger's props and hardcodes
  `role='button'`, so a `patches/` one-liner deleting that destructure
  would let a caller-supplied `role="combobox"` through — nobody has
  applied or tested it. Applies to every `dropdown`-mode `Select` that
  carries a `label`. Raised 2026-08-13.
- **The wizard commits `parent_location_id` without the documented
  cycle guard.**
  [`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)
  assigns cycle prevention to the action-layer mutator that writes
  the field: walk the proposed parent chain, depth-cap 100, reject
  with `reason: 'parent-cycle'`. Finish is such a writer and does no
  walk, and neither authoring path blocks it — the editor's picker
  and `cast-import.ts` each exclude only self, so `A → B` plus
  `B → A` authors and commits cleanly. Inert today: nothing walks the
  chain, and the only reader canon names is M4's prompt rendering
  (`Aria is in [Shop in Town Square in City]`). Close by adopting M4's
  shared guard rather than writing a wizard-local copy of it. Raised
  2026-08-14.
- **A single malformed row resets the whole wizard draft.**
  `parsePersistedState` (`lib/actions/wizard/session.ts`) runs one
  `safeParse` over the entire working state, so one bad `cast` or
  `lore` row discards the title, description, genre, tone, setting,
  calendar, opening prose, and every healthy sibling row — reported
  via toast and `logger.warn`, so not silent, but all-or-nothing. Not
  reachable today: every writer is typed and the schema strips unknown
  keys rather than rejecting them, so the realistic triggers are a
  future schema tightening or a hand-edited database. The
  element-wise salvage pattern to copy already exists at
  `decodeCaptures` in `lib/probe/read.ts`, which isolates a corrupt
  row instead of failing the list. Raised 2026-08-14.
- **Custody of a failed turn's text rests on one deletable system entry.**
  A failed or refused turn reverse-replays its own `user_action` with the
  rest of its action group (`abortRun` → `reverseReplayDeltas`, and
  `submitTurn`'s own rejected arm), so the text the user typed survives
  only as `metadata.systemFailure.submission` on the failure entry that
  replaces it — pinned by `submit-turn.test.ts`'s
  `expect(branchEntries('b1')).toHaveLength(0)`. Two paths then delete
  that entry with no restore: **Dismiss** (`dismissSystemEntry` is a bare
  `clearSystemEntry` plus `reload`, and dismissing an error is not a
  request to discard the draft behind it), and the pre-dispatch tail clear
  (fixed for regenerate's rejected arm in M3.10, still uncompensated when
  the dispatch throws). In-session `lastSubmission` masks both; after a
  restart the text is gone. The alternative shape to weigh: keep the
  `user_action` standing on failure and let Retry re-dispatch against it —
  which is exactly what regenerate already does — so only an explicit
  cancel reverses it, returning the text to the composer. That would make
  the failure entry a pure notice with no custody role and delete this
  class of bug rather than patching its instances. Wants a reader-composer
  design pass, not a local fix. Raised 2026-08-16.
- **`text-transparent` was never proven to apply to `Text` on Android.**
  The composer's lint overlay stacks an invisible copy of the whole draft
  over the input to carry underlines, and it was the codebase's only user
  of `text-transparent`. On Android that copy painted, showing as doubled
  glyphs. The overlay now renders only when lints exist, which is never
  on native (harper needs WebAssembly, Hermes has none), so nothing
  depends on the class there today and the visible bug is gone — but the
  cause was not diagnosed on-device, only routed around. Anything that
  later wants invisible native text (a native linter restoring this
  overlay, a measurement mirror, a fade-through) must verify on hardware
  that the class resolves rather than assuming parity with RN-Web, which
  handles it correctly. Raised 2026-08-17.
