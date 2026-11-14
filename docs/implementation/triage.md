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
- **Keyword lists have no count or term-length bound.**
  `appendEntityKeywords`, and now the close's `set_keywords` and
  `create_lore`, land whatever terms the model sends, while chapter
  metadata caps its keywords (`CHAPTER_KEYWORDS_MAX`). Each term feeds
  keyword injection on later turns. Raised in 5.8's reviews.
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
- **The reader's in-place prose edit has no leave guard.**
  `components/reader/reader-surface.tsx:~330` (`editingId`, `editDraft`):
  any navigation that pops the reader drops the draft, including the
  reader's own Return, and a review-row press from the reader adds one
  more path. [`save-sessions.md → Where applied`](../ui/patterns/save-sessions.md#where-applied)
  doesn't classify it. Raised in 5.11's review.
