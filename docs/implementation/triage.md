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

- **The story card's `⋯` is a Popover on every tier.**
  [`story-list.md → Mobile expression`](../ui/screens/story-list/story-list.md#mobile-expression)
  binds it to a short Sheet on phone, and
  `components/story/story-card.tsx:189-238` renders a Popover
  everywhere. It predates M6: found by M6's planning research
  (2026-11-22), since `⋯` is Duplicate's entry point, and left out of
  Slice 6.6. Read at the component, not run on a phone tier.

- **`probe_captures`' ER note says it is the only table not copied on
  fork.** `docs/data-model.md:255` calls it "the only such table", but
  the Branch-copy manifest skips `pipeline_runs` too (both copies), so
  the note has been stale since that row landed. Found by M6.1's final
  review (2026-11-22); pre-existing canon, outside that slice's scope.

- **The rollback's create-delta lookup still hedges on `entry_id`.**
  `lib/actions/story-entries/operational.ts:255-256` says the lookup by
  `target_id` works "whether or not foreground deltas stamp entry_id".
  M6.1's anchor settled that: the `user_action` create is stamped with
  its entry (`lib/actions/turns/submit-turn.ts:180`), so the hedge reads
  as an open question it no longer is. Found by M6.1's final review
  (2026-11-22).

- **The vec0 shadow-table list is incomplete.**
  `lib/db/embeddings/vec-tables.ts:16-18` names four shadow tables;
  sqlite-vec 0.1.9 with metadata and auxiliary columns also creates
  `_auxiliary`, `_metadatachunks00/01` and `_metadatatext00/01`
  (checked on a scratch `vec0` table with the families' column shape).
  The exact-name regex still holds, so only the comment misleads. Its
  stated reason is off too: the shadow tables reject DML only under
  SQLite's defensive flag (`node:sqlite`'s default), and
  `_vector_chunks00` accepts a `DELETE` even then;
  `lib/actions/stories/delete-story.test.ts:354`'s test name repeats it.
  Found by M6.1's final review and its slice review (2026-11-22).

- **Two close-agent test comments cite "(5.9)" as future work.**
  `lib/pipeline/definitions/close-agent/lore-tools.test.ts:295` and
  `lib/pipeline/definitions/close-agent/write-path.test.ts:1067` say "as
  read_turns will show one (5.9)". Slice 5.9 has shipped (`read_turns`
  is in `close-agent/read-turns.ts`, merged in #735), so the pointer is
  stale per `.claude/rules/code.md`'s commenting discipline. Found by
  M6.1's final review (2026-11-22).

- **Two vec0 comments say a `pk IN` read answers no rows.**
  `lib/db/embeddings/knn.ts:63-65` and `lib/db/embeddings/ops.ts:75-76`
  say vec0 answers `pk IN (…)` with zero rows, and
  [Slice 6.1](milestones/06-branches-diff-cache/slices/01-copy-substrate.md)
  repeats it in its Scope. On sqlite-vec 0.1.9 under `node:sqlite`,
  desktop's version, every `pk` predicate answers correctly: `=`, `IN`,
  `IN (SELECT …)`, `LIKE`, and a `DELETE … pk IN`. Android's
  v0.1.7-alpha.2 is unchecked. The code reads by `branch_id` and `id`
  either way, so only the comments' stated reason may be stale. Found by
  M6.1's slice review (2026-11-22).

- **A desktop crash mid-migration can leave the database unable to
  boot.** Desktop's runner applies a migration's statements one by one
  with no wrapping transaction (`electron/db/service.ts:97-100`).
  Killed partway through a table rebuild (`0003`, `0009`, `0016` and
  `0021` rebuild), the next boot re-runs the step from its start and
  fails: after the `CREATE` or the `DROP`, on "table `__new_deltas`
  already exists"; after `0021`'s closing `ALTER`, before drizzle records
  the step, on "duplicate column name: branch_id". Android runs every
  pending migration in one transaction and rolls back. The relaunch that
  could cause such a kill is parked as
  [A relaunch kills a primary whose main thread stalls](../parked.md#a-relaunch-kills-a-primary-whose-main-thread-stalls);
  this is what the kill leaves behind. Found by M6.1's slice review
  (2026-11-22), probed on `node:sqlite`.

- **Test plumbing the M6.1 simplifier left duplicated.** Three test
  files hand-roll `BEGIN` / `COMMIT` / `ROLLBACK` on a raw
  `DatabaseSync`: `lib/db/branch-copy/vec-copy.test.ts:92`
  (`runInTransaction`, "As createTestDb's"),
  `lib/db/__tests__/migrate-m6-deltas-key.test.ts:38`
  (`migrateLikeAndroid`, which models expo's runner and may need to stay
  apart) and `lib/db/__tests__/two-branch.ts:91` (`cloneBranch`). A
  shared helper would live in `lib/db/__tests__/test-db.ts`, outside that
  slice. Separately, `lib/actions/story-entries/scene-fields.test.ts:248`
  and `:315` spell out the call its `removeCast` helper makes (`:216`).
  No defect either way. Found by M6.1's slice review (2026-11-22).
