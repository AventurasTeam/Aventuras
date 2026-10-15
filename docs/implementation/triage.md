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

- **The `Holds:` and `Here:` lines can contradict a retrieved or pinned
  held or loose item labelled "(currently elsewhere)".** The label comes
  from `lib/retrieval/rendered-text.ts:9` and
  `lib/prompts/bundled/memory-blocks.ts:13`, and the structural floor
  seats only the scene entities, the current location and active
  threads (`lib/retrieval/pools.ts:105-109`), so an item the prompt
  shows as held or lying here can also render as elsewhere. Candidate
  fixes: feed the held and loose ids to retrieval so it neither labels
  them elsewhere nor renders them twice; seat them in the structural
  floor with their descriptions (a floor and budget-accounting change);
  or have the templates skip them, which loses the item's description
  since `Holds:` shows only the name, wastes the ranked budget and
  leaves custom packs unfixed. Raised 2026-10-11 in the
  locations-and-items-from-prose PR.

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

- **`scoreDescriptions` swallows embedder errors without logging.**
  `lib/classifier/reconcile.ts` (~line 138) catches in a bare block, so
  an embedder outage silently turns off item and character matching.
  Raised 2026-10-11 in the locations-and-items-from-prose PR.

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

- **The real-provider smoke gives up on the watermark when one
  classifier call times out.** `e2e/tests/classifier-real-provider.smoke.spec.ts`
  polls for the periodic classifier's watermark to move for at most
  300 s (`expect.poll`, `timeout: 300_000`). The classifier's model call
  is allowed the same 300 s (`CALL_TIMEOUT_MS` in
  `lib/pipeline/definitions/periodic-classifier.ts`), and its first retry
  waits a further 30 s (`BACKOFF_MS` in `lib/classifier/status.ts`). So
  one slow call fails the smoke where the app would recover: the timeout
  leaves the classifier `retrying`, not `failed-persistent`, and the
  scheduler runs the pass again after the backoff. Seen by the developer
  at `9a490a48` with Gemma4-26B-A4B on a local OpenAI-compatible server:
  three runs gave 1 pass, 1 fail and 1 flaky, and every failed attempt
  stopped with the watermark at its parked value. The failed run's database shows
  the classifier call timing out (`lastError` "timeout after
  300000ms"); the passing retry's classifier call took 255 s. The same
  smoke passed 3 of 3 at the system and user halves PR's head. Fix,
  decided by the developer: increase the smoke's timeouts. The
  watermark poll's `timeout: 300_000` must outlast one call timeout, the
  backoff and a second call, and the test's `test.setTimeout(600_000)`
  must still leave room for that after the turn loop, whose own waits
  (`toBeEditable` up to 120 s and the run-settle poll up to 240 s, per
  attempt) draw on the same budget. The numbers aren't chosen. This is
  the only `*.smoke.spec.ts` under `e2e/tests/` today. Raised
  2026-10-11 by the developer's smoke runs for that PR, recorded in its
  description under "Developer checks before merge".

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

- **A periodic pass isn't cancelled when its story closes.** After its
  model call the pass re-reads the global entity stores
  (`lib/pipeline/definitions/periodic-classifier.ts`, the re-read before
  reconciliation) and filters them by its branch, with no check that the
  stores still hold that branch, as `loadPerTurnWorkingSet` makes for a
  turn. Nothing found in `lib/stores/generation` or the story actions
  cancels a pass when the user closes the story or switches branch, so a
  pass finishing then could reconcile its new characters against an
  empty roster and create them unmatched. Unverified: not traced through
  story close, and not reproduced. The mentioned-places implementation
  makes the same check for places; this item is the character path,
  which predates it. Raised 2026-10-16 by the mentioned places design.

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
