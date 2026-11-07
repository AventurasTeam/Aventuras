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
- **The embedder drain drops a run's idle note while a pass runs.**
  `noteIdle` (`lib/embedder/drain.ts:198-204`) does nothing mid-pass, and
  the pass's row list predates the run's writes, so a row made stale by a
  run inside one batch stays stale until the next `run_complete` or turn.
  Retrieval stays correct (the drain is warm-cache only); quiescence can
  be put off. `kick` already records a pending re-run.
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
- **The gated field wiring exists in three copies.** The `Controller`
  plus `FormRow` plus input with the run gate (`editable={!blocked}`
  and a hint, or `disabled` and a reason) is written in World's
  `components/world/detail/fields.tsx`, Plot's inline Controllers, and
  `ChapterCard`; they differ only in the issue-text function. A gated
  field in `components/compounds/` that takes it would remove the
  copies. Surfaced by Slice 5.7's card review.
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
