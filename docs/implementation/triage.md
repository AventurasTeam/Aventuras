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

- **`chaptersStore.patch` takes a raw row from any caller.** The
  working-set store's `patch` casts `p.row` and `p.columns` to the row
  type (`lib/stores/factory/working-set-store.ts:31,36`), so a direct
  caller would put `closeReport` into the store, skipping the
  projection at the chapters patcher. Today only the patcher and the
  hydrate write the store; the guarantee is convention. Surfaced by
  Slice 5.2's review.
- **The chapters update keeps unchanged columns in its undo payload.**
  Unlike lore (`lib/actions/lore/register.ts:125-130`), which drops
  them because History reads an undo payload's keys as the fields that
  changed (`lib/actions/chapters/register.ts`, the update handler).
  Matters once a chapter edit shows in History. Surfaced by Slice 5.2's
  review.
- **Partial `TxState` fixtures escape the type checker.**
  `lib/pipeline/definitions/suggestion-refresh.test.ts:207-212` builds
  one cast `as never`, already without `deferred` and `pendingClose`,
  so a new `TxState` field never flags it. Harmless while
  `isUserEditBlocked` reads only what it has.
- **A bundled template's group is declared twice, unchecked.**
  `lib/prompts/bundled/index.ts` sets each template's `group` (read by
  the include validator) and `TEMPLATE_GROUPS` declares it again, and no
  test compares the two. Only some one-sided changes fail a test, by
  another route: `lib/prompts/templateContextMap.test.ts` pins
  `TEMPLATE_GROUPS` for `chapterMetadata` to `'chapter'`,
  `bundled-pack.test.ts` counts 13 templates whose `index.ts` group is
  `wizard`, and the include validator refuses a group the template's
  macros don't fit.
- **The story-entry handlers' branch scope is untested on update and
  delete.** `lib/actions/story-entries/register.test.ts`'s `seed`
  creates only branch `b1`, so dropping the branch condition from
  those handlers' writes stays green (entry ids repeat across branches:
  the PK is `(branch_id, id)`). The stamp handler's case shows the
  shape.
- **Refusal codes repeated as literals.** `'branch-not-open'`
  (`lib/actions/classifier/run-now.ts:14`) and `'embedder-swap'`
  (`lib/actions/turns/submit-turn.ts:54`) restate
  `MANUAL_CLOSE_REFUSAL.branchNotOpen` and `.swapPending`
  (`lib/actions/chapters/close-chain.ts`).
- **Pre-flight reads the open story's settings after two awaits.**
  `lib/pipeline/runtime/orchestrator.ts:558-560` reads
  `currentStoryStore.getCurrentStory()?.settings` after `beginRun` and
  `settleUserWrites`; a story switch in between checks the wrong
  story's settings. Unverified as reachable.
- **Seeded entry creates carry no anchor.** The dev seed's
  `createStoryEntry` deltas have `entryId: null`
  (`lib/db/devtools/seed-dataset.ts`), while a real reply's create is
  anchored on itself. Rollback treats both alike, but
  `lib/actions/story-entries/pre-entry-locations.ts` keys on that anchor
  and falls back on the seed. Surfaced by Slice 5.2's review.
- **The seed's fork at `entry_hero_0040` has no chapters.** A real fork
  there would copy `chap_hero_1`, whose anchor (29) survives, per the
  data-model branch-copy manifest.
- **The long-branch fixture's chapters have no deltas.**
  `scripts/seed/long-branch.ts` writes chapters and entries with no
  create or close deltas, so a rollback or CTRL-Z on a long branch
  refuses `no-create`. Fine while it stays a read-only performance
  fixture.
- **`single()` lives in the World module.** The route-param helper
  (`components/world/world-selection.ts:9`) is imported by Plot, the
  reader, `plot-selection` and the dev chapter-close route.
- **`/dev/*` routes are reachable by deep link in a release build.**
  `app/dev/_layout.tsx` has no `__DEV__` gate; only the Settings button
  to the dev index does. For the chapter-close route this is Slice 5.2's
  decision; for `/dev/reseed` and the rest it is unexamined.
- **The embedder drain drops a run's idle note while a pass runs.**
  `noteIdle` (`lib/embedder/drain.ts:198-204`) does nothing mid-pass, and
  the pass's row list predates the run's writes, so a row made stale by a
  run inside one batch stays stale until the next `run_complete` or turn.
  Retrieval stays correct (the drain is warm-cache only); quiescence can
  be put off. `kick` already records a pending re-run.
- **A harness comment assumes WAL.** `e2e/harness/db.ts:17` justifies
  `queryApp` by "a second file handle can miss a WAL-buffered write", but
  the desktop database runs in rollback-journal mode.
- **Hand-written types beside `z.ZodType<T>` schemas drift one way.**
  The import schemas in `lib/avts/` (`thread.ts`, `lore.ts`,
  `happening.ts`, `entity.ts`) are annotated with a hand-written type,
  which checks only that the schema's output fits the type. A schema
  that narrows a field (a nullable one made required) or adds one the
  type lacks still compiles; a dropped or widened field fails (a scratch
  `tsc` check on zod 4.4.3). Slice 5.2's close report derives its types
  with `z.infer` instead. Surfaced by Slice 5.2's review.
- **Update handlers type their patch apart from their column list.** The
  entities, lore, threads, translations, era-flips and entry-assets
  registers declare the update patch type separately from the
  `UPDATABLE` list the handler loops over, so a key added to the type
  alone compiles and the handler skips it: silently beside another key,
  and as a `no updatable fields` refusal alone. Slice 5.2's chapters
  register derives its patch type from the list. Surfaced by Slice 5.2's
  review.
- **The periodic pass reads the stores after its awaits.**
  `periodicClassifierPhase`
  (`lib/pipeline/definitions/periodic-classifier.ts:189`) checks
  `storesHoldBranch` (`:193`), then awaits `readStatus` (`:199`) and
  `readWindowEntries` (`:201-205`), then reads the entity, relationship,
  thread and happening rosters from the stores (`:222-232`), and the
  awareness rows after one more await (`:237-239`). A story open
  publishing in between gives it another branch's rows, filtered to
  empty. Unverified what the pass then writes. Slice 5.2's close metadata
  call reads its stores before its first await. Surfaced by Slice 5.2's
  review.
- **Phase intermediates are an untyped bag.** `PhaseContext.intermediates`
  is `Record<string, unknown>` (`lib/pipeline/types.ts:103`), and each
  reader casts its key: the retrieval outcome behind a shape check
  (`generation-context.ts`), the close's range and ledger
  (`chapter-close-metadata.ts`, `chapter-close-report.ts`) and the pass's
  pre-run status. Each key's type is convention, and Slice 5.5a adds the
  close's ledger writer. The close's metadata and report phases also repeat
  one missing-range read and its failure, which a typed accessor would hold.
  Surfaced by Slice 5.2's review.
- **Test and E2E helpers repeat with no shared home.** `scalar` is defined
  in both `e2e/tests/dataset-chapter.build.spec.ts` and
  `e2e/tests/first-chapter.spec.ts`, where `e2e/harness/db.ts` could hold
  it. The dataset spec's `runsAfter`, `classifierStatus` and `systemEntry`
  mirror `classifier-real-provider.smoke.spec.ts`'s but differ (one story
  or all, an idle fallback on null, the latest row or any), so sharing them
  needs those choices made. A whole `StoreChapter` factory is written out in
  `chapter-breaks.test.ts`, `reader-chapter-chips.test.tsx`,
  `reader-chapter-chips.stories.tsx`, `use-rail-data.test.tsx` and
  `chapter-close-metadata-call.test.ts`, and the phase tests' `drain`
  generator helper repeats across the close's and older pipeline tests
  (`lib/pipeline/definitions/__tests__/phase-db.ts` is a candidate home).
  Surfaced by Slice 5.2's review.
- **A fresh dev slot has no local embedder model.** Every seeded story
  (`pnpm db:seed`, `db:seed:long`, `db:seed:dataset`) declares the local
  embedder `Xenova/all-MiniLM-L6-v2`. The app counts a model installed
  only when `<userData>/embedders/<id>/` holds it, and loads it with
  `local_files_only` (`electron/embedder/service.ts`,
  [Embedder in E2E](../testing.md#embedder-in-e2e)). Nothing under
  `scripts/`, neither the dev-slot setup nor the seed, puts it into a
  slot's userData. Only the E2E harness provisions it, for its own runs:
  `ensureEmbedderModel` (`e2e/harness/embedder.ts`) fills
  `~/.cache/aventuras-e2e/embedders`, and each spec that needs it copies
  it into its run's userData. So in a fresh worker slot
  (`~/.config/aventuras-dev-slotN`) or on a new machine, a seeded story
  can't embed and a turn fails before its narrative call, until someone
  downloads the model in the app or copies it in by hand. PR #709's
  desktop smoke copied it from that cache into slot 2's
  `userData/embedders`;
  [Measuring on a release build](../dev-environment.md#measuring-on-a-release-build)
  documents the hand copy for the Android measure only. One candidate,
  undecided: seeding a slot (no explicit path) installs the default
  catalog model from that cache, or the worktree setup does.
- **The E2E embedder cache is shared across checkouts on any catalog
  revision.** `ensureEmbedderModel` (`e2e/harness/embedder.ts`) deletes
  and rebuilds `~/.cache/aventuras-e2e/embedders/<model>` when its
  marker is missing or names another revision. Two suites that start
  together on a cold cache, or on branches with different catalog
  revisions (two worktrees, say), rebuild it under each other, and one
  can copy a half-written model into a run. `globalSetup` closed the
  same race between one run's workers; across runs it stays.
  Candidates: a directory per revision, with a download into a temp
  directory renamed into place, or a lock file around the rebuild.
  Surfaced by the review of the parallel E2E change, and by CodeRabbit
  on its PR.
- **`scripts/e2e.ts` doesn't pass a SIGTERM on.** A `timeout`, or a
  stopped job that signals the wrapper alone, leaves Playwright running
  the rest of the suite unparented. Forwarding SIGTERM made the runner
  exit at once and leave its workers to wind down for about 50 s;
  translating it to SIGINT, Playwright's graceful stop, didn't print the
  interrupted summary either, and the `tsx` and `pnpm` relay in between
  wasn't traced. With parallel workers an orphaned run now finishes in
  under 2 minutes. Surfaced by the same review.
- **A client-side SDK error is retried as a provider failure.**
  `classifyProviderError` (`lib/ai/transport/classify-provider-error.ts`)
  reads anything that isn't an `APICallError` as a retryable `unknown`,
  so an `InvalidPromptError` (a malformed `messages` array, thrown before
  any request) or a `TypeValidationError` backs off, throws again and
  fails as `provider`. A close's tool step is the first call built from
  caller messages, so a task-runner bug there reads as "LLM call failed".
  Surfaced by Slice 5.4's final review.
- **The mock panel's failure menu can't show `stream-cut` on a
  structured or tool lane.** `FAILURES.structured`
  (`scripts/mock-llm/ui/index.html`) leaves it out, so a lane armed
  with it through the API shows the menu as none beside a `stream-cut`
  badge. On a tool lane it acts as `malformed`. Surfaced by Slice 5.4's
  review.
- **The dev mock doesn't re-check stored lane values on load.**
  `scripts/mock-llm/state.ts` reads `value` as `unknown`, so a
  hand-edited `state.json` reaches the reply builders unvalidated: a
  tool lane's answers 500, other kinds may go out as stored. Surfaced by
  Slice 5.4's review. On a tool lane the 500 hides the bad step: the
  app retries a 500, the sequence cursor already moved past the step,
  so the retry is served the next one, and the failed request leaves no
  log line (`scripts/mock-llm/completions.ts`, the tool branch). Found
  by Slice 5.4's slice review with a probe through `callWithRetry`.
- **Canon routes no remedy for an `interrupted` or `content-filter`
  cut-off.** `generation-pipeline.md`'s `reply-cut-off` remedy paragraph
  names `window`, `max-output` and `unknown`; the code gives the other
  two causes no profile fix (`components/reader/cut-off-copy.ts`) and
  canon doesn't say so. The narrative failed with them before Slice 5.4;
  a close's tool step can now carry `content-filter` too.
- **Canon's `callWithRetry` signature omits `carried`.** The block in
  `generation-pipeline.md → Two retry tiers` lacks the
  `carried?: () => CarriedCapabilities` option
  (`lib/ai/transport/call-with-retry.ts`).
- **A cut-off's `maxOutput` isn't always what the request sent.**
  `replyCutOff` gets the max output the caller set: the profile's on a
  structured call (`lib/ai/generate.ts`), the profile's or 8,000 on a
  tool step (`lib/ai/tool-step.ts`). The Anthropic adapter changes it
  on the way out: it adds the thinking budget, and clamps to a known
  model's cap (`claude-3-haiku`, 4,096). So a window cut with thinking
  on reads `max-output`, and a cap cut under an 8,000 default reads
  `unknown`, against a figure the request didn't carry. Slice 5.4's
  slice review reads the sent `max_tokens` back for the tool step;
  `generateStructured` still passes the profile's.
- **The `toolCalling` hint may miss some servers' wording.** Canon's
  keywords are `tools` and `tool_choice`
  ([`generation-pipeline.md → Fatal error categories`](../generation-pipeline.md#fatal-error-categories)).
  vLLM's refusal of the step's `tool_choice: 'auto'` is recalled as
  `"auto" tool choice requires --enable-auto-tool-choice`, and
  OpenRouter's as `No endpoints found that support tool use`; neither
  holds a keyword. Both texts are from memory, not a live server. Check
  them, and widen `CapabilityHint`'s `matched` if they hold. Surfaced by
  Slice 5.4's slice review.
- **The dev mock can't forget a tool lane.** A saved `tools:` lane lists
  under Tools across restarts, so a task whose tools were renamed
  leaves its old lane there for good; only Reset or a hand edit of
  `state.json` clears it. A control call naming an unknown key creates
  the lane before its route matches (`scripts/mock-llm/control.ts`, the
  `lanes` branch), so even a 404 on a mistyped `tools:` key leaves one
  listed. Surfaced by Slice 5.4's slice review.
- **Duplication the tool step's simplifier pass left for a shared
  home.** The expiry detail `` `${target}: timeout after ${boundMs}ms` ``
  is written in `lib/ai/tool-step.ts` and `lib/pipeline/call-error.ts`,
  and `lib/ai` can't import `lib/pipeline`; tests pin both strings. The
  `lib/ai` tests repeat their fixtures: `okStep` in `tool-step.test.ts`,
  `stub/stub-provider.test.ts` and `scripts/mock-llm/harness-tool-steps.test.ts`,
  and `useProvider`, `MODELS` and `rejection` across `tool-step.test.ts`,
  `window-check.test.ts` and `request-shape.test.ts`. The older
  `narrativeValueSchema` in `scripts/mock-llm/validate.ts` is exported
  with no importer. Surfaced by Slice 5.4's slice review.
- **A second CTRL-Z after a close whose reversal failed leaves its marker
  open.** It undoes the close's delta rows and chapter row but leaves the
  close's `pipeline_runs` marker with `finished_at` null. How boot
  recovery (`recoverInFlightRuns`, `lib/pipeline/runtime/recovery.ts`)
  treats an `action_id` a user undo already reversed is unverified. Surfaced by Slice 5.6's review.
- **`undoLastAction` reads the branch's whole delta log, twice per
  CTRL-Z.** `lib/actions/story-entries/undo.ts` reads it with no LIMIT
  under the gate, and only the head group is needed. The cost is
  unmeasured. Surfaced by Slice 5.6's review.
- **A manual pick a reversal stamps into a chapter survives the
  prose-reversal bracket's existence check.** Redo of an undone close
  does it; the next Send then fails once at `boundary` (stale pick)
  before the pick drops. The fix would add `isNull(storyEntries.chapterId)`
  to the check's read, which goes past canon's "a reversal that removes
  that entry" and needs the developer's call. It shares a root with
  [the deferral toast entry in parked.md](../parked.md#the-deferral-toast-can-promise-a-close-that-never-runs).
  Surfaced by Slice 5.6's review.
- **A late Cancel announces nothing.** One that lands after a run's last
  phase commits the run and chains nothing through `commitRun`, which
  records no deferral and emits no `run_deferred`, so a cancelled chain
  gets no "moved to your next turn" toast, though the close still runs at
  the next Send (owed by its pick or the threshold). A turn's late Cancel
  is the same today. Surfaced by Slice 5.6's review.
- **A before-turn close shows one flat label.** The banner keeps its
  before-your-turn label for the whole run (C6, `principles.md`, the
  slice's label table), which hides `N of M` exactly when the user waits longest,
  7 to 17 agent tasks. Needs a developer question before 5.8 and 5.9
  consume C6. Surfaced by Slice 5.6's review.
- **The memory banner's live region may announce too often.** Its label
  sits in a `role="status"` `aria-live="polite"` region and now changes up
  to about 21 times per close run; canon's a11y notes don't say whether
  that announcement rate is wanted. Surfaced by Slice 5.6's review.
- **A retry-blocked toast prints a raw refusal code.** `reader.json`'s
  `passRetryBlocked` and `closeRetryBlocked` interpolate the run's
  `blockedBy` (`story-busy`, for one) into user-facing copy.
  `passRetryBlocked` was already there; `closeRetryBlocked` is this
  slice's own copy, repeating its pattern. Surfaced by Slice 5.6's
  review.
- **Send can start a turn on a branch that turns held after its check.**
  `submitTurn` reads `owedWorkAtSend` (held first) and, with nothing
  owed, goes straight to the turn. A live pass reads as not held and
  blocks the turn's start through per-turn's `blockedBy`, but a pass that
  ends held (its cancel reversal failed) between that read and the turn's
  start lets the turn run over its unreversed writes. Owed work re-checks
  the hold right before it starts; the no-owed path never did (same flow
  before Slice 5.6). The reader blocks Send while a hard-gate run is live,
  so only a caller past the UI reaches it. Surfaced by CodeRabbit on
  Slice 5.6's PR.
- **The pass-failure Retry path is looser than its close twin.**
  `PassRefusal` (`components/reader/send-run.ts:104`) types its non-held
  `error` as `PipelineError | undefined`, though a failed `TxResult`
  always carries one; the close's twin, `closeRefusalOf` (`:117`), now
  requires it. `retryPassEntry`'s docblock
  (`components/reader/system-entry-actions.tsx:302-307`) omits the
  non-held refusal, which toasts and leaves the entry (`:328`). Both
  predate Slice 5.6, and
  [code-conventions → Type design](../code-conventions.md#type-design)
  files older looseness as a deferral. Surfaced by Slice 5.6's slice
  review.
