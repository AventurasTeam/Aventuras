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
  - 2026-10-25, the 2026-10-24 triage pass: `Trigger Opens Overlay`
    failed once in a full parallel Storybook run (145 files) at a
    commit whose `components/wizard/` matched main's, and passed 3 of
    3 alone. The other two full runs that day were green.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **C11 names four handlers with a hard `not-found`; more have one.**
  [C11](./milestones/05-chapters-chapter-close/milestone.md#c11--tool-results)
  lists `updateEntity`, `updateLore`, `updateThread` and
  `updateHappening` as returning a hard `not-found` that aborts a group.
  `updateEntityVisualState`, `updateEntityInventory`,
  `updateEntityStackables`, `updateItemPosition` and
  `updateEntityLocationTracking`
  (`lib/actions/entities/state-patch-actions.ts`) and `updateInvolvement`
  (`lib/actions/happenings/register-involvements.ts`) do too, so a close
  tool over one of them gets a whole-group refusal where C11's table
  reads as a per-action verdict. Those carry no code, and neither do
  `deleteInvolvement`'s and `deleteAwareness`'s
  (`register-involvements.ts`, `register-awareness.ts`); the delete
  handlers of entities, lore, threads and happenings, and the chapters
  update, return the coded `not-found` C11 names but doesn't list them.
  Raised in 5.5a's review.
- **Handlers read committed rows, so a row created earlier in the same
  group reads as missing.** `placeLocationHandler` takes no `GroupScope`
  (`lib/actions/entities/state-patch-actions.ts`), and the
  `partner-not-found` and each target's `... not found` refusals read the
  same way. 5.5a marks all of them `gone`, so once the close's
  verdict mapping reads marks the model would hear that a row it just
  created is gone. The fix is reading the group's created rows through
  `GroupScope`, not a mark special case. Nothing groups a create with
  such a write yet; a close tool that does needs it. Raised in 5.5a's
  review.
- **A row the group creates passes as a faction.** `membershipKind`
  (`lib/actions/entities/state-patch-actions.ts`) reads any row in
  `GroupScope.created` as a faction, since the scope holds keys only, so
  a `setCharacterFaction` naming a character or place the same group
  creates would land. `GroupScope.created` should carry each created
  row's kind, so that write is refused `not-a-faction`. No writer
  reaches it today: the classifier resolves its faction ref by kind and
  writes through `delta_emitted`, outside a group. A close tool that
  groups a create with a membership would. Raised in 5.5a's review.
- **A parallel group's failing branch outlives the reversal.**
  `runParallelGroup` (`lib/pipeline/runtime/orchestrator.ts`) awaits
  `Promise.all`, so one branch's throw reverses and fails the run while
  its sibling keeps going; the sibling's next write lands under the
  run's `actionId` after the reversal and is never reversed. Canon says
  to drain the streams and wait for every branch
  ([Parallel-group event coordination](../generation-pipeline.md#parallel-group-event-coordination)).
  Shown by probe on both write paths in 5.5a's review; latent, since no
  production pipeline declares a parallel group.
- **`consumePhase` never closes a phase whose event throws.** When
  `handleEvent` throws, the generator gets no `return()`, so a phase's
  `finally` around a `yield` never runs. No phase has one today
  (`chapter-close-metadata-call.ts`, `periodic-classifier.ts` and
  `per-turn-retrieval.ts` checked). Raised in 5.5a's review.
- **The two write paths disagree on what a bus event means.** A
  `delta_emitted` noop or refusal never reaches the bus, while a
  `delta_group_emitted` reaches it whether the group landed, no-oped or
  was refused whole (`handleEvent`, `lib/pipeline/runtime/orchestrator.ts`).
  [Phase iteration](../generation-pipeline.md#phase-iteration) says the
  orchestrator forwards every event. No production code subscribes to
  delta events yet; one rule for both paths is wanted before one does.
  Raised in 5.5a's review.
- **`promoteStagedEntity`'s store-only guard can still refuse a
  legitimate promotion while a story opens.** `loadOpenStory` reads
  `entities`, then hydrates after eight more reads, so a write or
  reversal landing in between leaves the store copy active over a
  DB-staged row, and `promoteStagedEntityHandler` refuses `not-staged`;
  since 5.5a that reads `rejected`, not `ok`. The row lock may make the guard
  redundant: `promoteStagedEntity` takes the row's lock key, so two
  promotes through the action layer serialise and the second reads the
  DB already active. The lock did not come later: `ae48d4513` (M3.2)
  added both, `a6d81c572` (M4.2a) only widened the key. The stale store
  itself is the next entry. Raised in 5.5a's review.
- **A write that commits while a story opens is lost from its stores.**
  `loadOpenStory` (`lib/actions/stories/operational.ts`) reads every
  working-set table one after another, then hydrates them all together,
  so a write committing in between is lost from the store, either way:
  if the store already holds that branch, the write's patch applies and
  the hydrate overwrites it; if not, the patch is dropped
  (`lib/stores/factory/working-set-store.ts`, a branch the store doesn't
  hold) and the hydrate brings the older rows. World and the other store
  readers show the old row until the next open. The writers that can
  land in that window are background runs on that branch: a pass, or a
  close. Raised in 5.5a's review.
- **`teardown.spec.ts`'s rejected-close case can hang its first attempt,
  and the hang fails the shard though the retry passes.** "a rejected
  close still ends the app before its userData goes" timed out at its
  120 s on the packaged project in CI, then the worker's teardown passed
  Playwright's 90 s, an error outside any test; the retry passed in 4 s.
  Seen twice on E2E shard 3/3: PR 717 (run `42462233487`, 2026-11-08),
  a docs-only push whose code had passed E2E one push before, and PR 721
  (run `42665576759`, 2026-11-09), a code push that touched no `e2e/` or
  `electron/` file. Not yet
  traced: whether the hang is in the harness ending the app after the
  rejected close, or in the app itself. Raised in 5.5a's review.
- **`set.state` in `updateEntity` stores a patch's keys the schema
  doesn't know, with no undo record.** `set.state` takes the raw
  patch while `computeUndoPayload` walks only `entityStateColumnSchema`
  (`lib/actions/entities/register.ts`), so a `state` key outside the
  schema lands and a reversal can't remove it. When such a key is the
  only change, nothing is written and the handler returns `no-op entity
patch`, which 5.5a marks `restated`, so a close tool's write of it
  reads `ok` with nothing written and leaves no trace in the review.
  Raised in 5.5a's review.
- **`deepEqual` treats `[]` and `{}` as equal.** It compares any two
  objects by their keys (`lib/actions/delta/delta-encoding.ts`), so an
  empty array and an empty object read as unchanged. Raised in 5.5a's
  review.
- **`IdBiMap.allocate` ignores handles `registerHandle` set.**
  `lib/ids/bimap.ts` counts per placeholder prefix and never checks the
  counter against a registered handle, so a registered `c5` could later
  be handed to another id. Nothing triggers it today: the close
  registers only `t` and `aw` handles, which aren't placeholder
  prefixes. Raised in 5.5a's review.
- **A landed entry ref in a close's `values` is stored raw.**
  `ID_PATTERN` doesn't cover `entry_` ids, so the ledger keeps one as
  its id, such as a merge's earliest `occurred_at_entry_id`, and 5.11
  shows new values as the report holds them. Raised in 5.5a's review.
- **The real delta action port is assembled in three places.**
  `lib/boot/bootstrap.ts`, `vitest.setup.ts` and
  `realDeltaActionPort()` in `lib/pipeline/__tests__/harness.ts` each
  list every `DeltaActionPort` member, and `scripts/close-probe.ts` now
  borrows the test harness's. The type makes a missing member a compile
  error, so nothing drifts silently; the cost is three edits per new
  port method. One builder in the action layer would serve all of them,
  but `vitest.setup.ts` must not load the `@/lib/pipeline` barrel before
  a test's mocks, and `bootstrap.ts` pulls in UI modules a script can't
  load. Raised in 5.5a's review.
- **The close's scripted-dispatch test harness exists six times.**
  `write-path.test.ts`, `identity.test.ts`, `threads.test.ts`,
  `lore-tools.test.ts`, `upkeep-tools.test.ts` and
  `lifecycle-tools.test.ts` under `lib/pipeline/definitions/close-agent/`
  each build the same `DispatchContext` (about 80 lines), and the task
  test files also repeat their fixture helpers (story mode, scene
  setters, thread seeds). One helper beside `__tests__/close-fixture.ts`
  would serve all six before 5.9 adds more. Raised in 5.5b's review;
  5.8 added the last three.
- **`setThreadStatus` and `updateThread` read "carries refs"
  differently.** `setThreadStatus` writes the resolved ref only when
  `triggeredAtEntryId` is set, while `updateThread` asks whether either
  ref is (`lib/actions/threads/register.ts`). A thread holding only a
  resolved ref would keep a stale one after a status change. Nothing
  writes that shape today, since a pass's create always sets the
  trigger. Raised in 5.5b's review.
- **A close's "Writes so far" names delta paths, not fields.** The
  ledger's lines read `state.traits` (`close-agent/ledger.ts`), while
  the task templates show the same field as `traits`, so the model has
  to join the two itself. Raised in 5.5b's review.
- **The 5.5a probe test restates the close's system half.**
  `lib/prompts/bundled/bundled-pack.test.ts` keeps a copy of the
  `CLOSE_TASK_SYSTEM` text instead of importing the constant, so the
  macros test checks a copy rather than the half that ships. Raised in
  5.5b's review.
- **`search_world` breaks ties with `localeCompare`.** Its result order
  then depends on the device's locale
  (`close-agent/read-tools.ts`), which `identity.ts` and
  `lib/retrieval/injection.ts` avoid with a code-unit compare. Raised in
  5.5b's review.
- **Katakana with the long-vowel mark loses substring matching.**
  `usesSubstringMatch` (`lib/retrieval/name-index.ts`) tests
  `\p{Script=Katakana}`, but ー (U+30FC) is Script=Common and a letter,
  so a term such as シルバー falls back to word-boundary anchoring:
  `matchTerms('シルバーは笑った。', ['シルバー'])` returns nothing. That
  contradicts
  [`retrieval.md`](../memory/retrieval.md)'s rule that kana terms match
  by substring, and it reaches the keyword scan and name suppression in
  Japanese stories. A likely fix is `Script_Extensions=Katakana`.
  Separately, `normalizeTerm` doesn't collapse internal whitespace, so a
  query with a doubled space matches nothing. Raised in 5.5b's review.
- **`code-conventions.md` doesn't name the pipeline's two import
  exceptions.** `eslint.config.js` lets `lib/pipeline` deep-import
  `actions/types.ts` and, since 5.5b, forbids a value import of the
  `lib/actions` barrel (a cycle through the mocked `@/lib/pipeline`);
  [Module structure](../code-conventions.md#module-structure) mentions
  neither. Raised in 5.5b's review.
- **The close's round-trip snapshot leaves out translations and vector
  rows.** `WORLD_TABLES` in `lib/pipeline/__tests__/close-round-trip.test.ts`
  compares neither, though they are a thread's link rows, and its
  full-row compare can't hold for an embedded row (a reversal marks it
  stale), so every fixture row is one that was never embedded. Worth
  fixing before M8 writes thread translations. Raised in 5.5b's review.
- **The dataset seed test keeps its own copy of the branch id.**
  `scripts/dataset-chapter/treasure-island.seed.test.ts` spells the
  dataset branch out instead of importing `DATASET_BRANCH_ID`. Raised in
  5.5b's review.
- **"Every history marks the user's turns" leaves three histories out.**
  [`architecture.md`](../architecture.md#system-and-user-halves) names
  the narrator's histories and the close's turns, but the
  chapter-metadata call, its per-part call and the suggestion refresh
  render through `macro_story_entry` and mark them too. Raised in 5.5b's
  review; 5.8 added the per-part call.
- **Boot recovery reverts a close that is still running.**
  `recoverInFlightRuns` (`lib/pipeline/runtime/recovery.ts`, called only
  from `runBootstrap`) reverses every `pipeline_runs` row with no
  `finished_at`, with no check against the runs live in this process.
  Observed: 5.5b's dev-route close failed once in a way that fits, the
  report phase finding no chapter row and a "Story recovered" modal
  following. It didn't reproduce on a clean rerun and no Fast Refresh
  was observed, so the trigger is unconfirmed. Assumed, not shown: that
  only a dev build can re-run the bootstrap under a live run, through a
  Fast Refresh that re-runs `RootLayout`'s bootstrap effect. Production
  is unverified. A candidate production path to check (the
  coordinator's reading, not verified on a device): React Native's
  Android host keeps the JS runtime in the Application, which outlives
  the Activity, so a re-created Activity remounts `RootLayout` in the
  same runtime, `useBootstrap`'s effect runs `runBootstrap` again while
  the close's promises are live, and `recoverInFlightRuns` reverses its
  unfinished `pipeline_runs` row. The Activity is re-created on a config
  change outside the manifest's `configChanges` (locale, font scale,
  density), on Back from the root Activity on Android 11 and below, and
  under "Don't keep activities"; the prebuild manifest's
  `configChanges` is `keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize`.
  Raised in 5.5b's measure.
- **The close's count priming assumes the system half holds each turn's
  prose once.** `renderClosePrompt` / `primeCloseSystemCount`
  (`lib/pipeline/definitions/close-agent/turns.ts`) prime the system
  half's count as the blank half's count plus the turns' stored prose
  tokens, with no check. That holds while the
  bundled pack renders `macro_story_entry` and the close templates as
  shipped. Once M7.2's pack tab lets a user edit them, a truncating,
  moved or doubled `{{ entry.content }}` makes the estimate wrong
  silently, and the pre-send check has no margin. A guard: prime only
  when the rendered half's length minus the blank half's equals the
  summed turn contents, else count exactly. Raised in 5.5b's final
  review.
- **5.5b's slice doc has stale passages.** The slice review couldn't
  edit
  [the slice doc](./milestones/05-chapters-chapter-close/slices/05b-identity-threads.md).
  Scope's refs point at moved lines: `lib/classifier/plan-creates.ts:55-57`
  (now `boundVoice`, with `stateList` moved), and
  `lib/actions/threads/register.ts:135-142`, `:145-154` and `:152`.
  [The test overlay](./milestones/05-chapters-chapter-close/slices/05b-identity-threads.md#the-test-overlay)'s
  dataset facts ("the most traits on a live one is 4", "8 have no
  description, Jim Hawkins among them", the faction's state `{}`) are the
  seed before its refresh, in the present tense, where
  [`followups.md`](../followups.md#tuning-and-play-testing) says "before
  Slice 5.5b's refresh". The seed-refresh note, "27 calls, 16 landed (11
  entity updates, 4 thread updates and the merge) and 1 merge", counts
  the merge twice: all 27 calls were `ok`, 16 wrote and 11 restated.
  [Canon edits](./milestones/05-chapters-chapter-close/slices/05b-identity-threads.md#canon-edits)
  leaves out 3b's start and empty-list sentence, 3f's ref clamp, the
  merge's kept-row rule, `search_world`'s limit and ranking,
  `architecture.md`'s halves-table row and count-cache paragraph,
  `observability.md` and `testing.md`. Raised in 5.5b's slice review.
- **Two duplicates the close's code waits on a third use for.** The
  capped list names (`traits`, `drives`, `agenda`) are spelled in
  `scripts/dataset-chapter/overlay.ts` and again in
  `scripts/close-probe-rejudge.ts`; one exported constant in
  `close-agent/fields.ts` would make the re-judge load the classifier,
  piggyback and wizard barrels it now avoids by importing a type only.
  And `updateThread` and `updateHappening` repeat one
  restated, user-kept and write loop (`lib/actions/threads/register.ts`,
  `lib/actions/happenings/register-happenings.ts`), which a shared
  helper would take about six parameters to serve. Worth lifting when a
  third copy appears. Raised in 5.5b's slice review. The third copy of
  the loop has appeared: 5.8 gave `updateLore` the same restated,
  user-kept and write loop (`lib/actions/lore/register.ts`), with no
  refs, so a helper may take fewer parameters than that estimate; three
  handlers now carry one precedence rule, so drift is a precedence
  bug. Noted in 5.8's final review.
- **The close's model target is spelled three times.** The chapter
  close's metadata phase, its call and the close agent each declare
  their own `lore-mgmt` target (`chapter-close-metadata.ts`,
  `chapter-close-metadata-call.ts`, `close-agent/run-task.ts`), beside
  `CHAPTER_CLOSE_RESOLVES` in `chapter-close.ts`. The parts cut reads
  its window from that target, so it is right only while the prose
  tasks run on the same model, and nothing ties the copies together.
  One exported close target would. The phases also resolve it at
  different times: the metadata phase cuts the parts from its own
  settings snapshot and the agent phase reads a later one, and App
  Settings → Providers (Quick wire, Fetch models) isn't gated during a
  close. A reassignment or a smaller detected window between the two
  leaves parts sized for the old window, so the first task call fails
  the close, and the next run cuts afresh. Resolving the target once and
  storing it beside the parts would close both. Raised in 5.8's task
  review; the timing in its slice review.
- **A new mock shape answers `{}` from an older `state.json`.** In
  `scripts/mock-llm/state.ts`, `loadState` gives a shape the saved file
  lacks an empty lane, not its shipped default. So every shape added
  after a developer's `state.json` was written answers `{}` until the
  file is deleted; 5.8's chapter metadata part and merge lanes are the
  latest case, and a multi-part close then fails to parse in the dev
  mock. Raised in 5.8's task review.
- **A bracket of several handles hides them from prose naming.**
  `PROSE_TOKEN` in `lib/classifier/substitute.ts` takes a whole
  bracket as one token, so `nameIdsInProse` and the close's
  `nameCloseProse` leave `[c1,c2]`, `[c1-c3]` or `[c1,t3]` unnamed,
  and a stored row handle survives in a pass's and a close's prose.
  The close's turn-handle check scans bare tokens instead. Raised in
  5.8's task review.
- **No test pins a prose task's token count into its render.** In
  the close's Identity, Threads, Lore and Upkeep tasks, passing 0 for
  `proseTokens` to `renderClosePrompt` still passes every task test.
  The count primes the system half's token total, so losing it would
  undercount the window check. One shared pin would cover every prose
  task. Raised in 5.8's task review.
- **The close's placement plan copies two handler details.** The
  `not-unplaced` and `parent-not-a-place` refusals are inline strings
  in `state-patch-actions.ts`, outside `PLACE_REFUSAL`, and
  `branchPlaces` (`parent-chain-check.ts`) isn't exported, so
  `close-agent/placement.ts` copies both and can drift from the
  handler. `close-agent/lifecycle-tools.ts`'s `REFUSAL` copies four
  more inline handler strings the same way: `location` and `not-active`
  (`retireEntityHandler`), `partner-is-self` and `partner-not-of-kind`
  (`raiseCollisionFlagHandler`). An exported constant, as `lib/world`'s
  `PLACE_REFUSAL` is, would tie each pair. Raised in 5.8's task review;
  the lifecycle copies in its slice review.
- **`retiredReason` has no length bound.** The classifier's `reason`
  (`lib/classifier/schema.ts`) is a plain optional string, and the
  close stores `retire_entity`'s `why` the same way, while the close's
  other stored text is capped (a condition at 500, a lore body at
  1,200). Raised in 5.8's task review.
- **Reactivating a row in World keeps its retired reason.**
  `lib/world/entity-actions.ts` patches `retiredReason` only when the
  draft changes it, and the settings tab only makes it read-only, so a
  row set back to active keeps a reason `data-model.md` calls
  meaningful only while retired; the classifier's return from
  retirement clears it. A close's Lifecycle task shows a reason only
  on a retired row (developer decision, 2026-11-10), so the stale one
  stays in the database and the export, and World's list search
  (`lib/list-modules/entity-list.ts`) still matches a restored row on
  it. Read in the code, not run. Raised in 5.8's task review.
- **Undoing a user's keyword edit wipes a later pass's term.** CTRL-Z
  or a rollback window of a user's keyword edit under a later
  periodic keyword write restores the whole list from the undo
  payload, wiping the pass's term, while the pass's surviving delta
  keeps a before-list without the user's restored term. The close's
  keyword-author walk then credits that term to the pass, and a later
  close may remove it (5.8 records this as the walk's second known
  gap). The same whole-list restore may hit other list fields a pass
  appends to, unchecked, and `data-model.md`'s "periodic-classifier
  deltas above it … stay put" doesn't hold when they wrote the same
  field. Same root cause and fix as the parked
  [keyword undo item](../parked.md#a-keyword-writes-undo-restores-the-whole-prior-list),
  whose revisit signal this is. For the undo substrate's owner. The Keywords
  schema section of `retrieval.md` links this item, so a triage pass
  updates that link when routing it. Raised in 5.8's execution,
  developer decision 2026-11-10.
- **A pass stores a turn handle written into prose.**
  [classifier.md's ID handling](../memory/classifier.md#id-handling-in-classifier-output)
  names each id a pass's reply writes into prose before it lands, and
  keeps a token that names nothing as written. A turn handle names no
  row, so a reply that writes "as t3 shows" into a description stores
  `t3`, which a later prompt reads as its own turn. Chapter close
  refuses such a field
  ([`chapter-close.md → Tools and writes`](../memory/chapter-close.md#tools-and-writes));
  the periodic classifier has no such check. Surfaced by 5.5a's review.
- **A close's stored refusal reasons carry raw ids and per-close
  handles.** `update_lore`'s title refusal stores the holder's full
  lore id twice in the ledger (`close-agent/lore-tools.ts`), while
  `create_lore`'s stores the bare `title-taken`; and the turn-handle and
  keyword-handle reasons store per-close handles (`t3`, `c1`) that mean
  nothing once the close ends. The `why` is named at record time; the
  reasons aren't, so a review UI (5.11) would show a UUID and two
  spellings of one rule. Raised in 5.8's final review.
- **Same-name items carry no namesake flag.** The dataset seed held two
  active items both named "the black spot" with no collision flag
  until 5.8's close flagged them `duplicate`. Unverified whether the
  per-turn writer or the classifier skips same-name items by design.
  Raised in 5.8's final review.
- **Keyword lists have no count or term-length bound.**
  `appendEntityKeywords`, and now the close's `set_keywords` and
  `create_lore`, land whatever terms the model sends, while chapter
  metadata caps its keywords (`CHAPTER_KEYWORDS_MAX`). Each term feeds
  keyword injection on later turns. Raised in 5.8's reviews.
- **A context group promises variables some of its templates never
  get.** `lib/prompts/templateContextMap.ts` describes one variable list
  per group and marks `chapter`'s `entries`, `previousChapterSummary`,
  `threads` and `mode` `required`, but the close tasks' renders set only
  `mode` and their own variables, and the metadata merge sets no
  `entries` or `mode`. Nothing reads `required` outside tests today, so
  it misleads only the template editor (M7): an override that reads
  `entries` in a close task renders it empty. 5.8 added four more
  templates to the group. Raised in 5.8's slice review.
- **A later part's create closes the row to an earlier part.** A close's
  per-part task reads C12 past its part's last turn, and a create
  counts as writing every field, blank ones included (`wrotePath` in
  `lib/actions/delta/user-precedence.ts`, through `wroteField`). Upkeep
  shows a part every live row its prose names off the scene
  (`startUpkeep`), so an earlier part can name a row a later part's turn
  first created and write nothing to it: detail only the earlier part's
  turns hold is lost. Candidate fix: inside the later-turn check only,
  a later part's create counts only for the fields it set non-blank;
  `wroteField`'s create rule stays as it is for user precedence. 5.8
  records the limit
  ([`chapter-close.md → Tools and writes`](../memory/chapter-close.md#tools-and-writes)).
  Raised in 5.8's slice review, developer decision 2026-11-10.
