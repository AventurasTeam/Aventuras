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
  `ID_PATTERN` has no `entry` prefix, so the ledger keeps the raw
  `entry_` id, as `merge_happenings` records `occurredAtEntryId`. The
  review formats a new value as `entry #n` while `lookup.entryPosition`
  knows the entry (`lib/history/close-review-changes.ts`
  `updateSummary`), and shows the raw id once the entry is gone. Raised
  in 5.5a's review.
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
- **The close's task test files repeat their fixture helpers.** Under
  `lib/pipeline/definitions/close-agent/`, a `setSceneOf` is written in
  five test files (`identity`, `upkeep`, `lifecycle`, `lifecycle-tools`
  and `later-scene`), a `putSceneCharacter` in two (`lore`, `threads`), a
  `putEntityRow` in two (`identity`, `upkeep`), and a story-mode write in
  five. The scripted-dispatch harness they also repeated now lives in
  `__tests__/close-dispatch.ts`; these helpers stayed per file, and one
  module beside `__tests__/close-fixture.ts` would serve them. 5.9 added
  more of the same: a `seedHappening` now sits in five close test files,
  and `upkeep`, `driver`, `happenings`, `close-happenings`,
  `awareness-tools` and `close-awareness` each insert entity, happening
  and awareness rows directly. Two per-spec fixtures have since appeared:
  `__tests__/close-awareness-fixture.ts` holds a `putHappening` and a
  `putAwareness`, which `awareness-tools` and `upkeep` keep copies of,
  and `__tests__/happening-tools-fixture.ts` holds one of the five
  `seedHappening`s. `close-awareness-fixture.ts` also holds generic
  agent-loop stand-ins (`USAGE`, `stepWith`, `closePhaseFor`,
  `drainApplying`) with near-copies in `lore.test.ts`, `upkeep.test.ts`,
  `identity.test.ts`, `lifecycle.test.ts` and `driver.test.ts`. Raised in
  5.5b's review, widened in 5.9's and in its slice review.
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
- **Two close tool tests don't pin what their names claim.** In
  `close-agent/upkeep-tools.test.ts` the test named "…its group on E"
  never checks the group's anchor, and neither does
  `lifecycle-tools.test.ts`'s five-turn case ending before E: anchoring
  on the task's last turn instead keeps every close tool test green. No
  test cites a part-1 turn from part 2 and expects a refusal either, so
  swapping the part's turns for the turns handed handles goes unseen.
  Raised in 5.9's Task 1 review.
- **No retrieval test admits a happening through a seated chapter
  range.** `run.test.ts`'s `makeQueryAll` returns every happening
  whatever entry ids the query binds, so emptying the chapter-range
  boost loop in `lib/retrieval/run.ts` keeps all its cases green,
  including the one named for that admission. Raised in 5.9's Task 2
  review.
- **A folded stackable key can outgrow its schema bound.**
  `foldStackableKey` lowercases, and some letters lengthen when
  lowercased (`İ` becomes two code units), so a 40-character key can
  fold past the character schema's 40-character bound.
  `updateEntityStackables` doesn't check the schema, so such a key
  lands, and every later `updateEntity` carrying that character's
  `state` is refused until the key is shortened. 5.9's normalization
  step skips a record that would fold past the bound; the per-turn
  transfer writer goes through the same unchecked action. Rare input.
  Raised in 5.9's Task 7 and Task 16 reviews.
- **A count bump's undo can bring back a pre-reset count.**
  `bumpAwarenessRetrieval`'s undo restores the prior `retrieval_count` by
  assignment (`lib/actions/happenings/register-awareness.ts`), and
  reverse-replay rewrites only the copies a delete holds. So a rollback
  past a close puts a later turn's pre-reset count back over the close's
  reset, and CTRL-Z of the close can restore a kept row's count with a
  later turn's bump in it. One chapter's frequency signal is off; no
  data is lost. Candidate fixes: a relative undo for count bumps, or
  reverse-replay rebasing the held count. The later-bump case in
  `lib/pipeline/__tests__/close-round-trip.test.ts` pins today's
  behaviour. Developer decision 2026-11-14 (5.9): record the edge in
  canon, fix later.
- **A row-gone refusal never says which row went.** When a write names
  several rows, the note reads "The row was merged into c3" without
  naming the absorbed row, on the read gate's path and the plan's path
  alike (`survivorAmong` in `close-agent/verdict.ts`), so the model has to
  guess which named row to replace. Raised in 5.9's Task 9 review.
- **The row guard reads user edits once per row.** `readRowGuard`
  (`lib/actions/delta/row-guard.ts`) runs `userEditsSince` per guarded
  row, so a merge over many link rows makes one query each. Since the
  user-pin skip, that read starts at position 0, so each guarded row
  reads its whole user-edit history (about 0.5 ms a row at 5000 deltas
  on node:sqlite), though only `set_pin` needs the edits before the
  prose. Raised in 5.9's `merge_happenings` review, widened in its slice
  review.
- **Per-turn retrieval reads a cancel before the embed bound.** In
  `lib/pipeline/definitions/per-turn-retrieval.ts`, a cancelled outcome
  returns `aborted` before the bound's expiry is checked, so a cancel that
  arrived after the bound expired reads as a user stop. The close's range
  embed checks the bound first. Latent today: both embed paths report an
  expiry as a call error. Raised in 5.9's Task 12 review.
- **The close's embed leaves the embedding-status count stale.** The range
  embed clears stale flags without the `refreshEmbeddingStatus` per-turn
  retrieval runs, so a memory panel open during a close shows an old
  pending count until it reopens. The same count drives the story-status
  pill (`components/compounds/story-status-pill.tsx`, through
  `useMemoryHealth`), so the reader's pill can show the old pending rows
  until a later recount. Raised in 5.9's Task 12 review, widened in its
  slice review.
- **No lint stops a builtin Hermes lacks.** 5.9 shipped
  `Array.prototype.toSorted` into close code that runs on Android; the
  Hermes VM appears to lack it (inferred from the binary, not a device),
  and only review caught it. An eslint `no-restricted-properties` entry
  for such builtins outside tests, or a lessons-learned entry, would
  stop the next one. Raised in 5.9's clustering review.
- **`set_pin`'s user-pin skip gives the wrong reason.** A pin the user
  set before the cited turn is skipped under `USER_EDITED_SINCE_PROSE`,
  whose note tells the model "The user edited this after the cited
  turns", which is false for that case; the instruction not to write it
  again stands. `merge_happenings` gives the same reason for such a pin
  on the kept row or an absorbed one, since the slice review's R1. A
  key of its own (5.11 keyed every reason) would make the answer and
  the review accurate. Raised in 5.9's final review.
- **5.13's re-run meets three things 5.9 shipped.** Slice 5.13 (re-running
  a close) is planned on main; its doc isn't on this branch, so these wait
  for its Open questions. First, the later-bump case in
  `lib/pipeline/__tests__/close-round-trip.test.ts` overrides `armExpect`
  and `armLog` for its rollback arms, since a count bump's undo restores by
  assignment, and 5.13's re-run arms on that case need overrides of their
  own: after a rollback past E, TOLD's row reads its pre-bump count over
  the re-run's reset 0; after a rollback of a turn between E and the
  re-run, then CTRL-Z, TOLD's row ends at its pre-merge count holding the
  rolled-back bump. The test's key-list pins widen with them. Second,
  the phase-writes rule in
  [`generation-pipeline.md → Writes`](../generation-pipeline.md#writes)
  ("Never: delta-loggable writes outside those two events, delta-log
  appends, …") has no exception for 5.13's reversal phase, which prunes
  deltas and writes `reversal_journals`. Third, 3d's count-bump
  edge ([`chapter-close.md`](../memory/chapter-close.md#3d--awareness-pin-tuning))
  names CTRL-Z of the close; a re-run's CTRL-Z that undoes the close
  altogether is a second path to it. Raised in 5.9's slice review.
- **`runSyncStage` counts rows it didn't clear as embedded.**
  `lib/retrieval/sync.ts` returns `embedded` as the stale count once its
  write transaction runs, even when a guarded clear matched nothing (a
  row edited during the embed keeps its flag). Per-turn retrieval reads
  it only to trigger the status recount (`lib/retrieval/run.ts`), where
  an overcount costs one extra recount. The close's range embed logs it
  as `embedded` in `memory.close_range_embed`, which can overstate,
  though that log's `unembedded` comes from the range embed's own re-read
  of staleness. Raised in 5.9's slice review.
- **World merge re-creates awareness rows as the user's.** World's
  character merge (`lib/world/entity-merge.ts`, `merge-links.ts`) moves
  each awareness row the kept character lacks by re-creating it as a
  `user_edit` while `deleteEntity` cascades the original. The row guard
  reads a user create as a pin the user set, so `set_pin` skips the row
  at every close, the Awareness start leaves it out of the frequent set,
  a happenings merge keeps its pin on the kept row, and a merge that
  would absorb a happening a merged character knows is skipped
  ([`chapter-close.md → 3e`](../memory/chapter-close.md#3e--happenings-consolidation)).
  Re-pointing the row (an update of `character_id`) keeps its history,
  so only a pin the user set counts. Read from the code, not built, a
  re-point needs four things. First, a re-point arm on
  `happening_awareness`, its undo `{characterId}`. Second, the group's
  `deleteEntity` cascade has to skip the rows the group re-points:
  handlers read pre-group state, so the cascade still captures them and
  `groupConflict` refuses the group ("the group writes …, which a
  delete in it cascades", `lib/actions/delta/apply-delta-action.ts`);
  a widened `deleteEntity` payload or a `GroupScope` field. Third, redo
  has to skip them too: its delete arm (`applyRedoLocked`,
  `lib/actions/delta/redo.ts`) re-runs the cascade against the post-undo
  database, where the rows are back on the loser, and would delete them
  with no record, so every cascade's `run` likely takes an exclusion
  set. Fourth, History lists an awareness update only by its labelled
  columns (`lib/history/field-labels.ts`), so a re-point shows nowhere,
  where today's re-create lists. Reverse-replay needs no change by that
  reading: an undo restores the entity first, then points the row back.
  Involvements need nothing: their re-create trips Q5's deleted-link
  check and `userTouched` only in a close whose cited prose predates the
  World merge, and a re-point would be a user edit after that prose too.
  A cheaper alternative to weigh first, unverified: the re-create marks
  each row as carried from the loser's row, and user precedence reads
  the pin's ownership from the original row's history. It matters once
  3e fires
  ([`followups.md → Tuning and play testing`](../followups.md#tuning-and-play-testing)).
  Developer decision 2026-11-14 (Q13), from 5.9's slice review.
- **A frequent row whose pin a later turn wrote still takes a place.**
  The Awareness start leaves out rows a later turn created and rows the
  user pinned, but not a row learned before the chapter's end whose
  `decay_resistance` a turn past the end rewrote: the upsert's update
  arm takes a pass's new pin for a known pair (whether the classifier
  sends one is unchecked). `set_pin` skips that row (`laterTurnWrote`),
  so it holds one of the 20 places for nothing; at the next close the
  turn falls inside the chapter, and the row can be tuned if it comes up
  again. Leaving it out needs a later-turn read on the start's
  candidates, which the row guard does per row. Raised in the slice
  review fixes for 5.9's R2.
- **A History tab test fails under a loaded box.**
  `components/history/history-tab.test.tsx`'s "refetches for an unshown
  link end's rename only while a search is set" timed out once in a full
  `pnpm test:run` (load average 14, three slices' workers on one box):
  its `waitFor` saw the loader called 2 times, not 3. It passed three
  runs alone and the full suite an hour earlier. Unexamined: whether the
  search debounce outlasts `waitFor`'s default timeout or the test reads
  the call count before a pending search load lands. Raised in 5.9's
  slice review.
- **Upkeep's not-of-kind refusal has no test.**
  `lib/pipeline/definitions/close-agent/upkeep-tools.ts:97-100` and
  `:150` refuse a row of the wrong kind with `not-a-place` or
  `not-an-item`. A rename is now a type error, but the behaviour is
  unpinned. Raised in 5.11's review.
- **`set_keywords` records the planned list as its new value.**
  `upkeep-tools.ts:291` and `:332`. The handler can land a different
  list, because `planKeywordAdds` drops re-adds of terms the user
  removed (`lib/actions/delta/keyword-authors.ts:174-188`), so the review
  could name a keyword that was never written. Read, not run. Raised in
  5.11's review.
- **A `create_lore` refused for `title-blank` can never drop out of
  Not applied.** The review matches a refused create to a landed one by
  title, and a blank title matches nothing, so a retry with a title
  lists both a Not applied row and a Changes row. Option: treat a blank
  refused title like a value-less refusal. Raised in 5.11's review.
- **`delta-log-row.md` and its component differ on three points.**
  `docs/ui/patterns/delta-log-row.md:95-100`: the Visual shape diagram
  shows the summary and meta flush left, while the code indents them.
  `:105` says "~10-12 px dot or short pill", but the code renders a text
  pill. And `components/compounds/delta-log-row.tsx` `metaParts` filters
  only `null`, so `createdAtRelative: ''` leaves a trailing `·`.
  Raised in 5.11's review.
- **The reader's in-place prose edit has no leave guard.**
  `components/reader/reader-surface.tsx:~330` (`editingId`, `editDraft`):
  any navigation that pops the reader drops the draft, including the
  reader's own Return, and a review-row press from the reader adds one
  more path. [`save-sessions.md → Where applied`](../ui/patterns/save-sessions.md#where-applied)
  doesn't classify it. Raised in 5.11's review.
- **Keyboard-dead `Pressable accessibilityRole="link"` with no `href` or
  Enter handler.** RN-web's PressResponder doesn't press a role-link on
  Enter. Read, not run. Places:
  `components/reader/peek/peek-foot.tsx:21`,
  `components/world/overview/overview-parts.tsx:113`,
  `components/compounds/collision-list-row.tsx:42`,
  `components/compounds/breadcrumb.tsx:74`,
  `components/ui/select.tsx:376`,
  `components/compounds/calendar-picker.tsx:149` and `:376`,
  `components/compounds/embedder-download-dialog.tsx:388`.
  `components/chapters/review-window.tsx`'s `webEnterProps` is a
  template. Raised in 5.11's review.
- **`components/ui/dialog.tsx` has three gaps.** `:162` `DialogTitle` has
  no heading semantics on web; `:128` the × label is a raw "Close", not
  `t()`; `:68` a `DialogContent` without a description raises Radix's
  "Missing Description" warning throughout. Raised in 5.11's review.
- **A branch switch to a fork whose chapter rows copy the same ids keeps
  the review window open.** `chapterOverlaysStore`'s `review` holds only
  `chapterId`, and `overlayChapter` compares the store row's branch.
  Unreachable today, since no fork action exists; fix it when fork lands,
  e.g. the store records the open branch at `openReviewWindow`. Raised in
  5.11's review.
- **Hold the close result at the report phase's `delta_emitted` instead
  of re-reading on `run_complete`.** That event carries `branchId`, the
  chapter id and the report, and arrives after the store patch while the
  run is still registered. One change removes the run, nothing, done gap
  on the banner (about two DB round trips, during which the bar
  collapses), the failed-read fallback's guess, and the open-branch
  guess (`run_complete` carries no `branchId`, `lib/pipeline/types.ts:76-85`).
  Costs: it relies on C4's `close_report`-last write; it replaces the
  old result just before commit; the `actionId` and failed-read tests
  are rewritten; undo and redo don't emit on that bus. Raised in 5.11's
  review.
- **The commit banner's Review and × unmount the focused button.** Focus
  is lost when the review dialog closes (cf. the
  rnweb-disabled-under-focus-blurs lesson). Separately, a Stack keeps
  lower screens' banners mounted, and whether each `role="status"` change
  is announced once per mounted screen is unchecked. Raised in 5.11's
  review.
- **`overlays.md`'s `onDismissRefused` bullet ends in an unrelated
  sentence.** `docs/ui/patterns/overlays.md:171-175`: the one about
  `portalHost={ABOVE_SHEETS_PORTAL_HOST}` belongs under Stacking or
  `portalHost`. Raised in 5.11's review.
- **`lib/actions/delta/reverse-replay.ts` has two cases nobody has
  confirmed as deliberate.** `:380-393` and `:589-610`: reversing an
  update whose target row is missing runs an UPDATE that matches nothing
  and returns `ok`. `:555-570`: an undo partial that breaks the state
  schema is restored without validation. Raised in 5.11's review.
- **An E2E `getByRole` absence check made while a modal is open passes
  regardless.** The modal hides everything behind it from the
  accessibility tree (`e2e/locators/save-session.ts:9` notes the hiding).
  Worth a
  [`testing.md → Selector strategy`](../testing.md#selector-strategy)
  note or a lessons-learned entry. Separately, `e2e/flows/navigation.ts`
  has no `goToReader` flow, and about 15 specs inline it. Raised in
  5.11's review.
- **A landed merge's link-row losses can't name their row.**
  `settleLosses` (`lib/pipeline/definitions/close-agent/verdict.ts`)
  keys a merge's losses by path across all its actions, as C4 states, so
  a link loss drops from the ledger when another link on the same merge
  lands that path, and two characters' losses on one path collapse into
  one row. The review names no character for a link-row loss under the
  kept happening (Developer decision 4's known gap). The model's answer
  names them all; only the ledger loses them. A fix needs `skippedFields`
  to carry a row, which is a C4 v1 shape change (versioned
  `close_report`). A probe with Tobin's pin landing on keep and Wren's
  user-kept: the model was told `notWritten: decayResistance (c1)`,
  `skippedFields` was empty, and Not applied was `[]`. Raised in 5.11's
  review.
