# Slice 6.1 — Copy substrate

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** none. Only recovery scoping and the read of a
  branch's unfinished runs wait on R1's canon pass
  ([C12](../milestone.md#c12--canon-and-flips)). The `pipeline_runs`
  column, its backfill, its writer, its `BRANCH_SCOPED` entry and its
  manifest row are schema work, generated with the `deltas` rebuild, and
  start at once with everything else.
- **Blocks:** [Slice 6.3](./03-fork-core.md)'s landing (its delta-log
  ops, its copy and its harness) and [Slice 6.6](./06-delete-duplicate.md)
  (the copier, the manifest and the run-record read). No edge with
  [Slice 6.7](./07-diff-cache.md): the second of the two to land writes
  the walk's database-seeded two-branch test (C9). No edge with
  [Slice 6.8](./08-per-branch-lead.md): the second of the two to land
  regenerates its migrations (C4).

## Goal

One id can name a row, a delta and a journal on two branches without any
write or boot recovery crossing between them, and a branch's rows can be
copied into another branch by one batch. This slice delivers the
composite `deltas` key, the six delta writes scoped by branch, restores
that stamp the branch they write, run markers that record their branch,
the read fork and duplicate refuse on, and the manifest and copier that
[Slice 6.3](./03-fork-core.md)'s fork and
[Slice 6.6](./06-delete-duplicate.md)'s duplicate are built on. Nothing
here copies a branch for a user.

## Background

Canon keys every branch-scoped table on `(branch_id, id)` and copies
rows verbatim, serialized JSON included, so after a copy every id repeats
across branches. `deltas` is the one branch-scoped table the schema still
keys on `id` alone, six delta writes select by that id, and boot
recovery reads a run's group by `action_id` alone because
`pipeline_runs` records no branch. A delete's payload and a journal name
the branch that wrote them, so a restore has to stamp the branch it
writes, never the one its JSON names. Each of these hazards needs a copy
to exist, so they close here, before the copier this slice builds can
make one; the journal write-back already re-stamps
(`lib/actions/delta/rerun-journal.ts:268-276`), and the embedder swap
already self-inserts into a vec0 table, within one partition
(`lib/embedder-swap/engine.ts:378-382`).

## Required reading

- [`data-model.md → Branch model`](../../../../data-model.md#branch-model):
  the manifest table, the "Primary keys on all branch-scoped tables"
  paragraph and "Deleting a branch"
- [`data-model.md → Story duplicate`](../../../../data-model.md#story-duplicate)
  and [`Story deletion`](../../../../data-model.md#story-deletion)
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor),
  for the `user_action` anchor
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  the paragraph "Restored rows always stamp the executing branch's
  `branch_id`"
- [`generation-pipeline.md → Crash recovery via pipeline_runs marker table`](../../../../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table),
  [`Startup recovery pass`](../../../../generation-pipeline.md#startup-recovery-pass),
  [`Recovery-failure policy`](../../../../generation-pipeline.md#recovery-failure-policy)
  and the `actionId` bullet of
  [`Invariants`](../../../../generation-pipeline.md#invariants), as R1's
  canon pass leaves them
- [`probe.md → Branch fork and capture portability`](../../../../memory/probe.md#branch-fork-and-capture-portability)
- [`retrieval.md → Storage`](../../../../memory/retrieval.md#storage):
  the vec0 layout the vector copy builds on, its
  `<branch_id>:<id>:<model_id>` key, `branch_id` as the partition key,
  pre-widen keys and a model swap's rows side by side
- [`code-conventions.md → Module structure`](../../../../code-conventions.md#module-structure)
- [`testing.md → Test taxonomy`](../../../../testing.md#test-taxonomy) and
  [`Coverage`](../../../../testing.md#coverage-thorough-not-exhaustive)
- [`dev-environment.md → What a slot owns`](../../../../dev-environment.md#what-a-slot-owns),
  for the slot's Android AVD
- [`milestone.md → C1`](../milestone.md#c1--delta-rows-on-two-branches),
  [`C2`](../milestone.md#c2--run-records-and-the-copy-refusal) and
  [`C3`](../milestone.md#c3--the-manifest-and-the-copier), which this
  slice provides;
  [`C4`](../milestone.md#c4--migrations),
  [`C11`](../milestone.md#c11--shared-files) and
  [`C12`](../milestone.md#c12--canon-and-flips), which it follows;
  [`C9`](../milestone.md#c9--the-diff-caches-seams) and
  [`C10`](../milestone.md#c10--the-leads-surface) where they meet it; and
  the [Definition of done](../milestone.md#definition-of-done)'s "Same
  ids, two branches" and the vector line of "Fork"
- The milestone's [Open questions](../milestone.md#open-questions),
  "Unaudited", for the contract wording this slice builds on that no
  audit rechecked
- Lessons:
  [Drizzle drops keys the table has no column for](../../../lessons-learned/drizzle-drops-unknown-keys.md),
  [A JSON value that crosses a scalar subquery needs `json()`](../../../lessons-learned/sqlite-json-subtype-lost-across-subquery.md)
  for its table of the three SQLite versions, and
  [Staleness flags are cleared by the drain](../../../lessons-learned/staleness-flags-are-cleared-by-the-drain.md)

## Scope: in

**Homes, proposed.** The manifest and the copier in a new
`lib/db/branch-copy/`, exported through `@/lib/db` beside
`deleteBranchVecOps`: they build ops from the schema and touch no store,
and both 6.3 (`lib/actions`) and 6.6 (`lib/actions/stories`) can import
`lib/db`. The unfinished-run read in `lib/actions/delta/`, beside
`rerun-journal.ts`, exported through the `lib/actions` barrel. The plan
may move either.

**Order, and what R1 gates.** The first change is ungated and lands
alone: the `deltas` key and the `pipeline_runs` column, generated in one
drizzle-kit run, the hand-written backfill after them, the marker's
writer, the six writes and the read-back, the `BRANCH_SCOPED` entry,
the two-branch fixture and the tests that pin them. The `BRANCH_SCOPED`
entry can't wait: the pin at
`lib/actions/stories/delete-story.test.ts:262-272` goes red the moment
the column exists. The marker's writer rides with the column, since it
is the column's only writer and changes no read. Only recovery scoping
(`recovery.ts`'s branch and `reverseRunGroup`'s group read) and the
exported read of a branch's unfinished runs wait on R1's canon pass
(C12). The restore stamp, the manifest, the copier, the captures test
and the anchor wait for nothing and follow in any order. Whichever of
the column and the manifest comes second adds the manifest's
`pipeline_runs` row, since the manifest's structural test then demands
it.

**First tasks.** Each settles a fact the rest builds on.

- **The vector copy on device.** Before the copier's vector ops, a
  check on `app/dev/db-check.tsx` (no `t()`, as that route's precedent):
  it creates a scratch vec0 table of dimension 4 and a scratch source
  table through `execRaw`, named so `isVecFamilyTable`
  (`lib/db/embeddings/vec-tables.ts:16-23`) never matches them and no
  swap or delete reaches them; writes three vectors on one partition, one
  of them for a source row the target partition won't hold; runs the
  copier's own vector statement, built for the scratch tables, into a
  second partition in one `runInTransaction`; and reports the copied
  rows' `pk`, `model_id`, `id`, `source_hash` and embedding bytes, the
  vector with no source row left out, the source partition unchanged,
  and a KNN on the new partition finding the copies. Then it drops both
  tables. Run it in the desktop dev app (Electron: SQLite 3.51.2,
  sqlite-vec 0.1.9) and in the Android dev client on the slot's AVD
  (expo-sqlite: SQLite 3.50.3, sqlite-vec `v0.1.7-alpha.2`); the same
  statement passed on the Node test stack (3.54.1, 0.1.9) while this
  milestone was planned. Each platform's result, with its
  `vec_version()`, goes in Implementation notes. If either fails, the
  vector ops take C3's fallback: a temp table filled from the source
  partition and emptied into the new one inside the same batch. A
  pre-read in JS is ruled out, since a duplicate takes no lock and reads
  one snapshot, which a read before the batch would break. The Android
  run is a device check: it doesn't hold up the other tasks, but the
  milestone's Definition of done wants its result in this slice's
  notes, so the slice doesn't finish without it.
- **A temp table inside a batch.** The same route runs, whatever the
  vector check finds, one `runInTransaction` batch that creates a plain
  temp table, fills it with an `INSERT … SELECT`, empties it into a
  scratch table with another and drops it, then reports the scratch
  table's rows. vec0's own DDL is routed around the batch
  (`lib/db/runtime/exec.ts:3-5`), and nothing yet shows whether ordinary
  DDL runs inside desktop's single-IPC `transaction` or inside
  Android's `withTransactionSync`. Two later routes rest on the answer:
  this slice's vector fallback, and [Slice 6.3](./03-fork-core.md)'s
  survivor exclusion if its plan picks a temp table. Run it on both
  platforms, as the vector check is, with the result in Implementation
  notes.
- **What drizzle-kit generates.** Generate, then read the SQL before
  building on it. The `deltas` change should come as a `__new_deltas`
  rebuild in `0016`'s shape that copies every column and recreates
  `deltas_chain_idx` and `deltas_log_position_uniq` after the rename.
  The `pipeline_runs` column may come as `ADD … REFERENCES` or as a
  rebuild of its own. Drizzle-kit diffs against the newest snapshot in
  `meta/`, `0020_snapshot.json` today, or 6.8's if it lands first; the
  `0013`, `0014` and `0017` snapshots are absent.

**The composite key and the run column (C1, C2, C4).** Ungated, with
the six writes below.

- `deltas` keys on `primaryKey({ columns: [t.branchId, t.id] })` in
  `lib/db/system/system.table.ts:56-92`; `id` loses `.primaryKey()`, and
  both indexes stay.
- `pipeline_runs` gains `branchId: text('branch_id').references(() => branches.id)`,
  nullable (`:44-54`). The orchestrator writes `branchId: run.branchId`
  with the marker (`lib/pipeline/runtime/orchestrator.ts:171`).
- `BRANCH_SCOPED` gains `pipelineRuns`
  (`lib/actions/stories/delete-story.ts:34-50`), which the pin at
  `delete-story.test.ts:262-272` demands as soon as the column exists.
  Its loop runs before the `branches` delete, so the new key holds
  through a story delete, and the story-wide delete at `:76` stays for
  null-branch rows.
- One drizzle-kit run generates both, and a hand-written step follows
  it, as `0013` is hand-written. Both join `lib/db/migrations/migrations.js`.
  Neither number is pinned: whichever of this slice and
  [Slice 6.8](./08-per-branch-lead.md) lands second regenerates its
  generated step from main's snapshot, renumbers its hand-written step
  and adds its bundle entries (C4).
- The backfill touches unfinished rows only, since `action_id` has no
  index to backfill every finished row by. A run's branch comes from any
  of its deltas, else from its journal, else, for a re-run's marker,
  from the chapter its `rerun_chapter_id` names. No copy exists yet, so
  each match is exact. A row with none of the three stays null:

  ```sql
  UPDATE pipeline_runs SET branch_id = COALESCE(
    (SELECT branch_id FROM deltas WHERE deltas.action_id = pipeline_runs.action_id LIMIT 1),
    (SELECT branch_id FROM reversal_journals WHERE reversal_journals.action_id = pipeline_runs.action_id LIMIT 1),
    (SELECT branch_id FROM chapters WHERE chapters.id = pipeline_runs.rerun_chapter_id LIMIT 1))
  WHERE finished_at IS NULL;
  ```

  The third source closes a leftover the first two miss: a re-run
  marker with a chapter and nothing else. Kept null, its recovery would
  read the chapter by id alone (`rerun-journal.ts:419-429`), and once a
  copy held that chapter the read could take the copy's row and undo
  the sibling's close, with no refusal to stop the copy, since a
  null-branch row is in no branch's read. Only a re-run's marker sets
  `rerun_chapter_id`, so the third subquery reads nothing for any other
  run. The step reads no JSON, so C4's rule that a hand-written step
  guards its JSON reads has nothing to guard.

- Both runners stay safe without a special step. Desktop runs each
  statement with no wrapping transaction (`electron/db/service.ts:97-100`);
  Android's migrator wraps every pending migration in one
  `BEGIN … COMMIT`, where the generated `PRAGMA foreign_keys=OFF` does
  nothing. Nothing references `deltas` or `pipeline_runs` by a foreign
  key, so a rebuild's `DROP TABLE` can't violate one, and every existing
  row is unique on `id`, so it is unique on `(branch_id, id)`.

**The six writes and the read-back (C1).** Each scopes by branch and id
in the same change as the migration. In each, "the delta's branch" is
the line [Slice 6.3](./03-fork-core.md) later swaps for the plan's write
branch.

- The prune and the re-own in `reownOrPrune`
  (`lib/actions/delta/reverse-replay.ts:178-187`), by `r.branchId`.
- The held-payload rewrite in `settleHeldCopies` (`:363`), by
  `holder.branchId`.
- The survivor rewrite in `buildUndoOps` (`:816-819`), by
  `delta.branchId`.
- Redo's survivor restore (`lib/actions/delta/redo.ts:344-345`), whose
  `SurvivorPayload` holds only an id. Its branch comes from the group's
  snapshots, which each hold their delta. A group with survivors always
  has a snapshot, since `prepareUndo` keeps only the survivors on rows
  the snapshot restores (`redo.ts:103-108`). C6 later gives the group a
  branch of its own ([Slice 6.2](./02-scoped-reads-redo.md)).
- The journal write-back's upsert (`rerun-journal.ts:283-290`): its
  conflict target becomes `[deltas.branchId, deltas.id]`. SQLite rejects
  `ON CONFLICT(id)` once no unique constraint matches it, so with the
  migration alone every CTRL-Z of a re-run fails, on single-branch
  stories too. The two land in one commit.
- The read-back at `lib/actions/delta/apply-delta-action.ts:220-223`
  adds `eq(deltas.branchId, branchId)`. Its id is freshly minted and
  can't meet a copy, but by id alone it no longer uses the primary key,
  and it runs after every delta-logged write. C11 shares this file with
  [Slice 6.2](./02-scoped-reads-redo.md), whose redo clears sit at
  `:213` and `:390`, beside it; this slice edits only the read-back.

**Restores take their row target's branch (C1).**

- `emitInsert` (`reverse-replay.ts:551-565`) sets the row's branch
  column to `target.branchId`, the branch the plan writes (C1), on the
  row it inserts, before it builds the insert and the patch, so the
  store patch carries the branch too. The
  key is the table's branch key, found from its descriptor as
  `branchKeyOf` finds it (`rerun-journal.ts:223-229`); moving that helper
  to `registry.ts` for both callers is fine. A literal `branch_id` key
  would be dropped from the SQL without a word and the row would land on
  the payload's branch (the drizzle lesson above). This covers
  `undoDelete`'s target (`:631-632`; `deletedRow` already returns a fresh
  object, `lib/actions/delta/held-rows.ts:40-47`) and the tombstone
  re-insert (`:732-735`).
- `undoDelete` inserts its captured children itself (`:635-670`), so it
  stamps them the same way, on copies: `capturedChildren`
  (`lib/actions/delta/delete-cascade.ts:150-163`) returns the payload's
  own objects, which the set's deltas, a redo snapshot and a re-run
  journal (`rerun-journal.ts:51-61`) also hold. Only the embedded-source
  arm copies today (`:642-644`). The walk key at `:659` and the patch at
  `:666` take `target.branchId` where they read `delta.branchId` today.
- The liveness read at `:629` keeps `delta.branchId`: it is a read.
- No stamp, key or patch reads `delta.branchId` directly. A row
  target's branch is the branch the plan writes, and in this slice that
  is its delta's (`undoTargetOf`, `:495-497`). 6.3 makes it the write
  branch and gives the walk's read in `rowStateOf` (`:499-513`) the
  read side, so a tombstone re-insert then reads the parent's row and
  the stamp writes it onto the child. The key and patch change shows
  only once 6.3 separates the two branches, and 6.3's harness proves
  it. The stamps show now, because a copied payload names the branch it
  was copied from.

**Recovery scoping and the unfinished-run read (C2).** These tasks
start once R1's canon pass lands (C12).

- `recoverInFlightRuns` passes `orphan.branchId` where it passes `null`
  (`lib/pipeline/runtime/recovery.ts:73-75`).
- `reverseRunGroup`'s group read (`rerun-journal.ts:497-501`) scopes by
  the branch it is given, and by `action_id` alone when that is null. The
  journal read (`:183-189`) and the chapter read (`:419-429`) already
  do. The abort already passes its run's branch
  (`orchestrator.ts:485-487`), which the read now honours. A group read
  across two branches no longer reaches `selectReversalSet`'s plain
  throw on a stray branch (`lib/actions/delta/row-closure.ts:490-494`).
- The read: a branch's unfinished run rows, `finished_at IS NULL` and
  `branch_id` equal to it, each with its run id, kind, action id and
  `rerun_chapter_id`, which is what fork judges against its prune set
  (6.3) and what duplicate refuses on (6.6). A null-branch row is in no
  branch's read. Proposed name `readUnfinishedRuns(branchId, ctx)`; the
  name is this slice's call.

**The manifest (C3).** One typed map in code with a row for every table
that has a `branchId` column, sixteen once `pipeline_runs` has one, each
with its Fork and its Duplicate behavior as canon's manifest gives them:
`probe_captures` and `pipeline_runs` not copied in either mode;
`story_entries` copied without `system` rows at a fork and whole at a
duplicate; `deltas` and `reversal_journals` copied as survivors at a
fork and whole at a duplicate; every other table copied. The values'
names are the plan's. `*_vec` and `assets` have no row: vec0 tables are
not in `dbSchema`, and `assets` has no branch. The copier copies each
table its mode doesn't mark not copied; the filters a fork's values
name (no `system` entries, surviving deltas and journals) are met by
the predicates 6.3 passes, not by the copier. The copier reads the
manifest, never `BRANCH_SCOPED`, which holds `probe_captures`: a
copier built on that list would copy captures without ever naming the
table.

**The copier (C3).** It returns ops for a caller's batch and runs
nothing. Signatures are this slice's: 6.3 and 6.6 start their copy tasks
after it merges. One proposed shape is a synchronous
`branchCopyOps({ from, to, mode, where })` and an async
`vecCopyOps(db, { from, to })`.

- **Table ops.** For each table the manifest copies in the mode, one
  `INSERT INTO t (…) SELECT … FROM t WHERE branch_id = ?`, with the new
  branch bound in `branch_id`'s place and every other column copied as
  it stands. The column list comes from `getTableColumns` at call time,
  so a column a parallel slice adds, such as 6.8's `is_lead`, copies
  with no edit. JSON columns copy as stored text: no JSON function
  touches them, so the subtype lesson doesn't apply.
- **Predicates.** Each table takes an optional predicate, a SQL fragment
  with its own binds, ANDed into its `WHERE` and evaluated inside the
  statement, so it reads the batch's state at that point. A fork leaves
  out `kind = 'system'` entries and the deltas and journals its plan
  removes; the exclusion can't be a bound id list, since a fork near the
  start of a long story removes more ids than SQLite binds
  (`lib/db/bind-limit.ts:3`). Building that exclusion is 6.3's.
- **Vector ops, last and apart.** One statement per family table
  `listVecFamilyTables` finds (`vec-tables.ts:32-39`), returned
  separately so a caller can run the plan's ops between the table copy
  and the vectors. Each reads, binding the new branch, the new branch,
  the source branch and the new branch:

  ```sql
  INSERT INTO <vec> (pk, branch_id, model_id, id, source_hash, embedding)
  SELECT ? || ':' || id || ':' || model_id, ?, model_id, id, source_hash, embedding
  FROM <vec>
  WHERE branch_id = ?
    AND EXISTS (SELECT 1 FROM <source> s WHERE s.branch_id = ? AND s.id = <vec>.id)
  ```

  The `pk` takes `vecRowPk`'s shape (`:81-83`) from the columns, never
  from the old `pk`: rows written before the key widened hold
  `branchId:id` (`:76-80`). No predicate matches on `pk`, which vec0
  answers with no rows (`lib/db/embeddings/ops.ts:73-76`). The source
  table comes from `SOURCE_TABLES` (`lib/db/embeddings/stale.ts:20-26`),
  so `chapter_summaries_vec_*` reads `chapters`. Every model's rows copy
  (see [Open questions](#open-questions)).

  The family list is read before the batch, so a family table created
  between the listing and the batch is missed, and with it the first
  vectors written there. C3 accepts that: it takes a story's first drain
  at a dimension no family holds yet, running during that story's copy.
  Closing it would be the callers' job (6.3, 6.6), not the copier's.

- **What it leaves to its callers.** It writes no `branches` or
  `stories` row, clears no redo stack, emits no store patch and evicts
  nothing. Every branch-scoped table's `branch_id` is a foreign key to
  `branches.id`, so a caller inserts the `branches` row first in the
  same batch.

**Captures (C3).** `lib/probe/fork.test.ts` loses its structural scan
(`:9-49`), which a manifest-driven copier never trips, and gains a
both-sides test over a real duplicate-mode copy. The storage test at
`:51-68` can go or stay. 6.3 adds the fork case.

**The `user_action` anchor (C10).** `submitTurn` logs the `user_action`
create with `entryId: entryId` (`lib/actions/turns/submit-turn.ts:179`),
as `ai_reply` creates do. 6.8 owns the same call's metadata (`:157`) and
its refusal. The readers of `deltas.entry_id` that see the change are
checked, and sweep outcomes don't move, since a create inside the window
reverses under either anchor:

- `firstLocationWrites`
  (`lib/actions/story-entries/pre-entry-locations.ts:22-46`), which
  `scene-fields.ts:88` calls on the tail only. Its create lookup now
  finds a `user_action` tail's create, so writes logged under that turn's
  action with no anchor join the result. See
  [Open questions](#open-questions).
- `laterTurnDeltas` (`lib/actions/delta/later-turn.ts:94-98`): no change.
  It filters writes on the guarded rows, which are never
  `story_entries`, and either anchor keeps a later turn's write.
- `humanizeDelta` (`lib/history/humanize.ts:121,131`): no change on
  screen. World and Plot History list no `story_entries` deltas; the
  Diagnostics delta log (M7.3) will show the label. C11 leaves this file
  to 6.7 and 6.8, so this slice reads it and edits nothing.
- Checked and unaffected: `readHappeningsMadeFrom`
  (`lib/pipeline/definitions/entry-reads.ts:131-152`, happenings creates
  only), `resolveClassifierFactDeltas`
  (`lib/actions/story-entries/classifier-facts.ts:199-217`,
  `periodic_classifier` only), the rollback window's predicate
  (`lib/actions/story-entries/operational.ts:283`, canon's
  source-blind form), `describeUndoGroup`
  (`lib/undo/describe.ts:97-100`, which reads `target_id`, and `:79`,
  which reads only close groups) and the undo target's position read
  (`lib/actions/story-entries/undo-target.ts:44-45`, which already holds
  a `user_action`'s id from its `target_id`).

**The two-branch fixture.** A test helper, proposed at
`lib/db/__tests__/two-branch.ts`, beside `test-db.ts`:

- `cloneBranch(from, to)` copies every row of every table with a
  `branchId` column onto `to` with `branch_id` flipped and every other
  column, JSON text included, as it stands, so a delete payload on `to`
  names `from`, as a copy's does. It skips `pipeline_runs`, whose
  `run_id` key is global, and vectors. It is test code, apart from the
  copier, so neither grades the other.
- `branchSnapshot(branch)` reads every such table's rows for a branch,
  the "untouched" assertions' baseline.
- A seed with a row in every branch-scoped table, a trailing `system`
  entry, a delete of a character whose payload captured a relationship
  and an awareness row, a reversal journal, two probe captures and a
  `pipeline_runs` row, for the copier's test.

**Recorded, no task: one batch, one connection.** Nothing else writes
between the statements of one `runInTransaction` batch on either
platform. Desktop sends the batch in one IPC to
`electron/db/service.ts:65-82`, which runs `BEGIN`, a synchronous
`prepare().run()` per op and `COMMIT` on the process's only
`DatabaseSync` (`:12`), on the main thread, so no other handler runs in
between. Android runs `withTransactionSync` with synchronous `runSync`
calls (`lib/db/runtime/transaction.native.ts:7-16`) on the one handle
(`lib/db/runtime/client.native.ts:6`), on the JS thread. Only the SQL
inside the batch reads one consistent snapshot: a JS read before the
batch, such as the vec family list, is outside it; the family table
that misses is accepted under the copier's vector ops above.

**The forward pointer.** `rerun-journal.ts:240-241` drops "(no forks
yet, M6.1)" and says why the write-back stamps: a copied journal's JSON
names the branch that wrote it.

**Second to land.** Two jobs fall to whichever slice of a pair lands
second, so each is an acceptance criterion here, written as "if the
other has landed":

- With [Slice 6.7](./07-diff-cache.md) (C9): the database-seeded test
  that two branches holding one delta id, with different payloads, get
  distinct entries from the walk, in `lib/history/diff-walk.test.ts`,
  seeded with `cloneBranch`. It can't be seeded before the composite key.
  The cache's key on branch and delta id is 6.7's own in-memory test,
  which injects its walk and so never reaches the database.
- With [Slice 6.8](./08-per-branch-lead.md) (C4): this slice's
  generated step regenerated from main's snapshot, its hand-written step
  renumbered after 6.8's, and its bundle entries added.

**Canon.** None beyond R1's canon pass: the composite key, the manifest
and the restore stamp are canon already.

## Scope: out

- The planner's write branch: `rowTargetOf` and `RowTarget`'s shape
  (`reverse-replay.ts:468-497`), the walk's read in `rowStateOf`
  (`:499-513`), `emitUpdate`, `emitDelete`, `clearRef` (`:756-768`), the
  write branch at this slice's
  delta-op lines, re-owns split from prune deletes, vector sweeps split
  from `ops`, `journalOps` left out, `resolveSweep`'s `clampOps`
  discarded, and the tombstone re-insert's fixture:
  [Slice 6.3](./03-fork-core.md), on C1's line ownership.
- `forkBranch`, its refusal of a copy that would carry an unfinished
  run's deltas or journal, the exclusion that keeps the survivor copy
  under the bind cap, the equivalence harness, the seed's fork and the
  fork case of the captures test: [Slice 6.3](./03-fork-core.md).
- `duplicateStory`, its refusals (the DB-read swap check among them),
  the `branches` rows and their remap, and the Duplicate dialog:
  [Slice 6.6](./06-delete-duplicate.md).
- Branch delete, its run-row removal, `dropBranchRecords` and the lint
  owner list: [Slice 6.6](./06-delete-duplicate.md).
- The redo map and a group's own branch:
  [Slice 6.2](./02-scoped-reads-redo.md) (C6).
- The register two-branch tests, and the DB reads of other tables by id
  alone (`lib/entry-refs/read.ts:94-97`,
  `lib/actions/story-entries/system-entry.ts:86`):
  [Slice 6.2](./02-scoped-reads-redo.md) (C5).
- The eviction hook. The commit tails at `reverse-replay.ts:929-930` and
  `:991-993` and `redo.ts:364` stay as they are:
  [Slice 6.7](./07-diff-cache.md) (C9).
- `submitTurn`'s metadata and its lead refusal:
  [Slice 6.8](./08-per-branch-lead.md) (C10).
- The dev seed's finished `pipeline_runs` row keeps a null branch, as
  the backfill leaves a finished row; `seed-dataset.ts` belongs to 6.3
  and 6.8 (C11).
- `reverseReplayDeltas` (`reverse-replay.ts:948-964`) keeps its read by
  `action_id` alone: its one caller reverses a live turn's refused
  admission (`submit-turn.ts:200`), and canon lets a live run select by
  its id.
- The cost of a fork and of a full duplicate: 6.3 and 6.6 measure them.
- The review window across a fork: [Slice 6.4](./04-switching-navigator.md)
  (C11).
- Asset trash on a copy or a delete: M9.3.

## Acceptance criteria

**First tasks.**

- `app/dev/db-check.tsx` carries the vector-copy check, and it passes in
  the desktop dev app and in the Android dev client on the slot AVD.
  Implementation notes record each platform's SQLite version,
  `vec_version()` and result. If either failed, the vector ops use the
  temp-table fallback inside the batch, and the check passes on it on
  both platforms.
- The same route carries the temp-table check, run on both platforms
  whatever the vector check found; Implementation notes record whether a
  plain temp table can be created, filled, emptied and dropped inside
  one batch on each.

**The key, the run column and the migration.** None of these waits on
R1's canon pass.

- `lib/db/__tests__/migrate-m6-deltas-key.test.ts`, once under the
  desktop runner (each migration's statements one by one, foreign keys
  on) and once under the Android runner (every pending migration in one
  `BEGIN … COMMIT`, foreign keys on). A database migrated to the step
  before this slice's, not to a fixed number, since
  [Slice 6.8](./08-per-branch-lead.md)'s steps may land first, and
  populated (two stories, three branches, deltas whose payloads hold a
  delete with captured children, a reversal journal, finished and
  unfinished `pipeline_runs` rows) migrates. Every `deltas` row reads
  back equal in every column; `PRAGMA table_info(deltas)` gives
  `branch_id` and `id` as the key; `PRAGMA index_list(deltas)` holds
  `deltas_chain_idx` and `deltas_log_position_uniq`;
  `PRAGMA foreign_key_check` returns nothing.
- The same file, the backfill: an unfinished run with deltas on branch X
  reads X; an unfinished re-run with no delta and a journal on Y reads
  Y; an unfinished re-run with no delta and no journal whose
  `rerun_chapter_id` names a chapter on Z reads Z; an unfinished re-run
  whose `rerun_chapter_id` names no chapter, and an unfinished run with
  none of the three, read null; a finished run with deltas reads null.
  Each source is shown to matter: with the chapter subquery removed, the
  Z case reads null. If `pipeline_runs` came as a rebuild, its rows keep
  their relative `rowid` order, which recovery's tie-break reads
  (`recovery.ts:63`).
- `lib/db/__tests__/deltas.test.ts`: one delta id inserts on two
  branches, and a second insert of the same `(branch_id, id)` throws.
- `lib/db/schema.test.ts`: `pipeline_runs.branch_id` is a nullable text
  column with one foreign key, to `branches.id`.
- `lib/db/migrations/migrations.js` holds the new entries;
  `pnpm db:check` and `pnpm db:check:format` pass.
- `lib/pipeline/__tests__/orchestrator.happy.test.ts`: a started run's
  marker row holds its run's `branch_id`.
- `lib/actions/stories/delete-story.test.ts`: the pin passes with
  `pipelineRuns` in `BRANCH_SCOPED`, and a story delete removes its
  branch-stamped and null-branch run rows and keeps another story's.

**The six writes.** In `lib/actions/delta/two-branch.test.ts`, on the
fixture, each run on B while A holds the same delta ids, and each shown
red with its write's branch condition removed:

- `undoLastAction` on B prunes B's group and leaves A's deltas.
- A reversal on B that re-owns a create, in the shape of
  `reverse-plan-fields.test.ts:131`, rewrites B's create and leaves A's
  `source`, `entry_id` and `action_id`.
- A reversal on B that rewrites a held delete's payload (the same
  shape) and one that rewrites a survivor (the shape of
  `reverse-plan-fields.test.ts:178`) each change B's `undo_payload` and
  leave A's equal to its read before.
- `redoLastAction` on B restores B's survivor payload and leaves A's,
  with A's copy of that payload changed first, since a restore by id
  alone would otherwise write A the value it already holds.
- `undoLastAction` on B of a re-run writes its journal back onto B,
  through the composite conflict target, and leaves A's rows, deltas and
  journal.
- `rollbackToEntry` on B leaves A's `branchSnapshot` equal to its read
  before.
- The existing re-run write-back tests (`rerun-journal.test.ts`,
  `lib/actions/story-entries/undo-rerun.test.ts`) pass on single-branch
  stories under the new key.
- Outside tests, every `eq(deltas.id, …)` in a `where` sits in an
  `and(…)` with `eq(deltas.branchId, …)`, `apply-delta-action.ts`'s
  read-back among them. This lists each hit:

  ```sh
  rg -n 'eq\(deltas\.id' lib -g '!*.test.ts' -g '!**/__tests__/**'
  ```

**The restore stamp.** In the same file, a reversal on B of a group
that deleted a character holding a relationship and an awareness row
puts all three on B with `branch_id` B and none on A. Every emitted
patch for them carries `branchId` B in its row. The delete delta's
`undoPayload` deep-equals its read before the plan, so nothing stamped
the payload's own objects. The test goes red when the target's stamp is
removed, and again when the children's is. In `undoDelete`,
`delta.branchId` remains only in the liveness read.

**Recovery scoping and the read.** After R1's canon pass.

- `lib/pipeline/__tests__/recovery.test.ts`, on the fixture with an
  unfinished per-turn marker on B whose group A also holds:
  `recoverInFlightRuns` reverses B's group, settles the marker and leaves
  A's `branchSnapshot`. Red when the call passes `null` again.
- The same file, with an unfinished re-run marker on B and the journal
  on both branches, A's sorting first: B's journal is written back, and
  A's rows, deltas and journal stay.
- The same file, the third backfill source's case: an unfinished re-run
  marker on B with a `rerun_chapter_id`, no delta and no journal, its
  chapter and close groups on both branches: recovery undoes B's close
  and leaves A's `branchSnapshot`. Red when the marker's branch is null,
  which is what the backfill would leave without its chapter source.
- The same file: an unfinished marker with a null branch, no deltas, no
  journal and no chapter is deleted, as today.
- `lib/actions/delta/rerun-journal.test.ts`: `reverseRunGroup` given B
  reverses only B's copy of a group A also holds.
- `lib/actions/delta/unfinished-runs.test.ts` (or beside wherever the
  read lands): it returns a branch's unfinished rows, and not its
  finished rows, another branch's or a null-branch row.

**The manifest and the copier.**

- `lib/db/branch-copy/manifest.test.ts`: its keys equal the `dbSchema`
  tables with a `branchId` column; `probe_captures` and `pipeline_runs`
  are not copied in either mode; every other table copies in duplicate
  mode.
- `lib/db/branch-copy/copier.test.ts`, with the test inserting a
  `branches` row C and running it, the copier's table ops and its vector
  ops in one batch: for every table the manifest copies, C's rows equal
  A's with `branch_id` flipped, every other column equal, JSON text byte
  for byte; C holds no `probe_captures` or `pipeline_runs` row; A's
  `branchSnapshot` is unchanged.
- The same file: each table op names exactly the columns
  `getTableColumns` gives that table.
- The same file: a `story_entries` predicate `kind != 'system'` leaves
  out the trailing system entry, and a `deltas` predicate written as a
  subquery with no id list leaves out the rows it names.
- The same file, with A's vectors seeded in two dim families, under two
  models, one row with a pre-widen `branchId:id` key: C's vectors carry
  literal keys `<C>:<id>:<model>` with A's `model_id`, `id`,
  `source_hash` and embedding bytes; a vector whose source row a
  predicate left off C isn't copied; A's vectors are unchanged; a KNN on
  C's partition returns the copies.
- The same file: the copier's ops run without a `branches` row fail on
  the foreign key and write nothing.

**Captures.** `lib/probe/fork.test.ts`: a duplicate-mode copy of a
branch holding two captures leaves the copy none and the source both.
It goes red when the manifest marks `probe_captures` copied. No scan
remains.

**The anchor.**

- `lib/actions/turns/submit-turn.test.ts`: the `user_action` create's
  delta holds `entry_id` equal to the entry it creates.
- `lib/actions/story-entries/scene-fields.test.ts`: on a `user_action`
  tail with an entity move logged under its turn's action and no anchor,
  removing that character from the scene leaves the move uncounted, so
  `firstLocationWrites` returns what it returned before the anchor. This
  is the default under [Open questions](#open-questions); if the plan
  overturns it, the criterion changes with it.
- `lib/actions/story-entries/operational.test.ts` and
  `lib/actions/delta/later-turn.test.ts` pass unchanged.

**The rest.**

- `rerun-journal.ts:240-241` names no milestone.
- If [Slice 6.7](./07-diff-cache.md) has landed:
  `lib/history/diff-walk.test.ts` holds the database-seeded test that
  two branches holding one delta id, with different payloads, get
  distinct entries, seeded with `cloneBranch`, and the test goes red when
  the walk's chain read drops `branch_id`.
- If [Slice 6.8](./08-per-branch-lead.md) has landed: this slice's
  generated step is regenerated from main's snapshot, its hand-written
  step is numbered after 6.8's steps, `migrations.js` lists every step
  in order, `pnpm db:check` passes, and the migration test above starts
  from 6.8's last step.
- `pnpm test:e2e -- chapter-close-rerun` and
  `pnpm test:e2e -- reader-undo-redo` pass after `pnpm build:web` and
  `pnpm electron:compile`: the first CTRL-Zs a re-run through the new
  upsert, and the second drives CTRL-Z and redo from the reader.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm compiler:check`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Unit, the bulk of it.** Vitest `--project unit` on `lib/db`,
  `lib/actions/delta`, `lib/pipeline` and `lib/probe`, as the acceptance
  criteria list. Every two-branch test runs on `cloneBranch`'s fixture,
  where a copied payload names A, so a branch condition or a stamp that
  goes missing shows on A. Each new assertion is shown red once with its
  condition removed: this layer has passed vacuous tests before.
- **Migration, two runners.** Both arms run in the unit project on
  `node:sqlite` with sqlite-vec loaded, as `createTestDb` does
  (`lib/db/__tests__/test-db.ts:52-82`).
- **Device checks.** The vector-copy check and the temp-table check on
  the desktop dev app and on the slot AVD's dev client, results in
  Implementation notes. Optional,
  never blocking: the branch's build over an existing Android dev
  database, opened once, to see the migrations apply at boot.
- **E2E, regression only.** No new spec: nothing in this slice is
  reachable from the UI except through the re-run's CTRL-Z and redo,
  which `chapter-close-rerun.spec.ts` and `reader-undo-redo.spec.ts`
  already drive.
- **No Storybook.** No component changes.

## Open questions

- **Unaudited contract wording.** This slice builds on wording the
  milestone's [Open questions](../milestone.md#open-questions) list as
  never rechecked: C1's pin that a row target's branch is the branch the
  plan writes, with `undoDelete`'s child key and patch following it and
  the children stamped on copies; C2's third backfill source; C12's
  narrower gate on this slice; and the "second to land" criteria. Read
  each against the code at slice planning before building on it.
- **A plain `CREATE TEMP TABLE` inside a batch.** vec0's own DDL is
  routed around the batch (`lib/db/runtime/exec.ts:3-5`), and nothing
  yet shows whether ordinary DDL runs inside desktop's single-IPC
  `transaction` or Android's `withTransactionSync`. The first-task
  temp-table check answers it on both platforms. If either refuses, the
  vector fallback has no route should the vector check fail too, and
  [Slice 6.3](./03-fork-core.md)'s survivor exclusion can't take the
  temp-table route; take that to the developer before building on
  either.
- **Every model's vectors.** Canon's manifest filters by no model,
  so the copy carries every `model_id`, leftovers of an abandoned swap
  included. Both callers refuse while a swap is pending, so staged rows
  of a live swap never copy. Default: copy all, as canon reads, and
  record it in Implementation notes.
- **A row with none of the three backfill sources.** It stays null and
  keeps the id-only reads (C2). It has nothing to reverse: no delta, no
  journal, and no `rerun_chapter_id` or one naming no chapter. The first
  boot after the migration runs recovery before any story can open, and
  a recovery that reverses nothing deletes the marker
  (`recovery.ts:73-89`), so no copy can meet the row. That holds unless
  that boot's recovery of such a row throws and the marker survives to
  a later boot. The plan confirms that only a failed transaction can do
  that, which the next boot retries, or names another way.
- **`firstLocationWrites` on a `user_action` tail.** With the anchor,
  the function's create lookup finds the tail's create, and its action
  is the turn's run's (`submit-turn.ts:177,190`), so that run's
  unanchored writes join a `user_action` tail's result. Such writes
  survive under a `user_action` tail only when the run's own reversal
  failed. Default: keep the earlier result, by restricting the action
  arm to entries a run created (not `user_action`), since the function's
  comment ties the arm to "its run is the one that created the entry".
- **Fixtures and the marker's foreign key.** A test that runs a pipeline
  with no `branches` row for its branch now fails at the marker insert,
  and `unwindRun` reports it as a failed run. The pipeline harness seeds
  `b1` (`lib/pipeline/__tests__/harness.ts:44`); other fixtures may not.
  Seed the row; don't loosen the key.
- **Size.** Planned at 16 tasks. The milestone's
  [Open questions](../milestone.md#open-questions) say that if R1's
  recovery work grows this slice, the copier moves to 6.3 and duplicate
  waits on the planner. Check at the plan skeleton.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
