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

- **The chapters update keeps unchanged columns in its undo payload.**
  Unlike lore (`lib/actions/lore/register.ts:125-130`), which drops
  them because History reads an undo payload's keys as the fields that
  changed (`lib/actions/chapters/register.ts`, the update handler).
  Matters once a chapter edit shows in History. Surfaced by Slice 5.2's
  review.
- **A bundled template's group is declared twice, unchecked.**
  `lib/prompts/bundled/index.ts` sets each template's `group` (read by
  the include validator) and `TEMPLATE_GROUPS` declares it again, and no
  test compares the two. Only some one-sided changes fail a test, by
  another route: `lib/prompts/templateContextMap.test.ts` pins
  `TEMPLATE_GROUPS` for `chapterMetadata` to `'chapter'`,
  `bundled-pack.test.ts` counts 13 templates whose `index.ts` group is
  `wizard`, and the include validator refuses a group the template's
  macros don't fit.
- **Refusal codes repeated as literals.** `'branch-not-open'`
  (`lib/actions/classifier/run-now.ts:14`) and `'embedder-swap'`
  (`lib/actions/turns/submit-turn.ts:54`) restate
  `MANUAL_CLOSE_REFUSAL.branchNotOpen` and `.swapPending`
  (`lib/actions/chapters/close-chain.ts`).
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
  Surfaced by Slice 5.2's review. Slice 5.6 adds two more:
  `chapter-close-owed.spec.ts`'s `closeOutcomes` and `heldClose` copy
  `passOutcomes` and `heldPass` from `e2e/flows/classifier-pass.ts`, with
  only the kind and the agent name changed, so sharing them needs
  `passProbe` to take both; and the open region's SQL predicate is written
  out in four specs (`chapter-close-owed`, `chapter-progress`,
  `first-chapter`, `dataset-chapter.build`) beside the app's
  `openRegionWhere`. A drift there fails by timeout, not silently.
  Surfaced by Slice 5.6's slice review. More than a dozen test files
  spell out a `RunState` for `startRun` by hand, with no shared fixture,
  so a `RunState` change edits all of them. Surfaced by Slice 5.7's
  save-path review.
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
- **The gated field wiring exists in three copies.** The `Controller`
  plus `FormRow` plus input with the run gate (`editable={!blocked}`
  and a hint, or `disabled` and a reason) is written in World's
  `components/world/detail/fields.tsx`, Plot's inline Controllers, and
  `ChapterCard`; they differ only in the issue-text function. A gated
  field in `components/compounds/` that takes it would remove the
  copies. Surfaced by Slice 5.7's card review.
- **A disabled button's reason under it on native is hand-written three
  times.** `ReasonTooltip` does nothing on native, so `ChapterCard`'s
  action row, `ChapterInProgressCard`'s `Close chapter…` and the reader
  popover's `OverlayAction` each wrap the `Button` in a `View` and render
  the reason as muted `xs` text when `Platform.OS !== 'web'`, with
  different alignment and disabled conditions. A button that needs its
  reason on native shows none unless its author copies the block. A
  shared compound, or a `Button` option, would end the copies; the
  latter changes native layout for every `disabledReason` caller, so it
  wants a design call. Surfaced by Slice 5.7's slice review.
- **C15 and Slice 5.3 say time ranges exclude 0; the read keeps it.**
  [Milestone 5 → C15](milestones/05-chapters-chapter-close/milestone.md#c15--entry-jump-and-chapter-time-ranges)
  gives each chapter's `min` and `max` world time "excluding 0", and
  [Slice 5.3 → Scope: in](milestones/05-chapters-chapter-close/slices/03-reader-chapters.md#scope-in)
  says the same, as does its acceptance criterion 12.
  `readChapterTimeRanges` (`lib/db/story-entries/chapter-time-ranges.ts:27-28`)
  excludes `kind = 'system'` and a null world time only, and its test
  pins 0 on purpose (`chapter-time-ranges.test.ts`, "starts a range
  at the opening, at 0"): the 2026-11-04 triage pass (PR #704) took a
  world time of 0 as the origin, not a flashback. The docs are the side
  to fix. Surfaced by Slice 5.7's card-data task.
- **`observability.md` credits `row_save_validate_failed` to a check
  that isn't there.** The bullet names "the lore session's first-edit
  whole-draft check"; `use-lore-row-session.ts` runs no `trigger()`,
  and the substrate's values-subscription catch, which does log it, is
  unnamed. Surfaced by Slice 5.7's session-hook review.
- **`saveBarDiscard` matches the unsaved dialog's Discard too.** It
  queries the page for a button named `Discard`
  (`e2e/locators/save-session.ts`), and the dialog's
  `unsavedChanges.discard` reads the same as the bar's
  `saveBar.discard` (`locales/en/common.json`). The save bar stays in
  the accessibility tree while the dialog is open, as the file notes at
  `unsavedDiscard`, so the query would resolve both and hit a
  strict-mode error; `exact: true` can't tell two buttons of one name
  apart. It needs scoping outside the dialog, to the bar's `save-bar`
  testID say. No current caller uses it with the dialog open. Surfaced
  by Slice 5.7's E2E review.
- **`EMPTY_LORE_DRAFT`'s freeze is shallow.** `lib/world/lore-draft.ts`
  types it `Readonly<LoreDraft>`, which leaves `keywords` and `tags`
  mutable `string[]` in the type, and `Object.freeze` leaves them
  mutable at runtime too, so nothing stops a write into the arrays every
  spread of the constant shares. `loreDraftFrom` copies in new lists by
  convention. The chapter twin, `EMPTY_CHAPTER_DRAFT`, is tightened in
  Slice 5.7's review; lore's is older code, which
  [`code-conventions.md → Type design`](../code-conventions.md#type-design)
  files as a deferral. Surfaced by Slice 5.7's slice review.
- **`commitRowSave`'s `idPrefix` is required even for an update.**
  `CommitRowSaveArgs` (`lib/actions/row-save/commit-row-save.ts`) pairs
  `rowId: string | null` with a required `idPrefix: string`, read only
  when `rowId` is null, to generate a create's id. `saveChapter`, its
  first update-only caller, passes a dead `idPrefix: 'chap'`. Tighter:
  `{ rowId: string }` or `{ rowId: null; idPrefix }`, the prefix typed
  from the closed set in `lib/ids/prefixes.ts` (`SubstitutablePrefix`).
  Older API; the slice adds a caller. Surfaced by Slice 5.7's slice
  review.
- **A Save whose only change is whitespace leaves the untrimmed draft
  as the clean form.** The chapter and lore drafts compare trimmed
  values (`chapterPatch` in `lib/chapters/chapter-draft.ts`, `lorePatch`
  in `lib/world/lore-draft.ts`), so a padding-only edit builds no
  action, and `commitRowSave` returns ok without writing. The Timeline
  then toasts the save, and `rebase` in `hooks/use-row-save-session.ts`
  takes the sent draft as the clean baseline: the field keeps the
  padding, and Discard restores it, while the store and the card head
  hold the trimmed value, until the next store patch or reopening.
  Nothing stored changes. The fix is a substrate contract change, a
  no-write `ok` reaching `rebase` so it rebases onto the stored values,
  and it spans every row kind (Plot's thread and happening drafts trim
  too). The Timeline is a new route to lore's existing behaviour.
  Surfaced by Slice 5.7's slice review.
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
