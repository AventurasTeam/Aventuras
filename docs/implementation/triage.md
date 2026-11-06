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
  (`lib/actions/classifier/run-now.ts:11`) and `'embedder-swap'`
  (`lib/actions/turns/submit-turn.ts:38`) restate
  `MANUAL_CLOSE_REFUSAL.branchNotOpen` and `.swapPending`
  (`lib/actions/chapters/start-manual-close.ts`).
- **Pre-flight reads the open story's settings after two awaits.**
  `lib/pipeline/runtime/orchestrator.ts:537-540` reads
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
- **The dataset chapter's seed export has no home.** The developer
  approved checking in a seed export of Slice 5.2's dataset chapter,
  enriched as later slices add their part: "Yeah keep the database and i
  guess incrementally enrich the seed as slices come in and add in their
  part. Just so we keep the data as a shared baseline and checked in."
  [5.2's Implementation notes](./milestones/05-chapters-chapter-close/slices/02-first-chapter.md#implementation-notes)
  call checking it in later work, and no slice, followup or roadmap item
  carries it. Surfaced by Slice 5.2's review.
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
  is `Record<string, unknown>` (`lib/pipeline/types.ts:101`), and each
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
