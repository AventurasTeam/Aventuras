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

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.
  - 2026-10-07, 4.5a: `Trigger Opens Overlay`
    (`preset-browser.stories.tsx:49`) failed once in a 27-file parallel
    run, on `findByText`'s 1 s default, and passed 3 of 3 alone.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **Keyword-term comparison lowercases instead of case-folding.**
  `normalizeTerm` (`lib/keyword-terms.ts`) uses `toLowerCase()` while
  canon says "case-folded", so "Strauß" and "STRAUSS", or Turkish "İ"
  and "i", don't match. Pre-existing; it affects every keyword-term
  comparison and the namesake matcher. Raised 2026-10-10 by the
  partial-name collisions code review.

- **The two `cosine` implementations disagree on bad input.**
  `lib/retrieval/vector.ts:27` throws on a dimension mismatch and NaN,
  while `lib/classifier/reconcile.ts` returns 0 for a zero norm
  (reconciliation now treats zero and NaN vectors as unscored). Also
  `l2Normalize` (`lib/embedder/local/pooling.ts:9`) passes zero and NaN
  vectors through unchanged. Raised 2026-10-10 by the partial-name
  collisions code review.

- **The resolve dialog's Rename body keeps its input names when a row
  is renamed elsewhere.** `RenameBody` in
  `components/compounds/collision-resolve-dialog.tsx` resets only when
  the pair's ids change, so an untouched form then reads as changed and
  Save could send the old name back. Reasoned, not reproduced; rare.
  Raised 2026-10-10 by the partial-name collisions code review.

- **The item-match embed in the per-turn writers can't be cancelled.**
  `EmbedDescriptions` takes no abort signal, though `embedTexts`
  (`lib/embedder/service.ts`) accepts one, so a cancel during a slow
  provider embed takes effect only once it settles, while the hard gate
  holds the branch. Raised 2026-10-11 in the
  locations-and-items-from-prose PR.

- **The classifier's partner tiebreak counts a split `same-parent`
  flag as flagged.** `lib/classifier/reconcile.ts` (~line 53) reads the
  raw `nameCollisionFlag`, so a flag that no longer pairs still sorts
  after an unflagged namesake. Canon question: whether
  [`classifier.md`](../memory/classifier.md)'s "unflagged" means "has
  no flag that pairs". Raised 2026-10-11 in the
  locations-and-items-from-prose PR.

- **A cancel after the last abort check still returns `completed`.**
  In `lib/pipeline/definitions/per-turn.ts` (~line 322) a cancel
  landing during the position SELECT or the yields leaves the phase
  returning `completed`. Pre-existing; surfaced 2026-10-11 in the
  locations-and-items-from-prose PR.

- **The fallback's report blanks the fold's visual changes when it
  emits `visualChanges: []`.** `reportedBlock` in
  `lib/pipeline/definitions/per-turn-piggyback.ts` applies its
  no-blanking rule only on `=== undefined`, so an explicit empty array
  replaces the already-applied visual changes in the report. Raised
  2026-10-11 in the locations-and-items-from-prose PR.

- **The mock LLM ignores `newLocations`, `newItems` and
  `retrievalQueries`.** `scripts/mock-llm` (`validate.ts`,
  `respond/tagged-block.ts`) drops them, so a recorded narrative turn
  with creates replays as `<current_location>new:…` with no create,
  which fails substitution. Raised 2026-10-11 in the
  locations-and-items-from-prose PR.

- **The `<entity …>` pattern in the state parser scans to the end of
  the segment per unclosed opener.** `lib/piggyback/parse.ts`
  (~line 116) takes about 840 ms on 20,000 unclosed `<entity ` openers;
  the create pattern already bounds its spans (`[^<>]`), and the same
  fix applies here. Raised 2026-10-11 in the
  locations-and-items-from-prose PR.

- **The narrative person never reaches a prompt.**
  `definition.narration` (first, second or third person) is in the
  generation context, but no bundled template renders it, the per-turn
  narrative and the wizard opening included, so the narrator is never
  told which person to write in. Raised 2026-10-11 by the system and
  user prompt halves design.

- **The scene editor doesn't promote a staged current location it
  sets.** `updateEntrySceneFields`
  (`lib/actions/story-entries/scene-fields.ts`, ~line 108) passes only
  `sceneEntities` to `scenePromotionActions`, while the generation fold
  now promotes a staged `<current_location>` too
  ([`piggyback.md → Auto-promote on staged-ID emission`](../memory/piggyback.md#auto-promote-on-staged-id-emission)).
  The editor offers staged locations
  (`components/reader/scene-editing.ts`, ~line 59), and the structural
  floor seats only an active current location (`lib/retrieval/pools.ts`,
  ~line 91), so the next prompt has no `# Current location`. The
  editor's copy promises promotion with no such limit
  (`sceneEdit.applyNote` in `locales/en/reader.json`: "Saving
  re-applies scene presence to world state: per-character location,
  last-seen, and staged promotion."). Canon question: whether
  [`entry-card.md → Scene editor`](../ui/patterns/entry-card.md#scene-editor)'s
  "a staged entity the edit names in the scene is promoted exactly as
  the classifier would promote it" includes the location. Fixes:
  promote a staged location the edit sets, in `updateEntrySceneFields`;
  or narrow the copy. Predates this PR: the fold lacked the location
  promotion at the merge base too. Raised 2026-10-11 by the
  locations-and-items-from-prose slice review.

- **The fallback schema's optional fields reject `null`.** In
  `fallbackClassifierSchema`
  (`lib/pipeline/definitions/per-turn-piggyback.ts`), the `.optional()`
  fields with no `.catch` (`currentLocation`, `visualChanges`,
  `transfers` and its `to` and `from`, `summary`) fail the whole
  structured parse when a model answers `null` for one; after the parse
  retry the call fails, and the turn loses the fallback's scene, time
  and summary. `generateStructured` defaults to the prompt-injection
  path (`lib/ai/generate.ts`, around line 161), where `null` is a
  natural JSON answer, and the fallback runs every turn today, since no
  model carries the tagged-block capability flag. Predates this PR; the
  create fields get the fix in it. Related: the M7.1 force-on entry in
  the [roadmap](./roadmap.md#m7--app-settings--diagnostics--onboarding)
  plans converting these fields to nullable for the native path. Raised
  2026-10-11 by the locations-and-items-from-prose slice review.

- **`generation-pipeline.md`'s lifecycle names a reverse swap nothing
  calls.** Step 5 of the substitution lifecycle is
  `parseAndSubstitute(rawOutput, idMap)`, but `parseAndSubstitute`
  (`lib/ids/parse.ts`) has no production caller: the per-turn writers
  resolve placeholders field by field in `substitutePiggybackIds`
  (`lib/piggyback/substitute.ts`) and the periodic classifier in
  `lib/classifier/substitute.ts`. Either the step names those, or the
  export goes. Predates this PR. Raised 2026-10-11 by the
  locations-and-items-from-prose slice review.

- **The oldest-first tie-break is written out by hand in about seven
  places.** `createdAt`, then `compareId`: `byAge` in
  `lib/world/new-entity-match.ts` and its copy in
  `lib/classifier/reconcile.ts`, `partnerOrder` there, and the list
  modules (`overview.ts`, `entity-list.ts`, `lore-list.ts`,
  `thread-list.ts`, `entity-picker.tsx`). Its home is beside `compareId`
  in `lib/list-modules/collate.ts`. Raised 2026-10-11 by the
  locations-and-items-from-prose slice review.

- **The fallback still drops its whole scene list or visual changes
  over one unknown id.** The fallback classifier substitutes with
  `badRef: 'drop'` (`lib/pipeline/definitions/per-turn-piggyback.ts`),
  so a transfer whose ref doesn't resolve drops alone, but
  `substitutePiggybackIds` (`lib/piggyback/substitute.ts`) still fails
  `sceneEntities` and `visualChanges` whole on one unknown or
  undeclared id: the turn keeps the previous scene, or loses every
  visual change, and nothing rereads the reply. Predates this PR.
  Candidate fix: the same per-entry drop for both lists under
  `'drop'`, with a warning. Raised 2026-10-11 by the developer's Q7 on
  the locations-and-items-from-prose PR.

- **The registry describes `piggybackFires` as per-turn.**
  `lib/prompts/templateContextMap.ts` says "True when this turn
  expects…", but the value is settings-derived (`piggybackMode` and the
  narrative model's `taggedBlockReliable`, `resolvePiggybackFires` in
  `lib/pipeline/definitions/per-turn-piggyback.ts`), which is why the
  narrative's system half may read it. The bundled stability test
  (`lib/prompts/bundled/system-half-stability.test.ts`) treats it as
  story-fixed. Canon's "unless the user edits the story"
  ([`architecture.md → System and user halves`](../architecture.md#system-and-user-halves))
  is also narrower than the truth: the value follows whichever narrative
  model resolves, so reassigning the narrative model in App Settings
  changes the system half without a story edit, as a capability override
  will once one exists. And
  [`→ Structured output`](../architecture.md#structured-output--the-json-contract-is-not-pack-content)
  calls the contract "fixed per call site", but the fallback classifier
  switches between its plain and with-chips schemas with
  `askForSuggestions`, inside its marked system block, so a turn that
  flips it misses the cache. Reword all three. Raised 2026-10-11 by the
  system and user halves PR's Task 9 review and its slice review.

- **`promptSchemaMiddleware` joins the contract onto the halves as
  rendered.** In `lib/ai/prompt-schema.ts`, `appendToLastSystem` adds
  `\n\n` and the contract to the system message untrimmed, as the system
  and user halves PR designed it. No bundled system half ends on a blank
  line (the suggestion refresh `rstrip`s its capture for exactly this),
  but a user-authored one, once M7.2's pack tab edits live packs
  ([`roadmap.md → M7`](./roadmap.md#m7--app-settings--diagnostics--onboarding)),
  would put three blank lines before the contract. `appendToLastUser`,
  carried over unchanged from before that PR, does the same to a user
  half that ends in a newline, and it folds every text part into one,
  which drops each part's `providerOptions` and moves file parts after
  the text: a later cache marker on a user part would vanish silently.
  The contract itself is built with `String.replace`, which reads `$&`,
  `$$` and the other `$` patterns in the schema block as replacement
  patterns, so a `.describe()` text holding one would reach the model
  mangled; none does today. Candidate fix: `trimEnd` the half before
  each append, keep the parts, and pass the block through a replacer
  function. Raised 2026-10-11 by that PR's task reviews and its slice
  review.

- **`generateStructured` doesn't pass the action id to
  `prepareGeneration`.** In `lib/ai/generate.ts`, `streamText` passes
  `actionId`, so the narrative's fetch capture links to its action, but
  the fallback and periodic classifiers and the suggestion refresh, all
  run phases, go out unattributed, against
  [`observability.md → actionId threading`](../observability.md#actionid-threading)
  ("contract-critical"); the wizard runs outside a run and is
  unattributed by design. Related: `ResolveModelResult.providerType`,
  `buildCallSettings` and `marksSystemPrefix` type the provider
  as `ProviderInstance['type']`, which has no `'stub'`, though a runtime
  row can be one (`ProviderInstanceWithStub` in `lib/ai/types.ts`); only
  `marksSystemPrefix`'s comment notes it. Predates the system and user
  halves PR, whose `marksSystemPrefix` copies the existing type. Raised
  2026-10-11 by its task reviews.

- **The prompt-halves tests repeat a few test-side pieces.** The JSON
  contract's closing line is spelled out in `lib/ai/prompt-schema.test.ts`,
  `lib/ai/request-shape.test.ts` and `scripts/mock-llm/server.test.ts`,
  and the pipeline tests read a mocked call's prompt through 11
  `as PromptHalves` casts (`per-turn-piggyback.test.ts`,
  `per-turn.test.ts`, `suggestion-refresh.test.ts`) because each declares
  its `generateStructuredMock` as a bare `vi.fn()`. A shared test-helpers
  module (test-side, so no test derives its expectation from the code)
  and typed mocks would remove both, but the first has no home yet and
  the second touches older mock declarations. Raised 2026-10-11 by the
  system and user halves PR's slice review (simplifier pass).

- **The `anthropic` provider can't reach Anthropic from the desktop
  app.** The renderer calls `api.anthropic.com` directly, and
  Anthropic's CORS preflight refuses the call: `@ai-sdk/anthropic`
  3.0.81 never sends the `anthropic-dangerous-direct-browser-access`
  header, and `createProviderModel` in `lib/ai/providers.ts` passes no
  `headers`. Seen on 2026-10-11 at `d1f2210d` in the dev app, with an
  `anthropic` provider written straight into a dev slot's database and
  a dummy key; the browser stops the request before the key is sent.
  The console logs "Access to fetch at
  'https://api.anthropic.com/v1/messages' from origin
  'http://localhost:8083' has been blocked by CORS policy: Response to
  preflight request doesn't pass access control check: No
  'Access-Control-Allow-Origin' header is present on the requested
  resource." The turn ends in the system entry "LLM call failed." with
  "network: TypeError: Failed to fetch", and its `pipeline_runs` row is
  a `per-turn` run with outcome `failed`; the log names the narrative
  phase and error kind `provider`. A keyless preflight to
  `/v1/messages` gets HTTP 400 and no `Access-Control-Allow-Origin`;
  with that header among the requested headers it gets 200 and `*`.
  The packaged app's `app://bundle` origin gets the same two answers.
  Android's native fetch doesn't enforce CORS, so the bug should be
  desktop's alone; that wasn't checked on a device.

  Nothing caught it because the app can't create an `anthropic`
  provider: the Providers form
  (`components/compounds/provider-setup-form.tsx`) only creates
  `openai-compatible` ones, and the Profiles tab is "coming soon". E2E
  sends every call to an `openai-compatible` mock. The fix looks like
  one header, passed through `createAnthropic`'s `headers`. The
  header's "dangerous" name guards against exposing a key to the
  visitors of a public page; here the key is the user's own and stays
  on their machine. Whether that reasoning holds is for triage to
  judge. Until it is fixed, the system and user halves PR's cache
  marker can't be used on desktop; that PR's cache check ran through a
  local CORS proxy.

  The developer: "I noticed the anthropic connector has an update, a
  major version, so might be worth investigating, triage it." Read on
  2026-10-11 from the npm registry, the published packages' files and
  the AI SDK's provider docs, without installing anything:
  - `pnpm view @ai-sdk/anthropic version` gives 4.0.78 (2026-10-08).
    The repo uses 3.0.81. The 3.x line still gets releases: its newest
    is 3.0.129 (2026-10-09), under the `ai-v6` dist-tag.
  - 4.0.0 (2026-06-25) belongs to the AI SDK's v7 line: its changelog
    starts the "v7 pre-release", and it moves to `@ai-sdk/provider` 4.
    The `ai-v6` dist-tags point at `@ai-sdk/anthropic` 3.x and
    `@ai-sdk/openai-compatible` 2.x, so the major means moving the
    repo's `ai` (6.0.193) and `@ai-sdk/openai-compatible` (2.0.49) to
    their v7 releases too: an AI SDK migration, not a one-package
    bump. 4.0.0 is also ESM-only, and it drops
    `cacheCreationInputTokens` from `providerMetadata`, which the repo
    doesn't read.
  - The 4.0.78 package's `CHANGELOG.md` and `README.md` say nothing
    about browser access, CORS or the header, and the AI SDK's
    Anthropic provider page describes `headers` only as "Custom headers
    to include in the requests". Neither the published 4.0.78 build nor
    3.0.129 sends the header: both send `anthropic-version`, the key,
    then `headers`. Upgrading doesn't fix this bug.

  Raised 2026-10-11 by the system and user halves PR's cache check
  (developer checks before merge, step 3).

- **The location instructions count retired places.** Two prompt lines
  are gated on `{% if locationMap.size > 0 %}`, which now counts retired
  rows too, and those carry no id: the narrator's "Use an ID from
  Places" line (`lib/prompts/bundled/per-turn.ts`) and the
  state block's `<current_location>` hint
  (`lib/prompts/bundled/state-emission.ts`). A branch whose only places
  are retired is still told to use an ID from Places. A count of the
  rows with an id, or a flag the builder sets, fixes both; the prompt
  content pass may reword the lines anyway. A third, ungated line makes
  the same assumption: "Use an existing place's ID whenever the scene
  is somewhere already in Places" (`state-emission.ts` and
  `piggyback-fallback-classifier.ts`). Raised 2026-10-12 by the
  retired and disabled places implementation.

- **The fallback classifier's roster lists effectively disabled places
  with ids.** `lib/prompts/bundled/piggyback-fallback-classifier.ts`
  renders every active and staged entity, so a place disabled by its
  own mode or an ancestor's reaches the fallback with its id although
  the map leaves it out, and
  [`principles.md → Injection / retrieval rules`](../ui/principles.md#injection--retrieval-rules-for-prompt-context)
  says a disabled row never reaches the prompt. It helps the fallback
  name a place the prose walked into, but it gives a place disabled as
  a secret to the extraction call. Decide whether the roster follows
  the map's effective mode. Predates this change for a place disabled
  by its own mode. The roster filters on status only
  (`lib/prompts/filters.ts`), so every entity disabled by its own mode
  reaches it with its id, characters, items and factions too. Raised
  2026-10-12 by the retired and disabled places implementation.
  Since 2026-10-16, `principles.md` says the mode governs what the
  narrator sees and the periodic classifier sees every row whatever its
  mode, which the 2026-10-12 design decided for the periodic classifier;
  the fallback, which extracts but can also move the scene, is the case
  that rule doesn't settle.

- **The scene editor can write a character into a retired place.**
  Removing a character from the tail's scene sets their
  `current_location_id` to the previous entry's location, as the
  last place they were seen (`lib/piggyback/scene-tracking.ts`, the
  `wasInScene` branch, ~line 93). For a character first seen at the
  tail that is a place they were never seen in, and once that place
  is retired it breaks "nothing enters a retired place"
  ([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
  The scene-fields guard checks only the scene's own location. Fixes:
  anchor a character first seen at the tail on the tail's original
  location, or skip the write when the anchor is retired. Predates the
  retired-place rule: the anchor choice is older. Raised 2026-10-15 by
  the retired and disabled places slice review.

- **Two save-confirm dialogs repeat one shell.** `RowConfirmDialog`
  (`components/compounds/row-save-session-chrome.tsx`) and Story
  Settings' `DefinitionalChangeDialog`
  (`components/story-settings/definitional-change-dialog.tsx`) build
  the same AlertDialog: a dismiss that cancels unless the write is
  running, Cancel disabled while saving, a plain confirm button rather
  than `AlertDialogAction` so it doesn't also fire a cancel, and the
  bullets inside the description so screen readers announce them. A
  compound in `components/compounds/` taking the title, lines, items
  as `ReactNode`, confirm label, `saving` and `onAnswer` would serve
  both; it simplifies anything only once Story Settings adopts it.
  `delete-confirm-dialog.tsx` shares only the bullet rendering. Raised
  2026-10-15 by the retired and disabled places slice review's
  simplifier pass.

- **The generation store's run mutators are public.**
  `generationStore.startRun`, `finishRun`, `abortRun` and
  `setReversalInProgress` (`lib/stores/generation/generation.ts`) are
  exported to every module. Only the orchestrator and the
  prose-reversal bracket should call them, and a stray caller can leave
  the hard gate or the reversal barrier stuck. The mentioned-places
  slice review closed the same gap for the pending-turn mark by
  exposing it only as a bracket. A `boundaries` lint rule limiting
  these to `lib/pipeline/runtime` and `lib/actions` is the route
  [`code-conventions.md → Syncing a store after a write`](../code-conventions.md#syncing-a-store-after-a-write)
  names for a package-private mutator. Raised 2026-10-16 by the
  mentioned places slice review.

- **Nine migration tests carry their own copy of two helpers.**
  `migrationTags` and `applyMigration` are copied byte for byte into the
  seven migration tests under `lib/db/__tests__/`, plus
  `lib/db/embeddings/stale.test.ts` and `lib/embedder/service.test.ts`.
  They belong in `lib/db/__tests__/test-db.ts`, which tests in other
  modules already import. One `refactor(test):` commit would move them
  and replace the copies with an import. Raised 2026-10-16 by the
  mentioned places slice review's simplifier pass, which skipped it as
  outside that slice.

- **`clampEmbeddedCharacter` clamps places and items too.** The helper
  in `lib/classifier/plan.ts` bounds the embedded name and description
  of any new row: the per-turn writer already used it for places and
  items, and the periodic classifier now uses it for mentioned places.
  A neutral name such as `clampEmbeddedText` would stop it misleading.
  Rename only. Raised 2026-10-16 by the mentioned places slice review's
  simplifier pass.

- **Older reads cast `state` to `CharacterState` without checking the
  kind.** `lib/piggyback/apply.ts` (two reads of a holder's state) and
  `lib/world/entity-actions.ts` (a merge's other row) cast an entity's
  `state` straight to `CharacterState`, though `EntityState` is
  undiscriminated and callers should pair the kind with the state
  (`lib/db/entities/entities-types.ts`). The classifier factions slice
  added a helper that checks the kind first for a character's faction;
  these older reads predate it and stay out of its scope
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design)).
  Read, not probed. Raised 2026-10-18 by the classifier factions slice
  review.

- **The classifier planner's decision maps are paired by name.**
  `PlanDeps.decisions` in `lib/classifier/plan.ts` is a `Map` the
  planner only reads, where its `factionDecisions` sibling is a
  `ReadonlyMap`. Both have one type, so the pass
  (`lib/pipeline/definitions/periodic-classifier.ts`) could hand them
  over swapped and still compile. Keying them by kind, as
  `RECONCILED_KINDS` already keys the reply field and id prefix, would
  close both; it changes the older `decisions` field, so it waits on
  its own commit
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design)).
  Raised 2026-10-18 by the classifier factions slice review.

- **Three copies of `isPlainObject`.** `lib/actions/delta/delta-encoding.ts`
  exports one, which `user-precedence.ts` now shares;
  `lib/actions/settings/normalize.ts` keeps its own copy inside the same
  module, and `lib/history/humanize.ts` another. The settings copy can
  import the delta one today; the History one needs a home every module
  may import, and `lib/utils.ts` pulls in UI and toast dependencies the
  delta code shouldn't take. Raised 2026-10-18 by the classifier
  factions slice review's simplifier pass, which skipped it as outside
  the slice.

- **An ancestor of the current location is framed "not in the scene".**
  The floor seats the current location alone. Its ancestors appear only
  by name in its head ("The Drowned Market — in Veil's Hollow", from
  `currentLocationChain`), and `filterEntityPool` keeps them in the
  ranked pool (`lib/retrieval/pools.ts`). A ranked or `always` ancestor
  then renders in the memory blocks as "Veil's Hollow (not in the
  scene): …" while the scene stands inside it. In the dev seed, a scene
  at the Drowned Market would show it: Veil's Hollow is `always`. The
  words are
  [`retrieval.md → Three-sub-pool entity model`](../memory/retrieval.md#three-sub-pool-entity-model)'s,
  and the old "currently elsewhere" was as wrong. Both obvious fixes
  reach the ranker's mirror, which must keep rendering exactly what it
  measures: seat the chain on the
  [structural floor](../memory/retrieval.md#structural-floor--always-inject)
  and render it outside the memory blocks, since a seated row still
  takes the memory blocks' framing (Veil's Hollow, `always`, is seated
  already), or give an ancestor its own framing, which makes
  `entityFraming` read the scene. Raised 2026-10-19 by the entity-state
  smoke check.

- **A transfer's holder is never kind-checked.** Canon has the fallback
  drop a transfer whose item or holder is of the wrong kind, item and
  stackable transfers alike, logging `classifier.transfer_dropped`, and
  the tagged block fail the field
  ([`piggyback.md → Parse strategy and failure recovery`](../memory/piggyback.md#parse-strategy-and-failure-recovery)).
  `lib/piggyback/substitute.ts` checks only an item transfer's item:
  `resolveItemTransfer` never checks `to` or `from`, and
  `resolveStackable` checks nothing. A probe through
  `buildPiggybackActions` moved 30 gold from an item to a character, and
  4 gold from a character to an item, which credited no one, with
  nothing logged. Older than entity state, which now brackets the ids
  of held and loose items in every generation prompt, so a container
  item named as a payer is likelier. Raised 2026-10-19 by the
  entity-state slice review.

- **Retrieval takes its disabled places beside the scene they derive
  from.** `per-turn-retrieval.ts` computes `disabledPlaceIds` with
  `placeModes` around the scene's location and passes it to
  `runRetrieval` beside `sceneEntityIds` and `currentLocationId`, and
  only the caller keeps the two in step. The pass now takes the store's
  entities and builds its views over its own scene, so it could derive
  the set itself and drop the parameter
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design),
  an invariant kept by convention). Older than entity state, so its
  slice review filed it rather than tightening it. Raised 2026-10-20 by
  the entity-state slice review.

- **Five copies of whitespace collapsing.** `lib/text/one-line.ts`
  exports `oneLine`, which the `one_line` filter and the entity-state
  mirror share. `classifier-context.ts` keeps its own `flat`,
  `lib/history/field-labels.ts` its `collapseSpaces`, and
  `location-map.ts` (a retired reason), `lib/text/excerpt.ts` and
  `lib/entry-refs/read.ts` inline the same `replace(/\s+/g, ' ')`. Each
  could call `oneLine`; all sit outside the entity-state slice. Raised
  2026-10-20 by its slice review's simplifier pass, which skipped it as
  outside the slice.

- **Test helpers the slices keep re-rolling.** A logger stand-in
  (`{ error: vi.fn(), warn: vi.fn(), debug: vi.fn() }`) is written out
  in `lib/piggyback/apply.test.ts`, `world-time.test.ts` and about six
  pipeline tests, and suites wrap `makeEntity` in per-file `character`,
  `item` and `faction` builders. Both want a shared test-helper home no
  module boundary objects to. Raised 2026-10-20 by the entity-state
  slice review's simplifier pass, which skipped them for want of one.

- **Era flips have no writer.** Canon has the user create a flip from
  the reader's entry card ("Flip era") and the wizard's era picker
  write one at world time 0
  ([`data-model.md → Authorship contract`](../data-model.md#authorship-contract)),
  but nothing dispatches a `branch_era_flips` write: the entry card's
  `onFlipEra` prop is unwired, and the wizard's Finish steps
  (`wizard.md`) omit the flip its era picker promises. Found 2026-10-20
  by the AI writers design's inventory; not reproduced in the running
  app.

- **An abort whose reversal throws something unrecognised leaves the
  run registered.** `abortRun` in `lib/pipeline/runtime/orchestrator.ts`
  rethrows any reversal error `describeReplayError` doesn't recognise,
  before `generationStore.abortRun` and `resolveTerminal` run. The run
  stays in `txState` with the gate up and an unsettled terminal, so
  `interruptMemoryRuns`, `cancelStoryRuns` and the gate itself hang
  until a restart. A chained successor inherits it: the
  `pipeline.chain_run_failed` catch in `driveSuccessors` only logs.
  Needs a reversal to throw a non-`DeltaReplayError`, which nothing
  does today. Related to
  [`parked.md → An abort waits on its phases, except a thrown parallel branch`](../parked.md#an-abort-waits-on-its-phases-except-a-thrown-parallel-branch).
  Raised 2026-10-21 by the gated classifier slice's task reviews.

- **The head turn's membership test is written out four times.**
  `resolveHeadTurn` in `lib/head-turn` is the one definition of the
  head turn, but the "is this entry its tail or origin" test on top of
  it is restated in `isHeadTurnEntry`
  (`lib/actions/story-entries/operational.ts`), `resolveInvalidationScope`
  (`lib/actions/story-entries/classifier-facts.ts`), `headTurnIdsOf`
  (`components/reader/row-reversal-flags.ts`) and
  `resolveSaveAndRegenTurn` (`components/reader/save-and-regen.ts`).
  [`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)
  asks for one rule. If they drift, an edit could interrupt a pass and
  then do a bare write, or the reader could offer an edit the action
  layer refuses. Raised 2026-10-21 by the gated classifier slice's
  task reviews.

- **Undo's tooltip names the pass when a refresh blocks it.** With a
  suggestion refresh running beside a pass, `gateReason` follows the
  pill to the pass (`Updating memory. Cancel to edit.`), but the
  refresh is what blocks a head reversal, so Undo's tooltip names the
  wrong run and the Cancel it points to doesn't enable Undo. Read, not
  probed. Raised 2026-10-21 by the gated classifier slice's task
  reviews.

- **Reader rows show no disabled reason.** `ReaderRow` in
  `components/reader/reader-surface.tsx` passes no `disabledReason` to
  `EntryCard`, so during a pass a disabled off-head pencil sits beside
  a live regenerate and delete with no tooltip
  ([`principles.md → Affordance loci`](../ui/principles.md#affordance-loci),
  its disabled-controls rule).
  Raised 2026-10-21 by the gated classifier slice's task reviews.

- **The `sseFetch` fixture answers non-streaming calls with SSE.**
  `lib/actions/turns/__tests__/fixtures.ts` stubs every request with an
  event stream. The piggyback fallback's non-streaming call gets that
  body, fails as a retryable JSON error, and costs each per-turn test
  a 500 ms backoff (`BACKOFF_BASE_MS` in
  `lib/ai/transport/call-with-retry.ts`), plus a
  `classifier.piggyback_fallback_failed` warning in the logs. Raised
  2026-10-21 by the gated classifier slice's task reviews.

- **Android: keyboard input pops the reader.** On the emulator,
  `adb input text` leaves touch mode, and with focus on the top bar's
  back arrow a space presses it, so `router.back()` pops the reader
  and logs two "GO_BACK was not handled" warnings. Seen before and
  after the gated classifier's changes, so the branch didn't cause it.
  Raised 2026-10-21 by the gated classifier slice's task reviews.

- **The reader's bottom pin ignores scrollbar drags and keyboard
  scrolls.**
  [`reader-document.md → Entry list`](../ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout)
  says the user's first gesture breaks the open-at-bottom pin, but
  `components/reader/reader-surface.tsx` stops it only on wheel and
  touch drag. A scrollbar drag or a keyboard scroll (arrows, Page Up)
  inside the pin's window is pulled back to the bottom each frame.
  The window is ~10 frames after landing or after an engaged stream
  end, and a whole stream when one starts inside it or the reader
  opens mid-stream. Pre-existing for the landing pin; the gated
  classifier branch extends the same pin to stream end. Raised
  2026-10-21 by the gated classifier slice's task reviews.

- **E2E in a scratch worktree can bundle with no routes.** A worktree
  with symlinked `node_modules` built a web bundle that found no routes
  ("No routes found"), so every test timed out at 30 s. The suspected
  cause: the shared `/tmp/metro-cache` keys expo-router's context
  transform by project-relative path, so two worktrees at the same
  depth share an entry pointing at a deleted `app/`. Worked around
  with a scratch-only `cacheStores` override. Reported by a review
  agent and not reproduced here. Owner: dev tooling
  ([`dev-environment.md`](../dev-environment.md) or
  [lessons-learned](lessons-learned/README.md)). Raised 2026-10-21 by
  the gated classifier slice's task reviews.

- **On an Android phone the keyboard hides the reader's inline editor.**
  Pre-existing: main behaves the same. On an emulator (411×914 dp, the
  suggestion strip open), Edit on an entry near the bottom autofocuses
  its `Textarea` (`components/compounds/entry-card.tsx`), and the
  keyboard leaves the reader 180 CSS px above the suggestion strip and
  composer. The editor grows the row, so the reader has already left the
  bottom and the viewport-shrink re-pin doesn't fire. The textarea
  then sits at 162–386 px, only its top 18 px above the strip. For
  a long last row it sits at 211–435 px, fully hidden. Nothing scrolls
  it into view: Android's WebView never scrolled a focused field into
  view in any run, and the reader has no code that does. A fix that
  keeps a focused inline editor in view when the reader shrinks would
  also cover two cases where the re-pin had helped. The re-pin now
  holds for a focused editor
  ([`reader-composer.md → Autoscroll`](../ui/screens/reader-composer/reader-composer.md#autoscroll)),
  so they behave as on main again. On the stock phone, a long last
  row's editor kept its lower half and Save in view (79 px of the
  textarea, against 13 px without the re-pin). On a very tall reader
  (density 300), the whole textarea stayed in view, against 149 of
  its 224 px. Raised 2026-10-21 by the gated classifier slice review's
  R1 probe.

- **A failed-pass entry can lose the turn's text to an occupied
  draft.** The entry carries the turn's text only when the composer
  couldn't take it back: the user typed a new draft during Send's owed
  pass, which can run up to the classifier's timeout (ten minutes
  unset) with the composer editable
  ([`reader-composer.md → Custody of the turn's text`](../ui/screens/reader-composer/reader-composer.md#custody-of-the-turns-text)).
  From there a committed Retry and `Dismiss` both hand it into the
  still-occupied draft and drop it with the `failedTurnTextDropped`
  toast, as Custody allows; a Send of the new draft drops it silently
  in the tail clear, as a turn-failure entry's does today. Only
  clearing the draft first, then `Dismiss`, keeps it, and nothing says
  so. A turn-failure entry escapes the Retry half because its Retry
  resends the stored text. Candidate fixes: keep the entry as a notice
  when a Retry commits over an occupied draft; or carry a dropped
  entry's submission onto the next entry. Raised 2026-10-22 in the
  pass failure policy slice's Task 7 review.

- **A chained successor that throws raises no failure toast.**
  `driveSuccessors` (`lib/pipeline/runtime/orchestrator.ts:606`) logs
  `pipeline.chain_run_failed` and returns when `driveRun` throws for a
  successor. `abortRun` rethrows a non-replay error from its reversal
  (`:409`) before it emits `run_complete`, so nothing reaches the toast
  listener and the reader never hears of that pass's failure; only the
  log has it. Rare: the reversal has to throw something other than a
  `DeltaReplayError`. Raised 2026-10-22 in the pass failure policy
  slice's Task 8 review.

- **Recovery copy matches the periodic classifier's kind as a
  literal.** `formatRun` and `formatFailure` in `lib/recovery/copy.ts`
  (`:16`, `:31`) compare against `'periodic-classifier'`, where
  `lib/pipeline/definitions/memory-chain.ts` and `per-turn.ts` use
  `PERIODIC_CLASSIFIER_KIND` from `@/lib/classifier`. A rename of the
  kind would leave the recovery copy on its generic branch with no
  type error. Raised 2026-10-22 in the pass failure policy slice's
  Task 8 review.

- **`onPreflightFailure` gets the caller's `RunCtx`, not the run's
  identity.** The orchestrator passes `ctx` straight through
  (`lib/pipeline/runtime/orchestrator.ts:537-541`), and a chained
  successor shares its origin's `ctx`, so any `actionId` read off it
  would be the origin's. `PreflightFailureHook`
  (`lib/pipeline/types.ts:132`) takes only `db` and `branchId`, so
  nothing can read one today. Widening it to carry
  `actionId` would reintroduce the bug `runPhaseExceptionHook` avoids by
  building its context from the `RunState`; build the hook's context
  the same way first. Raised 2026-10-22 in the pass failure policy
  slice's Task 2 review.

- **The `delta_emitted` event sketch lacks `entryId`.**
  [`generation-pipeline.md`](../generation-pipeline.md) (the
  `PipelineEvent` union, near the `delta_emitted` line) shows
  `{ type: 'delta_emitted'; action: PipelineAction }`, while
  `lib/pipeline/types.ts:49` carries `entryId?: string | null` as well.
  Raised 2026-10-22 in the pass failure policy slice's Task 2 review.

- **A refused Send destroys the earlier failure entry's text.**
  `runSubmit` drops the system tail before it dispatches
  (`app/reader-composer/[branchId].tsx`), and `dropSystemTail`'s own
  comment says a dispatch that then refuses has destroyed the entry's
  `submission` for nothing unless it puts the entry back. The
  `aborted` arm restores it; the `rejected` arm (the blocked one,
  around `:714`) writes a new failure entry for this Send's text
  instead, so the earlier turn's text, which outlives a restart only
  on that entry, is gone. The pass-refusal arms do the same: a Send
  whose owed pass fails, or that meets a held branch, clears the
  earlier failure entry in the tail drop and writes only this Send's
  text (`:684-700`). The system entry is a branch singleton, so the
  earlier entry can't simply be put back beside the new one. Raised
  2026-10-22 in the pass failure policy slice's Task 7 review.

- **`retries: 1` also applies to the opt-in real-provider smoke.**
  `playwright.config.ts:20` sets it for every spec, and
  `e2e/tests/classifier-real-provider.smoke.spec.ts` sets only a
  timeout. A model failure there doubles the run's worst case, and one
  that passes on the retry reports as flaky rather than failed. Raised
  2026-10-22 in the pass failure policy slice's Task 11 review.

- **The pass and turn failure copy resolvers repeat each other.**
  `describePassFailure` and `toPassFailureMeta`
  (`components/reader/system-entry-actions.tsx:89`, `:112`) repeat
  `describeTurnFailure` and `toSystemFailureMeta`'s four-way
  config-resolver key ternary (`:49-56`) and the provider detail
  format. A new `ResolveFailureKind` must be added in both or it
  silently falls through to the `providerMissing` copy; a
  per-vocabulary `Record<ResolveFailureKind, key>` would make it
  exhaustive. Raised 2026-10-22 in the pass failure policy slice's
  branch review.

- **The seeded hero branch holds six system rows.** `heroKind` in
  `lib/db/devtools/seed-dataset.ts:246-250` makes every twelfth of the
  72 hero entries `system`, against
  [`data-model.md`](../data-model.md)'s system entry as a branch-tail
  singleton, which `lib/classifier/window.ts:59-61`'s truncated-window
  argument relies on. Raised 2026-10-22 in the pass failure policy
  slice's branch review.

- **A completed regenerate drops a cleared failure entry's
  submission.** `runRegenerate` in `app/reader-composer/[branchId].tsx`
  clears the system tail before dispatching (`:789`); the throw arm
  hands `dropped.failure.submission` back (`:807`), but on a completed
  regenerate `planRegenerateOutcome` returns `'none'`
  (`components/reader/regenerate-outcome.ts:39`) and the submission is
  not handed back. Raised 2026-10-22 in the pass failure policy
  slice's branch review.

- **Reconcile's description embeds are neither bounded nor
  cancellable.** `EmbedDescriptions` (`lib/classifier/reconcile.ts`)
  takes no signal, so the pass's bound and its Cancel don't reach
  `embedClassifierDescriptions` (`lib/embedder-swap/app-deps.ts`)
  between the structured call and the writes: a hung remote embedder
  holds the pass, and the gate, until it returns. Predates the pass
  failure policy slice, which noted it as a monitor item; raised
  2026-10-23 by its slice review.

- **The recovery modal can promise a hold the boot reset already
  lifted.** `formatFailure` (`lib/recovery/copy.ts`) gives every
  `periodic-classifier` failure the branch-held copy, but
  `resetStuckClassifierRunState` (`lib/actions/classifier/deps.ts`)
  frees a branch whose failed orphan left no deltas (`deps.test.ts`,
  "reconciles a failed orphan that left no deltas behind"), as after a
  crash during the pass's call and a failed boot transaction for its
  marker. Canon's "definitionally stops them"
  ([`generation-pipeline.md → Recovery-failure policy`](../generation-pipeline.md#recovery-failure-policy))
  misses that case. Predates the pass failure policy slice (the copy
  said memory was paused); raised 2026-10-23 by its slice review.

- **A pass bound that expires during a retry backoff reports a
  timeout.** `callWithRetry` (`lib/ai/transport/call-with-retry.ts`)
  returns `aborted` when the signal fires in its backoff, and
  `generateStructured` (`lib/ai/generate.ts`) drops the attempts'
  recoverable errors, so a pass that met a 503 or 429 near its bound
  records `timeout after Nms` on the entry and in the status. Only the
  diagnostic is lost: the pass fails either way. Raised 2026-10-23 by
  the pass failure policy slice review.

- **`TxResult` lets a `failed` outcome carry no error.** `TxResult`
  (`lib/pipeline/types.ts`) has an optional `error` on every outcome,
  though every failed run sets one, so readers such as `passRefusalOf`
  (`components/reader/send-run.ts`) carry `PipelineError | undefined`.
  A union with `{ outcome: 'failed'; error: PipelineError }` would make
  it required
  ([`code-conventions.md → Type design`](../code-conventions.md#type-design)).
  Raised 2026-10-23 by the pass failure policy slice review.

- **The commit-msg hook doesn't check the subject.**
  `scripts/check-commit-msg.sh` counts only the body's lines, while
  `CLAUDE.md` caps the subject at 72 characters. Four of the pass
  failure policy slice's commits ran 73 to 75 (`28950818`, `042c011c`,
  `0f8086c0`, `21ae1f2f`). Raised 2026-10-23 by its slice review.

- **On Android a profile `timeout` may fail every call.** React
  Native's global `AbortController` (abort-controller@3) has no
  `AbortSignal.timeout`, as `lib/abort.ts` notes, yet the AI SDK builds
  one whenever a call sets `timeout` (`AbortSignal.timeout(totalMs)` in
  `node_modules/ai/dist/index.mjs`), and `buildCallSettings`
  (`lib/ai/generate.ts`) sets it from the profile. Read, not run on a
  device. Nothing writes a profile timeout before M7's settings UI;
  under the pass failure policy a classifier profile with one would
  fail every pass, and so every Send at cadence. Raised 2026-10-23 by
  the pass failure policy slice review.

- **The embed-failure spec builds its system-entry selectors inline.**
  `e2e/tests/retrieval-embed-failure.spec.ts` (~:104, :108) calls
  `getByText(t('reader:systemEntry.failure.embed'))` and the
  `failureMessage` twin in the spec, against
  [`testing.md → Selector strategy`](../testing.md#selector-strategy)'s
  "compose from `e2e/locators/`". `reader.systemEntryFailure`
  (`e2e/locators/reader.ts`) now covers the pass copies; widening its
  key union takes these too. Predates the pass failure policy slice;
  raised 2026-10-23 by its slice review.

- **E2E specs inline the current-branch query.** About fifteen specs
  (`periodic-classifier.spec.ts` five times, `turn.spec.ts`,
  `reader-*.spec.ts`, the real-provider smoke and others) run
  `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`
  through `queryApp` beside `currentBranchId` in `e2e/harness/db.ts`,
  which does the same. Predates the pass failure policy slice; its
  slice review's simplifier pass moved only the slice's own copy.
  Raised 2026-10-23.
