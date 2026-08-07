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
- **`PER_TURN_NARRATIVE`'s "Story so far" loop echoes each entry's raw
  `content`, tags and all.** `lib/prompts/bundled/per-turn.ts`'s
  `{{ entry.content }}` (inside the `recentEntries` loop) renders the
  persisted `story_entries.content` column verbatim; nothing strips a
  trailing `<state>` or `<suggestions>` block before it's re-injected —
  those blocks are stripped only for display, by `stripTrailingBlocks`
  in `entry-card.tsx`, which never touches what's stored. So every
  prior AI turn's trailing block(s) re-enter the next prompt as if they
  were narrative prose. Pre-existing for `<state>`; this slice's
  `<suggestions>` block is a second instance of the same leak.
  Stripping in the `recent` filter that windows entries into
  `recentEntries` would fix it but changes what already-merged piggyback
  behavior sends the model, so it needs an owner and a token-cost
  measurement before anyone touches it. Surfaced by M3.7a Task 1
  (2026-07-25). **M3.4 added two more consumers of the same raw
  column, both in retrieval.** (1) Q3's prose extract runs over
  `lastNarrative.content`, and the tail survives sentence splitting as
  a single pseudo-sentence — `splitSentences` needs terminator plus
  whitespace, which `</summary>` and `</state>` never provide — that
  scores above real narrative (measured 5 against 0–3 on the shipped
  scorer, since the `<summary>` line names entities and the XML
  attribute quotes register as dialogue). One of Q3's four slots is
  spent on tags, opaque ids, and suggested actions the story did not
  take, which is what
  [`retrieval.md → Q3`](../memory/retrieval.md#q3-heuristic-prose-extract)
  exists to avoid. (2) Layer-A same-name suppression scans
  `composePromptBuffer(...).content`, so a reader clicking a
  suggestion that names a staged entity suppresses that entity from
  the pool on the very turn it is introduced — the "who is this
  person" failure the structural floor exists to prevent, arriving
  through the mechanism meant to prevent collisions. Stripping at the
  caller fixes all three consumers at once; the retrieval module
  cannot do it itself, since it has no way to know which tags a pack
  emits. Surfaced by the M3.4 review (2026-08-06).
- **`runPreflight` omits `storyModels` from the `ResolveModelConfig` it
  builds, so a story-level model override can't satisfy pre-flight even
  though the runtime call resolves fine.** `lib/pipeline/runtime/preflight.ts`
  constructs its `config: ResolveModelConfig` from only `providers`,
  `profiles`, `assignments`, and `defaultProviderId` off
  `snapshot.appSettings` — never `snapshot.storySettings?.models` —
  even though `resolveModel` (`lib/ai/resolve-model.ts`) checks
  `config.storyModels?.[target]` for story-override targets, and every
  runtime call site (`per-turn.ts`, `per-turn-piggyback.ts`,
  `suggestion-refresh.ts`) already passes `storyModels: open.settings.models`
  correctly. A story that overrides `narrative` or `classifier` (or,
  once wired, `suggestion`) at the story level therefore resolves fine
  when the call actually fires, but pre-flight — which runs first and
  gates the whole run — halts on config that works. Affects
  `narrative` / `classifier` today; inert until a UI writes story-level
  model overrides. One-line fix: add
  `storyModels: snapshot.storySettings?.models` to the config passed
  into `resolveModel`. Surfaced by M3.7a Task 7 (2026-07-25).
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
- **Config pre-flight cannot see story-level model overrides, so it
  both passes runs that will fail and blocks runs that would
  succeed.** `runPreflight` (`lib/pipeline/runtime/preflight.ts:14`)
  builds its `ResolveModelConfig` from `snapshot.appSettings` only and
  never passes `storyModels`, even though `orchestrator.ts` puts
  `storySettings` in the snapshot and every phase passes
  `open.settings.models`. Since `resolveModel` branches on
  `config.storyModels?.[target]` for story-override targets
  (`lib/db/app-settings/agents.ts` → `STORY_AGENT_IDS`), pre-flight
  always takes the assignments path while the phase takes the override
  path. Both directions are wrong: a story with `settings.models.X` set
  and a missing `defaultProviderId` clears pre-flight and fails
  in-phase, and a story whose override would resolve is rejected by
  pre-flight when app-level assignments are empty. Affects every
  story-override target, `narrative` included — it is a framework gap,
  not a suggestions one, which is why it is here rather than in the
  slice. Fixing it is a one-line config addition plus a decision about
  whether pre-flight should resolve per-story at all (it is currently
  documented as an app-config check). Surfaced by M3.7a review
  (2026-07-31).

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

- **`components/compounds/save-bar.tsx` uses the deprecated
  `pointerEvents="none"` prop form**, which React Native flags as
  deprecated in favor of `style.pointerEvents` on every render
  (visible in test output). Pre-existing; not fixed in M3.7b to keep
  that commit to its scope. Surfaced by M3.7b implementation
  (2026-07-31).

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
- **`retrieval.md`'s MMR cost model understates measured cost by ~2.5x,
  and its complexity claim doesn't match the shipped algorithm.**
  [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  budgets "<5ms per type" for MMR after the top-200 pre-filter, and
  [`Diversity — MMR`](../memory/retrieval.md#diversity--mmr) calls it
  "sub-millisecond" for pools in the hundreds. Measured on the M3.4
  implementation (Node 24 / V8, desktop, `Candidate`-shaped payloads,
  N=200): **6.55 ms at dim 384 and 12.32 ms at dim 768**. dim 768 is a
  shipped config — `onnx-community/embeddinggemma-300m-ONNX` in
  `catalog-data.json` — so five types cost ~61 ms of the doc's ~100 ms
  total per-turn target before anything else runs. Restructuring is
  **not** the lever: a `Uint8Array` bitmap variant measured only 10-18%
  faster, and the irreducible cosine floor alone is 4.34 ms at N=200.
  Separately the doc states MMR is `O(N × K)`, but C4's per-candidate
  trace requires a rank for every candidate that entered MMR
  (`CandidateTrace.mmrRank` is documented as null only for pre-filtered
  rows), which forces the full `O(N²)` greedy ranking — roughly 5x the
  work the cost model assumes. The implementation is correct; the
  budget line was written against a different algorithm. Wants either a
  corrected budget or an explicit decision that the trace contract is
  worth the cost. **Open sub-question, unmeasured:** `retrieval.md`'s
  PoC puts a 384-dim dot at ~24-30 µs on Hermes; if that holds, 19,900
  dots is ~500 ms per type on mobile, which would dominate the turn.
  Nobody has run MMR on-device. Surfaced by M3.4 Task 5 review
  (2026-08-01).
- **Lore `priority` is inert in the shipped ranker, and a user-facing
  control promises otherwise.** Two canon statements conflict.
  [`retrieval.md → Per-type decay rates`](../memory/retrieval.md#per-type-decay-rates)
  says lore "ranks purely on `sim_blend × (priority/100) + kw_boost`",
  and [`world.md → Lore detail`](../ui/screens/world/world.md) exposes a
  0-100 `priority` input whose tooltip repeats that formula. But the
  authoritative [Pseudocode](../memory/retrieval.md#pseudocode) puts
  `pin_signal` **only** inside the recency exponent, and λ_lore is 0 —
  so the exponent is 1 regardless and `priority` cannot move a lore
  row's score at all. Verified empirically against the M3.4
  implementation: `pinSignal: 1` and `pinSignal: 0` produce identical
  `finalScore` for lore. Note the alternative formula is also wrong as
  literally written — multiplying by `priority/100` would zero every
  lore row at the default `priority = 0`. This also makes probe.md's
  simulatable "`pin_signal` overrides" a dead control for lore. M3.4
  followed the pseudocode (the designated authority) and is not at
  fault; canon needs a design decision on what `priority` should
  actually do. Blocks nothing in M3.4; blocks the World panel's lore
  editor meaning what it says. Surfaced by M3.4 Task 6 review
  (2026-08-01).
- **Token estimation costs ~180x its budgeted line, for the same
  reason MMR does.** [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  budgets "Token estimation — <1ms total". Measured with the production
  `countTokens` (js-tiktoken `cl100k_base`) on ~69-token rows:
  **60.5 µs/row, ~181 ms for 3000 rows**. C4's per-candidate trace
  makes `CandidateTrace.tokensEstimated` non-nullable, so every pool
  row must be tokenized, not just the ones budget-fill reaches — the
  same trace-contract-vs-cost-model tension already recorded for MMR
  above. One concrete mitigation exists with **zero contract loss**:
  `preFilterTopN` is absent from
  [`probe.md → Simulatable parameters`](../memory/probe.md#simulatable-parameters),
  so a pre-filtered row can never be seated by the simulator at any
  threshold or budget — meaning the pre-filtered excess need not be
  tokenized at all. Capping eager tokenization at the kept ≤200/type
  would cut the worst case from ~3000 rows to ~1000 (~181 ms → ~60 ms).
  It requires making `tokensEstimated` nullable for pre-filtered rows,
  which is a C4 trace-shape change and therefore wants a deliberate
  C4 decision pass. Surfaced by M3.4 Task 6 review (2026-08-01).
- **The high-similarity bypass is mathematically inert under the
  default parameter set — it can never change which rows get
  injected.** [`retrieval.md → High-similarity bypass`](../memory/retrieval.md#high-similarity-bypass--revival-of-decayed-memories)
  spends 48 lines specifying revival of decayed memories, and
  [`probe.md`](../memory/probe.md#what-gets-captured--light-mode-default)
  captures a `bypass_triggered` column for it — but with v1's defaults
  it cannot seat a single row. The bypass is a `max`, so it only binds
  when `sim_blend − τ_revive` beats the normal score, and that floor is
  capped at `1.0 − 0.85 = 0.15`. Budget-fill then compares the **MMR**
  score against `min_score_threshold`, and a first pick (empty `S`, no
  diversity penalty) is `λ_div × score = 0.75 × 0.15 = 0.1125` — below
  the 0.15 floor. Even at a theoretically perfect `sim_blend` of 1.0
  _and_ the 1.3 chapter boost the ceiling is `0.75 × 0.195 = 0.14625`,
  still short. By the MMR monotonicity property every later candidate
  is lower, so a bypass-bound row is always `below_threshold`.
  Confirmed empirically against the M3.4 ranker: a happening at
  `sims [1,1,1]`, `chaptersOld 60`, against a 10,000-token budget for
  one 30-token row yields `finalScore 0.15`, `dropReason
"below_threshold"`, `selectedCount 0`.
  Proximate cause is a units mismatch: `min_score_threshold` is
  described at [`retrieval.md → Budget-fill termination`](../memory/retrieval.md#budget-fill-termination)
  as a "cosine baseline", but it is compared against a value already
  scaled by `λ_div` — so the effective raw-score floor for a first pick
  is `0.15 / 0.75 = 0.2`, while `τ_revive = 0.85` caps bypass output at
  0.15. Three knobs could resolve it — lower `τ_revive` (measured
  boundary is `< 0.80`, not `≤`: at exactly 0.80 the comparison value
  is `0.14999999999999997`, still under the floor in IEEE754), lower
  `min_score_threshold`, or threshold against the raw score rather than
  the MMR score — and choosing among them is a canon decision. M3.4's
  ranker follows the Pseudocode exactly and is not at fault. Same shape
  as the inert lore `priority` entry above: a documented feature
  neutralized by the default parameter set.
  **The mismatch is broader than the bypass.** 0.2 is only the
  _first-pick_ floor, where `S` is empty and the diversity penalty is
  zero. The real floor rises with that penalty: a candidate whose
  `maxSim` to an already-selected row is 0.5 must reach a raw score of
  `(0.15 + 0.25 × 0.5) / 0.75 ≈ 0.367` — roughly 2.4x the documented
  0.15 — to survive. Every pick after the first, in every type, is
  therefore held to a stricter floor than canon states; the bypass is
  simply the case where it is provably fatal. Surfaced by M3.4 Task 6
  (2026-08-01).
- **`chapters_old` has no home in the capture, but the simulator is
  specified to recompute from it.**
  [`probe.md → Simulatable parameters`](../memory/probe.md#simulatable-parameters)
  says the simulator recomputes `recency_factor` from stored
  `chapters_old` when a user re-tunes per-type `λ`. But neither
  `CandidateTrace` (`lib/retrieval/types.ts`) nor `CaptureCandidate`
  (`lib/db/world-json-types.ts`) carries a `chapters_old` field, and
  [`probe.md → What gets captured`](../memory/probe.md#what-gets-captured--light-mode-default)
  doesn't list one — it captures the _derived_ `recency_factor` only.
  From `recency_factor` alone the simulator cannot invert to a new λ
  without also knowing the age and the pin, so a λ slider is not
  actually simulatable as specified. Either add `chapters_old` to the
  capture shape (a C4 trace-contract change, same decision pass as the
  eager-tokenization item above) or drop λ from the
  simulatable list. M3.4 is not at fault — it emits exactly the fields
  C4 pins. Surfaced by M3.4 Task 6 review (2026-08-01).
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
- **Canon's Q2 template renders four lines unconditionally; the shipped
  digest omits the empty ones.**
  [`retrieval.md → Q2`](../memory/retrieval.md#q2-structural-digest)
  specifies the structural digest as a fixed four-line template. M3.4
  Task 9 makes every line conditional: the scene line is dropped when it
  would carry neither entities nor a location, the threads line when
  there are no threads, and the era and summary lines when those are
  absent. `presence[1]` is derived from the rendered result rather than
  hardcoded true, so a digest carrying no content reports itself absent
  and the ranker re-normalizes the blend across the remaining queries.
  The driver was measurable: under the literal template, a story with no
  cast, no location, no threads and no era renders Q2 as punctuation
  only, and that vector still took a full `w_digest` share — 35% of
  every candidate's blended similarity — because nothing marks it
  absent. (Q3 is present even on turn 1:
  [`retrieval.md → Cold start`](../memory/retrieval.md#cold-start)
  sources it from the opening entry, which the wizard always commits.)
  The plan had already
  made the era line conditional, so the module was internally
  inconsistent either way. Code and canon now disagree and the project
  rule is that the doc wins — either amend the Q2 section to describe
  the conditional template or revert the module. Recommended: amend the
  doc, since the literal template embeds noise. Surfaced by M3.4 Task 9
  (2026-08-02).
- **Canon promises a wizard-derived structural digest that the wizard
  does not produce.**
  [`retrieval.md → Cold start`](../memory/retrieval.md#cold-start)
  specifies turn 1's Q2 as a wizard-derived structural digest, and
  [`retrieval.md → Q2`](../memory/retrieval.md#q2-structural-digest)
  calls the four structural fields deterministic, free and always
  available. Three of the four have no shipped producer.
  `components/wizard/finish.ts` hardcodes `currentLocationId: null`, and
  the only writer that sets it is the piggyback block
  (`lib/piggyback/apply.ts`), which runs after narrative while retrieval
  runs before — so turn 1 can never carry a location. Threads have
  exactly one insert site (`lib/actions/threads/register.ts`), reachable
  only through a `createThread` delta that nothing outside tests
  dispatches. The default and only shipped calendar sets `eras: null`
  (`lib/calendar/builtins/earth-gregorian.ts`). Scene entities are empty
  whenever the wizard produces no lead, which `needsLead`
  (`components/wizard/step-frame-logic.ts`) reports for the shipped
  default mode and narration — a case
  [`wizard.md`](../ui/screens/wizard/wizard.md) calls out explicitly.
  Retrieval is not broken, since Task 9 marks an empty Q2 absent and the
  blend re-normalizes, but canon's cold-start guarantee is aspirational
  and Q2 contributes nothing on turn 1 of a default-wizard story. The
  dev seed does create threads, which is why this stays invisible in
  development. Decide whether the wizard should collect an era and
  opening threads, or whether canon should drop the cold-start Q2
  guarantee. Surfaced by M3.4 Task 9 (2026-08-02).
- **The C4 purity guard's transitive claim has an identifier-heuristic
  hole.** `PURE_FILES` in `lib/retrieval/ranker.test.ts` is documented
  as covering the whole transitive surface the simulator loads, not just
  the entry file. M3.4 Task 9 added `queries.ts`, which value-imports
  `extractProse`, which in turn value-imports `matchTerms` from
  `name-index.ts` — so `name-index.ts` is now inside the guarded closure
  but absent from the list, and it cannot be added: the guard's second
  assertion rejects any file whose source matches `queryAll`, and
  `buildNameKeywordIndex` takes an injected parameter of that exact
  name. No live violation exists, because injecting the query function
  is what keeps the module pure — the heuristic penalizes the very
  pattern that satisfies C4. A future `@/lib/db` value-import added to
  `name-index.ts` would go undetected by a guard that claims to cover
  it. Fix by scoping the second assertion to import statements rather
  than scanning bare identifiers, or by exempting injected parameter
  names. Surfaced by M3.4 Task 9 review (2026-08-02).
- **The buffer composition rule's spillover source is stated two ways
  that cannot both hold.**
  [`cadence.md → Composition rule`](../memory/cadence.md#composition-rule)
  says to "fill from the **previous chapter** to satisfy the
  `protectedBuffer` floor" — singular — while the same section states
  the unconditional arithmetic invariant that total entries before the
  chapter reaches the floor equal `protectedBuffer`, "with
  previous-chapter spillover making up the gap". Those disagree
  whenever the previous chapter holds fewer entries than the shortfall:
  honouring the singular source leaves the total below the floor, and
  honouring the invariant means walking backwards across as many closed
  chapters as it takes. M3.4 Task 10 implements the invariant reading
  and pins it with a test asserting output that spans two closed
  chapters plus the open region, on the grounds that a floor which
  silently stops short is not a floor. The case is uncommon in practice
  — `chapterTokenThreshold` defaults to 24000 tokens, so a chapter
  normally holds far more than the default `protectedBuffer` of 10 —
  which is likely why the wording was never stress-tested. Tighten the
  sentence to say "walking backwards from the chapter boundary", or
  state the single-chapter cap explicitly and accept a total below the
  floor. Surfaced by M3.4 Task 10 (2026-08-02).
- **Structural-floor seating silently bypasses two pool-level rules
  canon states elsewhere.**
  [`retrieval.md → Structural floor`](../memory/retrieval.md#structural-floor--always-inject)
  seats every `injection_mode='always'` row unconditionally, "across
  entities / lore / threads". Two later sections assume those same rows
  still pass through pool machinery, which seated rows never reach.
  First,
  [`retrieval.md → Three-sub-pool entity model`](../memory/retrieval.md#three-sub-pool-entity-model)
  makes `injection_mode='always'` the **only** opt-in for retired
  entities and then states all three sub-pools "compete for the
  entity-type token budget" — but a retired row that opted in is
  already seated, so the retired sub-pool is empty in production and
  cannot compete. M3.4 Task 11 resolves this in favour of the floor, so
  that "always" means always; `filterEntityPool` still excludes every
  retired row by default, but the `always` opt-in that would readmit one
  is unreachable whenever `floorIds` comes from `buildStructuralFloor`,
  because that floor has already seated it. Second, same-name
  suppression is defined
  as removing staged namesakes "from the current pool", so a staged row
  carrying `always` is injected even when its name appears in recent
  buffer prose — which is the collision the rule exists to prevent. The
  shipped behaviour matches canon's literal wording in both cases; what
  is unclear is whether canon means it. Decide whether `always` should
  outrank the retired-exclusion and same-name rules (current behaviour,
  and the simplest to explain to a user who set the flag) or whether
  seating should be checked against them first. Surfaced by M3.4 Task 11
  (2026-08-02).
- **The blocking sync stage bounds neither request token size nor
  provider fan-out, and sends the whole dirty set in one call on the
  local backend.** M3.4 Task 12's `runSyncStage` calls `embedRows` once
  for every `embedding_stale = 1` row, unlike `lib/embedder/drain.ts`,
  which batches at 16 and isolates poison rows. The **row count** is not
  the exposure it first appears: `lib/ai/embedding.ts` embeds through
  the AI SDK's `embedMany`, which splits at `maxEmbeddingsPerCall`, and
  `@ai-sdk/openai-compatible` defaults that to 2048 — so a 5000-row
  dirty set becomes three requests, not one. Three real gaps remain.
  Per-request **token** size is still unbounded, so 2048 long rows can
  413 anyway; the SDK fires those chunks **in parallel** when the model
  reports `supportsParallelCalls`, with no concurrency ceiling; and the
  **local** backend has no equivalent split, so it really does hand the
  whole set over in one IPC call. Because this stage is **blocking** by
  design, any of those fails the turn outright rather than degrading.
  The drain worker mitigates in practice by pre-warming, but only for
  the open branch, while the sync stage's `branchIds` may be wider.
  [`retrieval.md → Compute lifecycle`](../memory/retrieval.md#compute-lifecycle)
  says the stage "embeds every dirty row … in one batch", but that
  sentence contrasts deferred sync against embedding-on-write — it is
  about collapsing repeated writes into a single pass, not about issuing
  a single HTTP request. **Chunking would not violate canon**, so this
  is a deferred robustness decision rather than a constraint. A remedy
  belongs in the embedder layer rather than in `sync.ts` — but note the
  provider path already chunks by row count, so the work is a token
  budget per request, a concurrency cap on the fan-out, and a split on
  the local backend. Surfaced by M3.4 Task 12 review (2026-08-02).
- **Nothing implements the window-level accounting that
  [`retrieval.md → Structural floor takes budget first`](../memory/retrieval.md#structural-floor-takes-budget-first)
  describes.** Canon reads "recent buffer + active+in-scene entities +
  their location + active threads consume tokens unconditionally. Then
  prompt-overhead reservation. Then the per-type retrieval budgets
  allocate the remainder", and the UI is meant to show allocations "of
  remaining ~X tokens after structural inject". Three pieces are absent:
  no context-window total is tracked anywhere, no prompt-overhead
  reservation exists, and the story-settings sliders show absolute
  numbers with no remaining-window figure beside them. `runRetrieval`
  passing `settings.retrievalBudgets` through to `rankAll` unmodified is
  **correct** under this reading — the floor is subtracted from the
  window, not from each type's partition, which is why the prompt
  buffer, a floor member with no retrieval type, appears in that list at
  all. Subtracting per type instead would silently redefine the user's
  sliders every turn and double-count against the UI figure canon asks
  for. What is missing is the window arithmetic and the surface that
  reports it, which spans retrieval, the prompt builder and
  story-settings and so has no single owning slice. Surfaced by M3.4
  Task 17 review (2026-08-02).
- **`lib/piggyback/apply.ts` writes `<current_location>` with no kind
  check.** `block.currentLocation` lands in `metadata.currentLocationId`
  verbatim; `buildStructuralFloor` then seats whatever it names as the
  location if that row is `active`, and `apply.ts` writes
  `state.current_location_id` for every in-scene character. A model that
  answers with a character or item id corrupts scene state with no
  diagnostic. M3.4 Task 17 narrowed the prompt-side exposure (the
  `<current_location>` instruction now fires only when the floor seats a
  location), but the parser accepts any id regardless of what the prompt
  asked for. The fix belongs with piggyback parsing, not the prompt.
  Surfaced by M3.4 Task 17 review (2026-08-02).
- **`structuralSceneEntities` has no template consumer.**
  `buildGenerationContext` emits it and `templateContextMap` documents
  it, but the bundled per-turn and suggestion-refresh templates both
  render the scene from `entities` filtered by `sceneEntities` so the
  active+in-scene invariant survives a render with no retrieval behind
  it. Either the bundle earns a consumer or it is documented as
  pack-author-only surface. Surfaced by M3.4 Task 17 review
  (2026-08-02).
- **The token-progress strip reads a 50-entry window, so it cannot
  reach its own threshold.** `useOpenRegionTokens` sums the open region
  out of `entriesStore`, which holds a trailing `ENTRIES_WINDOW_SIZE`
  (50) slice rather than the branch. Measured: 50 entries at realistic
  length is **37.7%** of the default 24 000 `chapterTokenThreshold`, and
  reaching 100% would need ~132 entries. Once the open region exceeds 50
  — the normal state, since nothing closes a chapter before M5 — the
  strip reports a fraction of the truth and reads "plenty of room" while
  chapter-close is overdue. `generation-pipeline.md → Chapter close`
  sketches `openRegionTokens(branchId)` reading from the **DB**, so the
  two will diverge the moment M5 wires the real trigger. The strip is
  still better than the hardcoded `0` it replaced; the number is not
  trustworthy. Surfaced by M3.4 Task 19 (2026-08-02).
- **The same strip is non-monotonic across a reload.** `entriesStore`
  grows within a session (`patch` never evicts) but `reload()`
  re-hydrates to the trailing 50, discarding paged-in older rows.
  `reload()` fires on turn failure, on submit-with-system-tail, and on
  system-entry dismissal — so **dismissing a system entry visibly
  shrinks the progress strip**, as does restarting the app. Same story,
  same open region, different number. Follows from the entry above and
  is fixed by the same change. Surfaced by M3.4 Task 19 (2026-08-02).
- **`countEntryTokens` now runs on the reader's first render, adding a
  synchronous tiktoken encoder build before first paint.** It had zero
  production callers before M3.4 Task 19 — `countTokens` was reached
  only through the ranker, inside the async per-turn retrieval phase.
  The BPE map build measured **116ms** on desktop under Node
  (`lib/retrieval/tokens.ts` documents ~135ms) and will be worse on
  Android. If story-open shows a hitch, this is it, and the fix is to
  warm the encoder during story open rather than to change the hook.
  **Unmeasured on device.** Surfaced by M3.4 Task 19 (2026-08-02).
- **A retrieval pass costs more than its whole budget at 60-chapter
  volumes, and the budget table has no line for most of what the pass
  does.** Measured against a real migrated SQLite plus sqlite-vec
  database, median of 7 warm in-process passes on desktop, **excluding**
  the embedder, the blocking sync stage and all IPC: **60 ms** at 1200
  happenings / 3000 awareness rows, **137 ms** at 3600 / 9000, **166 ms**
  at 6000 / 15 000.
  [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  targets **under 100 ms total including the three query embeds**, so
  the largest figure already exceeds the entire budget with the
  embedder subtracted out of it. 6000 / 15 000 is not a worst case:
  [`Scale assumptions`](../memory/retrieval.md#scale-assumptions) puts
  60 chapters at 3-6k happenings and 15-60k awareness rows, and its own
  "5-10× happenings" ratio puts a 6000-happening branch at 30-60k
  awareness — so the measurement sits at that row's awareness floor,
  2.5× rather than 5-10×. Supporting numbers, dim 384 and `k = 200`:
  vec0 KNN costs 0.96 / 4.41 / 22.58 ms at 1k / 10k / 60k rows, and a
  `WHERE branch_id = ?` source scan costs 0.94 / 9.56 / 33.27 ms at
  2k / 20k / 60k. The budget table prices only the query embed, a
  cosine batch, MMR, token estimation and budget fill — it has no line
  at all for the KNN passes, the five source reads, the awareness read
  or the chapter-ranges JOIN. It also inherits the "three queries per
  pass" of
  [`Performance characteristics`](../memory/retrieval.md#performance-characteristics--poc-findings),
  which is the PoC baseline M3.4's own AC7 is written against, where
  the shipped pass issues **fifteen** — three query vectors across five
  types. Two of the overruns are already filed above (MMR, eager
  tokenization) and
  are inside these totals; what is missing is a budget re-derived
  against the pass that actually ships. Surfaced by the M3.4 whole-slice
  review (2026-08-03).
- **A retrieval pass makes 27 sequential DB round-trips and
  parallelises none of them.** `runRetrieval` (`lib/retrieval/run.ts`)
  awaits, in order: five `loadStaleRows` reads (one per `VEC_FAMILIES`
  kind — `lib/actions/embedder-swap/app-deps.ts:532`), five
  `loadSourceRows` reads (`lib/retrieval/source-rows.ts:51`), one
  awareness read, fifteen KNN passes (three query vectors across five
  types), and the chapter-ranges JOIN. There is no `Promise.all`
  anywhere in `lib/retrieval/`, and on desktop every one of those is an
  IPC round-trip, so the fixed per-call cost is paid 27 times. The five
  source reads are mutually independent, and so are the fifteen KNN
  passes: every query vector is in hand before the loop starts, and the
  per-kind vector map each pass writes into is order-independent. Only
  two orderings are load-bearing — sync before any source read, floor
  before the query stack. Surfaced by the M3.4 whole-slice review
  (2026-08-03).
- **`loadSourceRows` reads every happening on the branch each turn,
  purely to filter down to at most 600 KNN ids.** The happenings arm of
  `lib/retrieval/source-rows.ts:51` is a full
  `WHERE branch_id = ?` scan, and its only consumers are the pool
  intersection in `assembleCandidates` (`lib/retrieval/run.ts:465`) and
  the `staleCounts` tripwire, which wants a count rather than rows. At
  60 chapters that is ~33 ms of SQL plus ~21 ms of structured-clone
  across the IPC boundary to discard over 99% of what it read. Entities,
  lore and threads genuinely need the full scan — `buildStructuralFloor`
  looks for `injection_mode='always'` across all three,
  `nameKeywordIndexFrom` indexes every entity name and lore keyword, and
  Layer-A suppression needs every staged entity. Happenings needs none
  of that, and it is the one table
  [`Scale assumptions`](../memory/retrieval.md#scale-assumptions)
  projects into the thousands. The KNN top-k is supposed to be the
  scaling mechanism, and this read defeats it. The fix needs no
  restructuring: nothing before the KNN pass touches
  `sourceRows.happenings`, so that one read can move after the pool ids
  are known and fetch by id, bounding it at the pool size. (Chapters has
  the same shape and does not matter — ~60 rows at 60 chapters.)
  Surfaced by the M3.4 whole-slice review (2026-08-03).
- **`poolIdsFromKnn`'s ordering is computed and then discarded.** Its
  JSDoc (`lib/retrieval/pools.ts:168`) promises a "de-duplicated,
  first-seen order" union of the per-query KNN id sets, and it builds
  exactly that — but `assembleCandidates` consumes the result only as
  `new Set(ids)` membership (`lib/retrieval/run.ts:371`), so the pool's
  actual order is SQL row order from `loadSourceRows`, not KNN rank.
  That order is not inert: it decides ties in the ranker's
  `scored.sort((a, b) => b.score - a.score)`, which is stable, and in
  MMR's strict-`>` pick, which keeps the first of an equal pair. Two
  candidates with identical scores are therefore ranked by whatever
  order SQLite returned them in. Either thread the KNN order through to
  pool assembly or return a `Set` and drop the array — the current
  shape documents a guarantee it does not deliver. Surfaced by the M3.4
  whole-slice review (2026-08-03).
- **`countEntryTokens`' memo is never pruned.** `lib/retrieval/tokens.ts`
  keys an unbounded module-level `Map` on entry id and holds it for the
  process lifetime, across deletes, rollbacks, branch switches and story
  switches; `__resetTokenCache` has no production caller. Deleting an
  entry and later reinstating that id — reverse-replay of a delete
  re-inserts with the original id — resurrects a memo entry written
  before the deletion. The content check on read bounds the damage to a
  stale-content miss rather than a wrong count, so this is a leak rather
  than a defect today, but it is precisely the shape
  [lessons-learned → No "harmless" id leaks](./lessons-learned/no-harmless-id-leaks.md)
  records. Surfaced by the M3.4 whole-slice review (2026-08-03).
- **`rankPerType` recomputes `tokensEstimated` rather than accepting a
  captured one, which desynchronises M3.5's simulator from its own
  capture.** `score` (`lib/retrieval/ranker.ts:101`) always evaluates
  `input.countTokens(c.renderedText) + params.typeOverhead[type]`; there
  is no path that takes a stored value. The probe's simulator re-runs
  budget-fill against `CaptureCandidate.tokens_estimated`
  ([`probe.md → Simulatable parameters`](../memory/probe.md#simulatable-parameters)),
  so any drift between the js-tiktoken version that produced the capture
  and the one loaded at replay makes the two disagree row by row, with
  nothing reporting it. The ranker's purity is not at issue — the
  function is deterministic given its inputs; the tokenizer is one of
  its inputs and is not pinned by the capture. Wants either an optional
  captured-token input on `RankTypeInput` or a recorded encoding
  identity the simulator can refuse to replay across. Needs deciding
  before 3.5 builds the simulator. Surfaced by the M3.4 whole-slice
  review (2026-08-03).
- **The C4 purity guard is an identifier scan, not a purity check.**
  Distinct from the transitive-closure hole filed above: that entry is
  about a file the guard claims to cover and cannot list, this one is
  about what the guard checks at all. Its second assertion
  (`lib/retrieval/ranker.test.ts:402`) is
  `expect(src).not.toMatch(/queryAll|runInTransaction|drizzle/)` — a
  scan for three bare identifiers anywhere in the file, including
  comments and parameter names. It catches an import-shaped violation
  only because imports happen to mention those words, and it says
  nothing about the ways replay actually breaks: a clock, an RNG, a
  locale-sensitive format, or module-level mutable state read across
  calls. Behavioural purity does currently hold — the whole
  value-import closure (`ranker`, `mmr`, `vector`, `constants`,
  `queries`, `prose-extract`, `name-index`; `types` and `@/lib/db` are
  type-only) was grepped for `Date.`, `Math.random`, `performance.`,
  `Intl` and `toLocale` with zero hits, and every value import inside it
  is intra-module. So the guard is not hiding a live violation; it is
  claiming coverage it does not have. Surfaced by the M3.4 whole-slice
  review (2026-08-03).
- **Four hand-built `RetrievalSuccess` fixtures, and a factory home that
  already exists.** `lib/actions/turns/submit-turn.test.ts:50`,
  `lib/pipeline/definitions/per-turn-retrieval.test.ts:71`,
  `lib/pipeline/definitions/generation-context.test.ts:128` and
  `lib/pipeline/definitions/per-turn.test.ts:774` each construct the
  full outcome — five `RankedType` bundles, a `StructuralFloor`, a
  `QueryStack`, `staleCounts`, `timings` — by hand, and every field
  added to the type has to be added four times.
  `lib/retrieval/__tests__/` exists (it holds the shared `queryAll`
  stub) and is the natural home for a factory. Hygiene, not risk:
  `RetrievalSuccess` is a closed object type, so typecheck fails all
  four the moment a required field lands. Surfaced by the M3.4
  whole-slice review (2026-08-03).
- **`retrieval.md → Token estimation` describes a ranker-side token
  cache that does not exist.**
  [The section](../memory/retrieval.md#token-estimation) ends "Ranker
  passes cache results in memory for reuse within the turn." No such
  cache exists: `score` calls the injected `countTokens` once per
  candidate and keeps the result on the `Scored` row, and the only memo
  in `lib/retrieval/tokens.ts` is `countEntryTokens`, which the ranker
  never touches. Each candidate is tokenized exactly once per pass, so
  the intent — do not pay twice for the same row — is satisfied; the
  sentence describes a mechanism that was never built, and it shares a
  paragraph with the "per-turn cost is sub-millisecond total" claim the
  measurements above already contradict. Fix with the same pass that
  re-derives the cost budget. Surfaced by the M3.4 whole-slice review
  (2026-08-03).
- **`metadata.tokens.completion` is the wrong measure for the chapter
  threshold, on four independent counts.** M5 needs
  `openRegionTokens(branchId)` as a DB read
  ([`generation-pipeline.md → chainsTo on predecessor`](../generation-pipeline.md#chainsto-on-predecessor)),
  and `story_entries.metadata.tokens` already looks like the answer.
  It is not. (1) **Stale on edit** — `updateStoryEntryContent`
  (`lib/actions/story-entries/operational.ts:45`) sets only `{ content }`,
  so the count survives a rewrite unchanged. (2) **Wrong text even when
  fresh** — it is provider `usage.outputTokens`
  (`lib/pipeline/definitions/per-turn.ts:256`), counting everything the
  model emitted, including the state block stripped before persist; the
  world-state-block work in [`followups.md`](../followups.md) widens that
  gap deliberately. (3) **Wrong tokenizer** — provider-side, whichever
  one that provider uses, while `chapterTokenThreshold` and the
  token-progress strip measure in o200k via `countTokens`. A story that
  switches providers mid-run would sum two incompatible token scales.
  (4) **AI entries only** — `usage` exists only on a generation call, so
  `user_action` rows carry no count at all, and they are part of the open
  region (`kind !== 'system'`). A SUM over `completion` undercounts by
  every user turn. The decision is therefore a **new field, not a
  rename**: `tokens.{prompt, completion, reasoning}` is a coherent
  provider-usage triple worth keeping for cost provenance, and
  repurposing one leg of it to mean "o200k count of the stored content"
  makes the other two incoherent. Open sub-questions: a real
  `story_entries` column (SUM-able and indexable, which a JSON field is
  not — and M5's trigger reads this per turn) versus another metadata
  key; which write paths must maintain it (generation, edit, prose
  reversal, system entries, import/seed); backfill for existing rows;
  whether a translated story counts the original or the translation
  (the original feeds the prompt buffer, so presumably that); and which
  number the entry card shows now that "reply tokens" and "content
  tokens" diverge
  ([`entry-card.md`](../ui/patterns/entry-card.md#reasoning-expansion)).
  Sits with the three token-progress-strip entries above, which the same
  change would resolve. Surfaced by review discussion (2026-08-06).
- **A local embed cannot be cancelled, so Cancel during
  `recalling-memory` works on provider backends only.** M3.4 made the
  blocking embed interruptible by threading a bounded signal from the
  retrieval phase down to `embedMany`, which closes the case where a
  provider accepts the connection and stalls. `embedLocal`
  (`lib/embedder/local/runtime.ts`) is one IPC call into the Electron
  main process with no cancellation channel, so the signal cannot
  reach it: a local pass runs to completion and the timeout fires only
  after it returns. Closing the gap needs a cancellation channel in
  `electron/` main plus preload plus the bridge, which is why M3.4
  scoped it out rather than shipping a Cancel that silently no-ops on
  one backend. Compounding it, the local backend does not chunk, so
  the whole dirty set is a single call. Surfaced by the M3.4 review
  (2026-08-06).
- **Move the `embedding_stale` flip into the action layer.**
  [`retrieval.md → Storage`](../memory/retrieval.md#storage) resolves
  the source-hash question by making the flag solely responsible for
  drift: no retrieval-time hash comparison, because hashing every
  candidate on every turn re-derives what the flag already carries.
  That trade only holds if the flag cannot be forgotten, and today it
  can — `registerEntities`, `registerLore`, `registerThreads` and
  `registerHappenings` all default `embeddingStale` to `0` and leave
  the flip to the caller, and only the classifier opts in.
  `setEntityOperationalFlags` and `setLoreOperationalFlags` have no
  callers outside their own files. The first M4 or M7 edit surface
  that writes a description without remembering produces a row that
  ranks against its old text forever, with nothing to report it. The
  action layer already knows which fields are embedded (the
  composite-text builders behind `lib/db/embeddings`), so the flip
  belongs there. Needs a decision on the seed and import paths, which
  write rows with precomputed vectors and a deliberately clean flag.
  Surfaced by the M3.4 review (2026-08-07).
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
- **`clearEmbeddingStaleOp` clears unconditionally, so a write racing
  the sync loses its dirty flag.** `lib/db/embeddings/stale.ts` clears
  by row and branch with no guard on the row still hashing to what was
  embedded. A writer that flips `embedding_stale` between
  `loadStaleRows` reading the dirty set and the sync transaction
  committing has its flag wiped by that commit, leaving new text, an
  old vector and a clean flag — permanently, because nothing
  re-derives the flag outside an embedder swap. This is a lost update
  rather than writer negligence, so the action-layer rule that every
  embedded-field writer flips the flag does not reach it. The window
  is one embed round trip wide, and no M3 writer amends an embedded
  field (the classifier only creates, piggyback writes non-embedded
  state, user edits are gated), so it is structural rather than live.
  The cheap fix is optimistic concurrency on the clear rather than a
  content hash. Surfaced by the M3.4 review (2026-08-07).
- **`electron/embedder/downloads.test.ts`'s resume test races the first
  disk flush.** `leaves a .part on mid-stream abort, then resumes with
Range and completes` sets `behavior.abortAfter = 15000` and then
  asserts the `.part` file is non-empty. The byte count bounds what the
  server sends, not what the client has written, so on a loaded runner
  the abort lands before the first chunk reaches disk and the assertion
  fails with `expected 0 to be greater than 0`. Observed once on a
  branch that changes no `electron/` file, green on re-run and green on
  the sibling PR's identical job, so it is an existing flake rather than
  a regression. The fix is making the abort point observable — wait on
  the first flush rather than on a byte count — not a longer timeout.
  Surfaced by Slice 3.4 CI (2026-08-07).
