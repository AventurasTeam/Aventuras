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
  drops only `undefined`, so `null` still writes. Surfaced by M3.11
  Task 1 (2026-07-22), scoped to 3.1b 2026-07-22.
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
  better. Surfaced by M3.11 review (2026-07-22).
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
- **`GenerationStatusPill` hardcodes its user-facing copy.**
  `components/compounds/generation-status-pill.tsx` hardcodes English
  across `PHASE_COPY`, `errorCopy`, and `cancelCopy` — every phase label,
  error message, and cancel-button string — rather than routing through
  `t()` like the i18n discipline requires. No user-facing regression yet
  (English-only today), but it's the same class of violation as
  `EntryCard` above. Fix is to move the strings into the appropriate
  namespace and swap call sites to `t()`. Surfaced by M3.7a Task 8
  (2026-07-25).
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
  (2026-07-25).
- **`SuggestionCategoriesEditor` hardcodes its "add" affordance in
  English.** `components/compounds/suggestion-categories-editor.tsx`
  hardcodes the visible add-row label and its accessible name rather
  than routing through `t()`. No user-facing regression today — the
  component isn't wired into the real Story Settings Generation tab
  yet; it only mounts via its Storybook story and the `/dev` harness
  route — but Slice 3.7b is expected to wire it per
  [`story-settings.md → Suggestion categories`](../ui/screens/story-settings/story-settings.md#suggestion-categories),
  and it needs label props (or direct `t()` call sites) before then.
  Surfaced by M3.7a Task 3 (2026-07-25).
- **`story-settings.md`'s "Collision blocks save with inline error" is
  unimplementable against the shipped save-session contract.**
  [`story-settings.md → Suggestion categories`](../ui/screens/story-settings/story-settings.md#suggestion-categories)
  specifies that a case-insensitive label collision blocks save with an
  inline error on the conflicting row, but `SectionRegistration`
  (`components/story-settings/save-session.tsx`) carries no validity
  channel — a section publishes `dirtyFields` and a `getPatch` /
  `reset` pair, nothing that can say "I'm dirty but invalid" — and
  `SaveBar` (`components/compounds/save-bar.tsx`) has no invalid state
  to render even if it did. A collision today would have to be caught
  by disabling Save from outside the save-session pattern entirely, or
  not at all. Blocks Slice 3.7b, which is expected to wire
  `SuggestionCategoriesEditor` into this tab. Surfaced by M3.7a Task 3
  (2026-07-25).
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
- **The status pill is single-slot, so a turn started during a refresh
  strands the refresh.** `GenerationStatusPill`'s `GenerationPhase`
  union (`components/compounds/generation-status-pill.tsx`) now
  includes `refreshing-suggestions` alongside the per-turn phases, but
  the pill only ever shows one `currentPhase`. If a turn starts while a
  `suggestion-refresh` is still in flight, the pill shows
  `generating-narrative`, its cancel targets the turn, and the
  still-running refresh has no cancel affordance until the turn ends —
  the refresh isn't blocked (`per-turn` deliberately doesn't gate on the
  no-gate `suggestion-refresh` kind), it's just invisible to the pill
  while a turn owns the slot. A designed state, not a bug the phase
  addition introduced; recorded so a future multi-slot pill redesign
  has the scenario on record. Surfaced by M3.7a Task 8 (2026-07-25).
- **A typed `PipelineInputMap` via declaration merging is the shape to
  reach for once a second pipeline needs caller inputs.**
  `suggestion-refresh` is the first pipeline kind to give a phase
  caller-supplied parameters (`targetEntryId`, `refreshGuidance`), and
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
  `lib/stores/generation/generation.ts` and predate this slice, but
  nothing made them reachable until now: `suggestion-refresh` is the
  first `no-gate` pipeline kind (`gateBehavior: 'no-gate'`,
  `lib/pipeline/definitions/suggestion-refresh.ts`), so it's the first
  run that can genuinely be mid-flight while a user reversal (CTRL-Z /
  rollback) fires against the same entry. The dominant race window is
  closed in practice by the phase re-reading its target row after the
  call completes rather than trusting a stale in-memory copy; the
  residual gap is a microtask window between that re-read and the
  write, which is upstream of this pipeline. Surfaced by M3.7a Task 7
  (2026-07-25).
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
