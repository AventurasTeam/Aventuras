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
  `SectionDirtyState` carries `tab` rather than a raw `order`. The
  `__DEV__` collision guard also landed: `attach` throws on a duplicate
  `id` (2026-07-23, 281c9a2a). What remains is only the intra-tab rank
  for same-tab siblings. Surfaced by M3.11 Task 4 review (2026-07-22),
  narrowed 2026-07-22 and 2026-08-18.
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
- **The preset browser drops canon's hover body preview.**
  [`wizard.md → Step 3`](../ui/screens/wizard/wizard.md#step-3--world)
  specifies each preset row as `displayName · tagline · preview body
on hover`; the shipped rows render label and tagline only, so the
  multi-paragraph `promptBody` is invisible until after the pick —
  which is exactly the pick the replace-confirm exists to protect.
  Either build the hover preview or amend canon. Surfaced by the
  Slice 3.6a whole-slice review.
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
- **The reader route never uses `runAction`, and nothing catches a
  rejected action.** `lib/utils.ts` exports `runAction` specifically to
  replace bare `void action(...)` — it logs the rejection and raises a
  toast — and `app/reader-composer/[branchId].tsx` calls it zero times
  while carrying about a dozen bare `void` dispatches (`loadOpenStory`,
  `refreshEmbeddingStatus`, `rehydrateStories`, `undoLastAction` /
  `redoLastAction`, `refreshSuggestions`, `awaitRunTerminal`,
  `runSubmit`, the menu undo/redo). There is also no global
  unhandled-rejection handler, so a throw from any of them produces no
  toast and no log. **Not the mechanical swap it looks like:** each
  conversion turns a silent failure into a user-visible toast, so it
  needs a per-call-site decision about which failures deserve one — a
  background `refreshEmbeddingStatus` that fails is not the same event as
  a failed undo — plus copy for each. The global handler is the separable
  half and is worth landing on its own. Corrected 2026-08-18: the original
  entry named `handleCommitEdit`, which is not one of the bare-`void`
  sites — it is awaited, and it already carries failure in its result
  channel. Split out of the post-3.8 tidy 2026-08-18.
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
