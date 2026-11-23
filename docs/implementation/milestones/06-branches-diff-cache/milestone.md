# Milestone 6: Branches + diff cache

## Goal

Branches work. Forking at any entry creates a standalone branch per the
[branch-copy manifest](../../../data-model.md#branch-model); the reader
switches, renames and deletes branches through the navigator; a story
can be duplicated, one branch or all. Each branch keeps its own lead
and its own redo stack, and every read scopes to the loaded branch.
Alongside, the
[diff cache](../../../architecture.md#delta-history-diff-resolution)
gives History its before-and-after prose.

## Why now

Branches touch every domain table: composite `(branch_id, id)` keys,
verbatim copies of rows, deltas and journals, and a rewind that reuses
rollback's planner. They need the whole data layer in place and
exercised, which M2 to M5 did, and they need chapter close to exist
first, since a fork has to copy and rewind a close's writes and its
re-run journals. M5 also left one control waiting on a fork:
`Re-run on new branch` renders disabled until this milestone builds it.
The diff cache is bespoke compute over the delta log, so it comes after
the log's shape has stopped moving, and this milestone moves it one
last time, to a composite key.

## Narrative / overview

**A fork is a copy plus a rewind, and the copy comes first.** Canon
defines a fork as a snapshot of the parent rolled back to the fork
entry. The roadmap had one slice own all of it. Research found the
rewind's planner, which canon calls `planReversal` with a target
branch, doesn't exist: the shipped planner writes every op to the
branch it reads. So the milestone cuts the copy away from the rewind.
Story duplicate is the copy with no rewind, and it proves the copy
core before the fork builds on it.

Four tracks compose the milestone. Three start at once.

**The copy track** makes rows repeat across branches safely, then
copies them. [Slice 6.1](./slices/01-copy-substrate.md) moves `deltas`
to its composite key, scopes every delta write by branch, re-stamps
restored rows, gives run records a branch so boot recovery can scope by
it (C2), and builds the manifest copier with its vector copy (C3).
Nothing can copy a branch before it lands, so the hazards a copy
creates start and end there.
[Slice 6.3](./slices/03-fork-core.md) gives the reversal planner a
write branch and builds `forkBranch` on the copier, proven against an
equivalence harness: the child must equal a plain copy of the parent
rolled back to the fork entry. It rebuilds the dev seed's fork as a
real one. It starts beside 6.1, in the parts of the planner 6.1 doesn't
touch, and lands after it.

**The surface track** makes a second branch reachable.
[Slice 6.2](./slices/02-scoped-reads-redo.md) gives the working-set
stores a branch-scoped accessor, replaces 54 inline filters, and makes
the redo stack a map by branch.
[Slice 6.10](./slices/10-register-branch-pairs.md) then proves every
action register's branch condition against a second branch.
[Slice 6.4](./slices/04-switching-navigator.md) builds the branch
chip, the navigator, rename, `Browse branches…` and the switch itself,
on the seed's second branch, with no fork. A switch gives a fresh
reader instance (C8), which dissolves three reader deferrals the
roadmap carried.
[Slice 6.5](./slices/05-fork-from-reader.md) then wires the fork's two
entry points: an entry's `⎇` with its creation modal, and
`Re-run on new branch`, which is a fork, a switch and a re-run in
sequence, not the button flip M5 expected.
[Slice 6.6](./slices/06-delete-duplicate.md) finishes branch
management: delete from the navigator and duplicate from the story
list.

**The diff cache** is a leaf.
[Slice 6.7](./slices/07-diff-cache.md) builds the chain walk, the
cache, its eviction and the prose renderer, and moves World and Plot
History off M4's field-name fallback. It needs a read primitive neither
platform has, and it evicts by branch (C9).

**The lead track** shares no code with fork.
[Slice 6.8](./slices/08-per-branch-lead.md) turns the lead into a flag
on the branch's character row, logged like any World edit, stamps each
entry with the lead it was written under, and refuses a turn on a
branch that needs a lead and has none.
[Slice 6.9](./slices/09-lead-in-prompts.md) puts that into prompts:
marks where the lead changes, the chapter context's lead and narration,
and the third-person rule for summaries and happening descriptions.

What changes from "before" to "after": a story goes from one line with
one history to a set of standalone lines the user forks, visits and
discards, each with its own log, lead and redo, and History says what
changed, not only which fields.

Five deliberate M6 limits. A branch delete trashes no assets: nothing
writes assets yet, and the refcount trash is M9.3's. The diff prose
covers the seven tables World and Plot History list; the five only the
Diagnostics delta log shows wait for M7.3, which adopts the cache.
Story Settings' lead field, its `No lead` and the confirm's
other-branches line are M7.2's, so unset ships with no caller. A
story-level write that clears every branch's redo stack has no writer
in M6 once the lead is per branch, and lands with M7.2's definition
save. The composer draft doesn't survive a switch, and nothing prompts.

## Slices

- [Slice 6.1](./slices/01-copy-substrate.md) — copy substrate: the
  composite `deltas` key, six scoped delta writes, the restore
  re-stamp, run records with a branch, the manifest copier, the vector
  copy and its device probes (C1, C2, C3, C4)
- [Slice 6.2](./slices/02-scoped-reads-redo.md) — branch-scoped reads
  and per-branch redo: the store accessor, the filter and id-only
  sweeps, the redo map (C5, C6)
- [Slice 6.3](./slices/03-fork-core.md) — fork core: the planner's
  write branch, the survivor copy, `forkBranch`, the equivalence
  harness, the seed's real fork (C7)
- [Slice 6.4](./slices/04-switching-navigator.md) — switching and the
  navigator: the branch read, `switchBranch`, the chip, the navigator,
  rename, `Browse branches…`, the reader's fresh instance (C8)
- [Slice 6.5](./slices/05-fork-from-reader.md) — fork from the reader:
  `⎇`, the creation modal, `Re-run on new branch`
- [Slice 6.6](./slices/06-delete-duplicate.md) — branch delete and
  story duplicate: the delete action, its confirm and count, the
  Duplicate dialog and the story list's wiring
- [Slice 6.7](./slices/07-diff-cache.md) — diff cache: the read
  snapshot, the walk, the cache and its eviction, the prose renderer,
  the History host (C9)
- [Slice 6.8](./slices/08-per-branch-lead.md) — the per-branch lead:
  the flag and its migration, set and unset, delete and merge, the
  `leadId` stamp, the refused turn (C10)
- [Slice 6.9](./slices/09-lead-in-prompts.md) — the lead in prompts:
  lead marks, the chapter context's lead and narration, the
  third-person rule
- [Slice 6.10](./slices/10-register-branch-pairs.md) — register
  two-branch pairs: each of the 55 registered handlers against a second
  branch holding the same ids, and the chapter delete's branch reads
  (C5)

## Dependency graph

```
day one:  6.1   6.2   6.7   6.8        6.3*   6.4*
                                       (* starts at once, lands after its gate)

6.1 ───────────→ 6.3   (landing)
6.2 ───────────→ 6.4   (landing)
6.3, 6.4 ──────→ 6.5
6.1, 6.2, 6.4 ─→ 6.6
6.8 ───────────→ 6.9
6.2 ───────────→ 6.10

6.1 ┄ 6.7    (no edge: the second to land writes the two-branch cache test)
6.3 ┄ 6.8    (no edge: the second to land adds a lead switch to the harness
              and stamps the seeded fork's own turns)
6.7 ┄ 6.8    (no edge: the second to land gives the flag its prose)
6.1 ┄ 6.8    (no edge: the second to land regenerates its migrations, C4)
6.2 ┄ 6.8    (no edge: the second to land carries the three lead lines, C5)
6.2 ┄ 6.3    (no edge: the second to land adds the check that a fork's
              child starts with an empty redo stack)
6.8 ┄ 6.10   (no edge: if 6.8 lands first, 6.10 keeps its isLead pair
              in the entities branch scope block)
```

Each "second to land" job is an acceptance criterion in both slices of
its pair, written as "if the other has landed". Whichever lands second
has to meet it, so it can't be skipped with every test green.

- **Day-one startable:** 6.1, 6.2, 6.7 and 6.8, and the first parts of
  6.3 and 6.4.
- **6.1 gates 6.3's landing.** 6.3 starts in the planner's row-level
  code, which the composite key doesn't touch: the domain tables are
  already keyed by branch. Its delta-log ops, its copy and its harness
  come after 6.1 merges. C1 says which lines each owns meanwhile.
- **6.2 gates 6.4's landing.** 6.4 starts with the branch read, the
  switch action, the navigator in Storybook and rename. Its reader
  integration uses 6.2's accessor and redo map.
- **6.5 comes after the fork and the switch,** since it is both in
  sequence.
- **6.6 comes after 6.1, 6.2 and 6.4.** Delete needs C2's run records,
  the redo map and the navigator's row. Duplicate needs the copier and
  the branch read. Neither needs the fork.
- **6.9 follows 6.8** for the flag, the stamps and the DB lead read.
- **6.10 follows 6.2.** Its register pairs go in the suites whose store
  reads 6.2 migrates. Nothing waits on it.
- **The rulings gate tasks, not starts.** R1's canon lands before
  6.1's run-record tasks, R2's before 6.4's switch, R3's before 6.7's
  eviction (C12).
- **The roadmap's parallel-paths sketch is superseded.** M6.1 becomes
  6.1 and 6.3. M6.2 becomes 6.2, with per-branch redo. M6.3 becomes
  6.4, 6.5 and the delete half of 6.6. M6.4 becomes 6.7. M6.6 becomes
  the duplicate half of 6.6, its copy core in 6.1. The per-branch lead
  becomes 6.8 and 6.9. M6.5 stays dropped.

## Slice contracts

### C1 — Delta rows on two branches

Provider: [Slice 6.1](./slices/01-copy-substrate.md). Consumers: 6.3,
6.6, 6.7.

After a copy, one delta id names a row on each branch, so no write may
select a delta by its id alone
([`data-model.md → Branch model`](../../../data-model.md#branch-model)).

- `deltas` moves from `id` as its primary key
  (`lib/db/system/system.table.ts:59`) to `(branch_id, id)`, a
  generated rebuild.
- Six writes scope by branch and id, in the same change as the
  migration: the prune and the re-own in `reownOrPrune`
  (`lib/actions/delta/reverse-replay.ts:178-187`), the held-payload
  rewrite (`:363`), the survivor rewrite (`:818`), redo's survivor
  restore (`lib/actions/delta/redo.ts:345`), and the journal
  write-back's upsert, whose conflict target `deltas.id`
  (`lib/actions/delta/rerun-journal.ts:288`) SQLite rejects under the
  composite key. That last one breaks a re-run's undo on single-branch
  stories, so the two can't land apart.
- The read-back at `lib/actions/delta/apply-delta-action.ts:220-223`
  gains the branch too. Its id is freshly minted, so it can't meet a
  copy, but selected by id alone it can no longer use the primary key,
  and it runs on every delta-logged write.
- Redo's survivor write has only the delta's id in hand
  (`redo.ts:343-345`). 6.1 records on each survivor the branch the undo
  wrote (`SurvivorPayload.branchId`, from `set.branchId`); C6 later
  gives the group a branch of its own, the same value.
- **Restores take their row target's branch.** `undoDelete` inserts
  its target row and captured children as the payload holds them
  (`reverse-replay.ts:625-654`), and the tombstone re-insert writes the
  row as read (`:732-735`); `emitInsert` writes whatever row it is
  handed and ignores its target's branch (`:551-565`). A copied payload
  names the branch that wrote it. So the insert emission stamps the
  row's branch from its row target, on the row it inserts, so the store
  patch carries it, as the journal write-back does
  (`rerun-journal.ts:268-276`). `undoDelete` inserts its captured
  children itself, outside `emitInsert` (`:641-655`), so it stamps them
  the same way, on copies, since the rows it holds are the payload's
  own objects; and it keys and patches them by the row target's branch
  where it reads the delta's today (`:659`, `:666`). Its liveness read
  keeps the delta's branch (`:629`): that is a read.
- **A row target's branch is the branch the plan writes.** `RowTarget`
  has one `branchId`, which builds its `where`, its key in the walk and
  its patch (`:468-475`, `:483-493`). In 6.1 that branch is its delta's,
  so a reversal on a copied branch becomes correct, and 6.1 proves it by
  reversing on its fixture's copy, with a delete that captured children
  among the reversed deltas. 6.3 makes it the write branch and adds the
  read side, a second `where` for the walk's reads. No stamp, key or
  patch may read `delta.branchId` directly: a fork reverses the parent's
  deltas onto the child, so one taken from the delta would restore a row
  the parent deleted after the fork entry back onto the parent.
- **Who edits what until 6.1 merges.** 6.1 owns `reownOrPrune`, `:363`,
  `:818`, the stamp in `emitInsert`, `undoDelete`'s children (their
  stamp, key and patch), `redo.ts:345` and `rerun-journal.ts`. 6.3 owns
  `rowTargetOf` and the row target's shape
  (`reverse-replay.ts:468-497`), `emitUpdate`, `emitDelete`,
  `clearRef` (`:756-768`) and the walk's read in `rowStateOf`
  (`:499-513`), which takes the read side. Until 6.1 merges the plan's ops still rewrite
  the parent's deltas and sweep its vectors, so 6.3's tests in that
  stretch use fixtures with no held copy, no survivor and no swept row,
  or assert on the op list without running it. After 6.1 merges, 6.3 replaces "the delta's branch"
  with the plan's write branch at 6.1's delta-op lines, and splits the
  plan's op lists there: the re-owns from the prune deletes inside
  `reownOrPrune`, and the vector sweeps from `ops`.

### C2 — Run records and the copy refusal

Provider: [Slice 6.1](./slices/01-copy-substrate.md). Consumers: 6.3,
6.6. Ruled 2026-11-22 (R1).

Boot recovery selects a run's deltas by `action_id` alone, on canon's
ground that fork and duplicate refuse a held branch. Three kinds of
unfinished run pass every refusal canon lists, and `pipeline_runs` has
no branch to scope by (`system.table.ts:44-54`).

- `pipeline_runs` gains a nullable `branch_id` that references
  `branches.id`, as every other `branch_id` column does. The
  orchestrator writes it with the marker
  (`lib/pipeline/runtime/orchestrator.ts:171`). The migration backfills
  unfinished rows only, from the run's deltas, then from its journal,
  then, for a re-run's marker, from the chapter its `rerun_chapter_id`
  names: no copy exists yet, so each match is exact, and `action_id`
  has no index to backfill every finished row by. A row with none of
  the three stays null. The third source closes a leftover the first
  two miss: a re-run marker with a chapter and nothing else, whose
  chapter lookup by id alone could find a copy's row.
- `recoverInFlightRuns` passes the orphan's branch where it passes
  `null` today (`lib/pipeline/runtime/recovery.ts:73-75`).
  `reverseRunGroup`'s group read scopes by a branch it is given, which
  it ignores today though abort passes one
  (`rerun-journal.ts:497-501`, `orchestrator.ts:485-487`); the journal
  read (`:183-189`) and the chapter read (`:421-428`) already do. A null
  branch keeps the id-only read.
- **One read, three rules.** 6.1 exports the unfinished run rows of a
  branch. Story duplicate refuses a copied branch that has one. Fork
  refuses when a delta of an unfinished run would survive into the
  copy, or its journal would, or, for a re-run whose reversal
  committed, its chapter would, judged against the plan's prune set; this
  replaces canon's blanket refusal of a parent whose
  `classifier_status.state` is `'running'`, and keeps the
  recovery-failure policy's branch "from an entry before the orphan".
  Branch delete removes every run row of the branch in its transaction,
  finished ones too, before the `branches` row: the column is a foreign
  key, and nearly every branch has finished rows.
- **In-memory records.** `dropBranchRecords` drops `deferred` and
  `pendingClose` only (`lib/stores/generation/generation.ts:324-330`).
  6.6 extends it to `pendingRerun` and `heldBranches`, which also fixes
  story delete's leak, and adds its delete action to the list of files
  the lint rule lets call it (`eslint.config.js:38-41,314-331`), which
  canon repeats in `code-conventions.md`. A held branch stays
  deletable.
- **The delete cascade's pin.** A test holds `BRANCH_SCOPED` equal to
  every schema table with a `branchId` column
  (`lib/actions/stories/delete-story.test.ts:262-272`), so the new
  column pulls `pipeline_runs` into it. 6.1 adds it there and gives it
  its manifest row: not copied by a fork, not copied by a duplicate.
  The story-wide delete at `lib/actions/stories/delete-story.ts:76`
  stays for rows with no branch.

### C3 — The manifest and the copier

Provider: [Slice 6.1](./slices/01-copy-substrate.md). Consumers: 6.3,
6.6.

- **The manifest is code.** One typed map gives every table with a
  `branchId` column its Fork and its Duplicate behavior, as canon's
  table does, with a structural test against `dbSchema` like the delete
  cascade's. The copier reads the manifest, never `BRANCH_SCOPED`:
  that list holds `probe_captures`
  (`delete-story.ts:34-50`), so a copier built on it would copy
  captures without ever naming them, and the scan in
  `lib/probe/fork.test.ts:35-49` would stay green.
- **The copier returns ops for a caller's batch.** Per table, one
  `INSERT … SELECT` that flips `branch_id` and keeps every other
  column, taking its column list from the schema at call time, so a
  column a parallel slice adds (6.8's `is_lead`) copies with no edit.
  Each table takes an optional predicate: a fork's predicates leave
  out the deltas and journals its plan removes, and the copier itself
  leaves out a fork's `kind = 'system'` entries. The exclusion can't
  be a bound id list, since a fork near the start of a long story
  removes more ids than SQLite binds.
- **Vectors copy last, as their own ops.** One statement per family
  table from `listVecFamilyTables`
  (`lib/db/embeddings/vec-tables.ts:33-39`), building `pk` from the
  columns in `vecRowPk`'s shape (`:81-83`), never from the old `pk`,
  and filtered to rows the new branch's source table still holds.
  Proven on the Node test stack at planning; 6.1's first task probes it
  on Electron and on Android, whose sqlite-vec is older. If either
  fails, the fallback is a temp table filled and emptied inside the
  batch, not a pre-read in JS: a duplicate takes no lock and reads one
  snapshot, which a pre-read would break. A family table created
  between the listing and the batch is missed; that is accepted, and
  closing it would be the callers' job, not the copier's.
- The copier writes no `branches` or `stories` row, clears no redo
  stack, emits no store patch and evicts nothing. Its callers own all
  four.
- The copy tasks of 6.3 and 6.6 start after 6.1 merges, so the
  signatures are whatever 6.1 ships. The properties above are what's
  pinned.
- **Captures.** 6.1 replaces the structural scan with a test over a
  real duplicate-mode copy, asserting both sides. 6.3 adds the fork
  case.

### C4 — Migrations

Shared by: 6.1, 6.8.

The sequence is one numbered chain, `0000` to `0020`, with a native
bundle in `lib/db/migrations/migrations.js`. Two day-one slices add to
it.

- 6.1: the `deltas` rebuild and the `pipeline_runs` column, generated,
  then the hand-written backfill.
- 6.8: the `is_lead` column, the hand-written data step, then the
  `entities` `CHECK` rebuild, as three steps from separate drizzle-kit
  runs, in that order. A column and its `CHECK` generated together make
  the rebuild's `INSERT … SELECT` name a column the old table lacks.
- Neither pins a number. The second to land regenerates its generated
  steps from main's snapshot, renumbers its hand-written step, and adds
  its bundle entries. The two touch different tables, so no order
  between them is needed.
- A hand-written step guards its JSON reads, as `0011` and `0013` do:
  one bad blob aborts `migrate()` at boot.

### C5 — Branch-scoped store reads

Provider: [Slice 6.2](./slices/02-scoped-reads-redo.md), and
[Slice 6.10](./slices/10-register-branch-pairs.md) for the register
pairs. Consumers: every slice landing after them.

The working-set stores hold one branch, keyed by id alone, and expose
no reactive loaded branch: `useRows` selects rows only
(`lib/stores/factory/working-set-store.ts:55-62`).

- The factory gains two reads: a branch's rows, which is the store's
  rows when that branch is loaded and a stable empty value otherwise;
  and one row by branch and id. Both come as a hook and a getter, and
  the stores' derived getters take the branch too.
- 6.2 replaces the inline `branchId` filters over store rows, the three
  identical helpers (`onBranch`, `branchRows`, `inBranch`) and the
  lookups by id alone, the History target among them
  (`components/history/use-history-target.ts`).
- Code landing after 6.2 uses the accessor. Code landing before keeps
  the inline form, and 6.2's last task sweeps main again at its final
  rebase. The stores' signatures then hold it, so a later slice can't
  add one back unnoticed: every row read, `getById` and derived getter
  takes the branch, no store keeps an unscoped read, and
  `pnpm typecheck` fails on one. 6.2's planning chose the signature
  over a lint rule, which would have needed its own member list and
  left `lib/stores/` unchecked.
- **Database reads by id alone.** 6.2 also sweeps the reads that select
  a branch-scoped row from the DB without its branch. After a copy,
  `readWideExcerpts` can return another branch's entry
  (`lib/entry-refs/read.ts:94-97`); its caller holds the branch. The
  read at `lib/actions/story-entries/system-entry.ts:86` selects a
  freshly minted id, so it can't, but it takes the branch for the same
  reason C1's read-back does.
- **Register tests after 6.2.** A slice that adds or changes a register
  handler once 6.2 has landed adds that handler's two-branch pair.
  [Slice 6.10](./slices/10-register-branch-pairs.md) covers all 55
  registered handlers: the 39 the register files define and the 16 the
  entities register takes from
  `lib/actions/entities/state-patch-actions.ts`.
- **One caller 6.2 can't finish.** The review window's chapter lookup
  (`lib/stores/ui/chapter-overlays.ts:101-103`) has no branch to pass
  until 6.4 gives the review request one. 6.2 passes the loaded branch
  there so its own typecheck holds, and 6.4 replaces it.
- 6.2 leaves `lib/world/lead.ts` and the lead lines at its callers to
  6.8 (C10), with one exception: three of those lines hand a raw entity
  map to `resolveLead`, which stops compiling once the unscoped reads
  go (`lib/pipeline/definitions/generation-context.ts:496`,
  `periodic-classifier.ts:204-205`,
  `app/reader-composer/[branchId].tsx:356-358`). There 6.2 swaps the map
  argument for the branch read and changes nothing else.
- **The accessor guards wrong-row reads only.** Under R2 a switch
  replaces the whole in-story stack (C8), so no route outlives a
  hydrate for another branch beyond the navigation that replaces it.
  Nothing re-hydrates on refocus.

### C6 — One redo stack per branch

Provider: [Slice 6.2](./slices/02-scoped-reads-redo.md). Consumers:
6.3, 6.4, 6.6, 6.8.

The redo store is one array (`lib/stores/ui/undo-redo.ts:6-36`), and a
`RedoGroup` carries no branch (`lib/actions/delta/redo.ts:50-75`).
Canon makes it a map from a branch to its groups
([`data-model.md → Entry mutability & rollback`](../../../data-model.md#entry-mutability--rollback)).

- A `RedoGroup` carries its branch, set from the reversal set when the
  undo is prepared. A push reads the branch from its group, so the two
  can't disagree; peek, pop, clear, the has-redo read and a drop for a
  deleted branch each take one.
- Each clear names the branch it wrote, which every site already holds:
  `apply-delta-action.ts:213` and `:390`,
  `lib/actions/delta/commit-new-action.ts:24,27`,
  `lib/actions/turns/regenerate-turn.ts:199,209`, and the re-run's undo
  at `lib/actions/story-entries/undo.ts:241,247`.
- The reader reads its own branch's top
  (`components/reader/use-reader-undo.tsx:211,271,373`).
- **`set-lead.ts`.** Its direct clear
  (`lib/actions/stories/set-lead.ts:69`) is the one story-level clear.
  If 6.2 lands first it clears every branch of the story there. 6.8
  deletes the call either way: its logged group clears its branch
  through `applyDeltaActionGroup`. If 6.8 lands first, 6.2 builds no
  story-wide clear.
- **Fork clears nothing.** Canon leaves the parent's stack as it was,
  so `forkBranch` can't commit through `applyDeltaAction` or
  `commitNewAction`, both of which clear.
- Story delete drops its branches' stacks (6.2). Branch delete drops
  its own (6.6).

### C7 — Fork

Provider: [Slice 6.3](./slices/03-fork-core.md). Consumers: 6.5; the
seed's consumers 6.4, 6.6 and 6.8.

- **The action.** `forkBranch` takes the parent branch, the fork entry,
  a name and whether to make the new branch current, and returns the
  new branch's id or a typed refusal. It wraps a core that also takes
  the new branch's id and creation time: the action mints them, and the
  seed passes its own, since a seed must stay deterministic. Refused
  before any write, per canon and C2: the gate closed, a pending
  embedder swap, the entry missing or `system`, an unfinished run the
  copy would carry. It also passes through two refusals of the sweep it
  plans with: a fork point whose next entry has no create delta
  (`operational.ts:268-273`), and a reversal the planner refuses as an
  integrity error. The gate it reads leaves out the branch's hold, as
  the switch's does (C8): R1's fork from an entry before a leftover
  run's writes needs a held parent to be forkable.
- **The lock.** It holds the parent's branch write lock exclusive
  (`lib/actions/delta/branch-write-lock.ts:86-101`) from before its
  first plan read until its commit: the plan is read across awaits
  before the batch runs.
- **The plan.** `resolveSweep`
  (`lib/actions/story-entries/operational.ts:306-334`) gives the window
  and the closed set; fork discards its `clampOps`, which clamp the
  parent's watermark (`:329`), and writes the child's status itself.
  `buildReverseAndPrunePlan` (`reverse-replay.ts:171`) gains a write
  branch: it reads the parent and writes the child. Rollback is the
  case where the two are equal, so its test files stay the regression
  net. For a fork, the row writes, the ref clears, the held-payload and
  survivor rewrites and the re-owns go to the child; the prune deletes,
  `journalOps` and the vector sweeps pushed at `:821-823` are left out,
  since the copy never wrote those rows; and no store patch is emitted.
  `ReversePlan` (`:81-109`) keeps its fields and gains what the split
  needs.
- **The batch.** Canon's order: the `branches` row, the copier's ops
  with the plan's exclusions (C3), the plan's ops on the child, vectors
  last. With "make current", the batch also writes
  `stories.current_branch_id`, so the branch and the pointer commit
  together (R2).
- **The survivor copy is a predicate by default.** Most of what a fork
  leaves out of `deltas` is the rollback window, which `resolveSweep`
  already holds as a SQL predicate; only the deltas the plan prunes
  outside it (those the closure adds, the pruned holders and the
  stranded writes) and the creates it re-owns and so keeps need id
  lists, and those are short. `resolveSweep` returns the window's rows
  today, so it exposes the predicate it builds. A temp table created inside the batch is
  the fallback, and it needs a check first that both platforms run
  table-creation SQL inside one: that check blocks the slice, unlike
  its other device runs.
- It clears no redo stack (C6), fires no eviction (C9), emits no store
  patch and refreshes no branch list: its callers show the branch (C8).
- **Proof.** For each fixture, the child equals a plain copy of the
  parent rolled back to the fork entry by the shipped rollback, and the
  parent is untouched: rows, deltas, journals, watermark, vectors and
  redo stack. The plain copy is the copier's with `kind = 'system'`
  entries left out: a duplicate-mode copy keeps a trailing error card,
  which a fork leaves out and a rollback can't remove, since it has no
  delta.
- **The seed's fork.** `br_hero_fork` holds twelve entries of its own
  and no entity (`lib/db/devtools/seed-dataset.ts:292-312`), and names a
  fork entry it doesn't hold (`:2245-2251`). 6.3 rebuilds it by running
  the fork at seed time, then appends a few turns of the fork's own,
  with their create deltas as main's entries have: a pure fork holds no
  entry of its own, and 6.6's delete confirm would only ever show its
  zero wording. It keeps its id, name and parent. Until then, and
  after: E2E in 6.4 and 6.6 reads the fork's identity and entries from
  the DB, never fixed content, and takes no turn on it, since after 6.8
  a fork with no characters has no lead.

### C8 — The branch list, the switch and the navigator's row

Provider: [Slice 6.4](./slices/04-switching-navigator.md). Consumers:
6.5, 6.6. Ruled 2026-11-22 (R2). Settled by sequencing, since both
consumers start after 6.4 merges; pinned here because three slices
build on it.

- **The read.** A story's branch rows from `branches`
  (`lib/db/stories/stories.table.ts:39-49`), by `created_at`, usable
  with no story open. The open story's chip and navigator read it
  through a store, and each writer of a branch row refreshes that store
  after its commit: rename (6.4), delete (6.6), and the fork's callers
  (6.5).
- **`switchBranch`.** One action. The navigator pauses its rows while
  a run, a pending turn or a reversal holds the gate, and the action
  refuses then as the backstop. In order: it writes
  `stories.current_branch_id`, which only story creation writes today
  (`lib/actions/stories/create-story.ts:117`); reads the branch's rows,
  the read half of the load every open shares
  (`lib/actions/stories/operational.ts:107-214`); re-reads the stories
  store; then, in one synchronous block, fills the working-set stores,
  publishes the branch, drops
  the close result the overlays store holds for the commit banner
  (`lib/stores/ui/chapter-overlays.ts:20-37,172`), so its done state
  ends, and navigates. Nothing is awaited between the publish and the
  navigation, or the old reader would render against the new branch's
  stores. The reader holds its gated controls while a switch runs, so
  no Send starts between the gate check and the publish. If the load
  fails, the pointer goes back to the branch the reader shows and
  nothing navigates: a story open reads the pointer, and one left on a
  branch that can't load would break every later open. The gate it
  reads leaves out the branch's hold, which the store's own
  `isUserEditBlocked` adds (`generation.ts:89-93,404-405`): a held
  branch doesn't block leaving it.
- **A switch is not a story open.** It publishes by the refresh path,
  `currentStoryStore.set`, not `open`
  (`lib/stores/current-story/current-story.ts:27-28,56-57`). An open
  bumps `openSeq`, and the embedding-upgrade prompt is evaluated once
  per open (`lib/embedder-swap/upgrade-prompt.ts:39-51`), so a switch
  that counted as one would raise it again.
- **A switch or a fork holds the reader until its navigation lands.**
  Whatever starts one holds the reader's gated controls and its ways
  out, the Actions menu and the settings entry among them, from its
  start to the navigation. That covers a navigator row's press, the
  creation modal's confirm and the re-run path, whose confirm is hosted
  at the root, outside the reader, and stays pending until then. The
  hold lives in the UI stores, keyed by the reader's branch, so a
  caller outside the reader can take it. Without it a Send can start a turn on
  the old branch while the new one publishes.
- **A switch abandoned before its publish puts the pointer back,** as a
  failed load does. Abandoned means the reader that started it lost
  focus or unmounted before the publish.
- **The branch list refreshes after the navigation, and its failure is
  logged, not surfaced.** A refresh that threw between a fork's commit
  and the tail would leave the pointer on a branch that is never shown.
  The new reader's mount re-reads the list anyway.
- **Showing a branch that is already current.** The tail of a switch,
  for a caller whose own transaction moved the pointer: 6.5 calls it
  after `forkBranch`. It never moves the pointer back. If its load
  fails it still navigates, and the reader's own load handles the
  failure: canon keeps the route and the pointer on the new branch once
  a fork has committed
  ([`chapter-close.md → Re-running a close`](../../../memory/chapter-close.md#re-running-a-close)).
- **A switch replaces the in-story stack.** Not the reader alone: a
  story's Settings opened from its card, then World, then the reader
  leaves the old branch's World beneath, and a `replace` of the top
  route would let Back land on it, empty. So every switch, the create
  path and the re-run path navigate through one helper from 6.4 that
  replaces the whole in-story stack, and Back lands on the Story List.
- **A fresh reader.** The reader route keys its body on `branchId`
  (`app/reader-composer/[branchId].tsx:266-283`), so refs, the composer
  and the mount effects are new whatever the router reuses. The
  composer's draft doesn't carry.
- **Names.** Rename and the creation modal store a branch's name
  trimmed.
- **The row.** The navigator's row renders `×` only when its host
  passes a delete handler, and never on the current branch, as
  `EntryCard` renders `⎇` only when given `onBranch`
  (`components/compounds/entry-card.tsx:1398-1406`). 6.6 passes it.

### C9 — The diff cache's seams

Provider: [Slice 6.7](./slices/07-diff-cache.md). Shares files with
6.1, 6.2 and 6.3. Ruled 2026-11-22 (R3).

- **Eviction is by branch.** A reversal, a redo and a journal
  write-back each evict every entry of their branch.
- **The hook.** 6.7 adds a post-commit hook that `lib/actions` owns and
  the cache registers with, so the delta layer never imports the cache.
  It fires after the commit and before the store sync, which can throw:
  in `reverseAndPruneDeltaRows` (`reverse-replay.ts:929-930`), which a
  journal write-back also commits through, in `reverseReplayGroup`
  (`:991-993`), and after redo's commit (`redo.ts:364`).
- 6.1 and 6.3 leave those commit tails in place. A fork's commit is its
  own batch and fires nothing.
- **The read snapshot adds no required member to `DbCtx`.** About a
  hundred files construct that type (`lib/db/types.ts:41-44`), so a new
  required member would break typecheck for whichever parallel slice
  lands second. 6.7 adds its read as a function beside it, or as an
  optional member.
- **The column-level undo.** The walk needs rollback's
  column-by-column apply, `undoneValue` and `undoneColumn`
  (`reverse-replay.ts:291-309`). 6.7 leaves them where they sit while
  6.1 and 6.3 are in the file, and exports one wrapper keyed by table
  name through the `lib/actions` barrel: the lint rule bans a deep
  import into a `lib/` module, and `undoneColumn` takes a table entry
  that only the unexported `resolveByTable` gives.
- The cache keys on branch and delta id from its first commit, with an
  in-memory test of it from day one. The test seeded in the DB, that
  two branches holding one delta id get distinct entries, can't exist
  before the composite key, so the second of 6.1 and 6.7 to land writes
  it.
- On eviction the History host invalidates or resets its queries. It
  doesn't remove them: a removal doesn't notify a mounted row, which
  would keep its stale prose.
- The second of 6.7 and 6.8 to land gives `isLead` its prose.

### C10 — The lead's surface

Provider: [Slice 6.8](./slices/08-per-branch-lead.md). Consumers: 6.9;
meets 6.1, 6.2 and 6.3.

- **The flag.** `entities.is_lead`, with its `CHECK`, on
  `lib/db/entities/entities.table.ts:16-55`; `isLead` joins the
  register's logged columns (`lib/actions/entities/register.ts:104-117`),
  with its two-branch pair (C5), beside
  [Slice 6.10](./slices/10-register-branch-pairs.md)'s pairs for the
  other handlers.
- **The definition.** `storyDefinitionSchema` loses `leadEntityId` and
  the refine that requires it
  (`lib/db/stories/story-config-schema.ts:52-61`) in the same change as
  the migration. A story open parses the definition
  (`operational.ts:121-123`); the parse drops an unknown key, so a
  stored `leadEntityId` is harmless, but the refine would fail every
  story that needs a lead once the field stops being read.
- **Reads.** `resolveLead` finds the flagged character on a branch from
  the entity map, in place of resolving a story-level id
  (`lib/world/lead.ts:21-29`). A DB read gives a branch's lead to a
  caller with no store, the close; it lives in `lib/db` or `lib/world`,
  not `lib/actions`, whose barrel `lib/pipeline` may not import. The
  needs-a-lead rule moves into `lib`. Two flagged rows read as no lead
  everywhere, and the error canon asks for is logged only by readers
  outside the render path, the actions and the pipelines: a redo
  reapplies a set newest first, one store patch at a time, so a
  render-path selector sees both flags on between two patches of a
  correct redo.
- **Writes.** Set and unset are logged groups on a branch the caller
  names, not `stories.current_branch_id`
  (`set-lead.ts:35-52`). Each new `user_action`, `ai_reply` and
  `opening` stamps `metadata.leadId`.
- **Every entry is stamped.** The migration stamps each existing entry
  with its branch's flagged lead, and every path that creates an entry
  writes the stamp. 6.9's marks read a missing stamp under a flagged
  lead as "no lead", so one unstamped entry would mark every history
  that holds it.
- **A character an entry is stamped with survives a merge it is in.**
  Ruled 2026-11-22 (R4), and extended the same day from the lead to
  every character a stamp on the branch names: a former lead merged
  away would strand the turns written under it just the same. The
  collision dialog fixes the surviving row to that character's, and the
  action refuses a merge whose losing row is flagged or named by a
  stamp, as the backstop; today's refusal covers the flagged row only
  (`lib/actions/world/resolve-collision.ts:43-47`). A pair whose rows
  are both named can't merge: the user renames one or keeps them
  distinct. No merge passes the flag, so three logged writes touch it,
  not canon's four: set, unset and a delete. A stamp can then name a
  missing row only after a delete, which is what 6.9's "gone" mark
  means.
- **What prompts receive.** 6.9's projections carry the computed mark,
  never the raw stamp: a raw id in a context would be given a
  placeholder, and for a deleted character that puts the row back in
  the id map.
- 6.9 starts after 6.8, so these names are whatever 6.8 ships.
- **Meeting 6.3.** The flag and the stamps copy as columns and JSON
  (C3). The second of 6.3 and 6.8 to land adds a lead switch after the
  fork entry to the harness, and stamps the turns the seed appends to
  its fork (C7) with `metadata.leadId`.
- **Meeting 6.1.** 6.1 anchors the `user_action` create's delta on its
  entry (`lib/actions/turns/submit-turn.ts:179`); 6.8 owns that
  function's metadata (`:157`) and its refusal.

### C11 — Shared files

No semantic contract: each slice owns its lines, and land order
resolves the rest.

| File                                                                                                         | Owners                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/reader-composer/[branchId].tsx`                                                                         | 6.2: its raw store reads (three filter lines, two lookups by id, the chapters and entries reads) and the lead selector's map argument. 6.4: hydration, the branch effects, the keyed body, the Actions group, the shell's chip. 6.5: the surface's `onBranch` and the modal's mount. 6.6: the confirm's mount. 6.8: the lead selector, the composer's reason line, the gate before dispatch. |
| `lib/actions/delta/reverse-replay.ts`                                                                        | Per C1 and C9.                                                                                                                                                                                                                                                                                                                                                                               |
| `lib/actions/delta/redo.ts`                                                                                  | 6.1: the survivor write. 6.2: the group's branch. 6.7: the hook.                                                                                                                                                                                                                                                                                                                             |
| `lib/actions/delta/rerun-journal.ts`                                                                         | 6.1 only.                                                                                                                                                                                                                                                                                                                                                                                    |
| `lib/actions/turns/submit-turn.ts`                                                                           | Per C10.                                                                                                                                                                                                                                                                                                                                                                                     |
| `lib/actions/turns/regenerate-turn.ts`                                                                       | 6.2: the clears. 6.8: the refusal and the stamp.                                                                                                                                                                                                                                                                                                                                             |
| `lib/actions/stories/set-lead.ts`                                                                            | Per C6.                                                                                                                                                                                                                                                                                                                                                                                      |
| `lib/actions/stories/delete-story.ts`                                                                        | 6.1: `BRANCH_SCOPED`. 6.2: the stacks. 6.6: the records, and the per-table delete loop lifted into a helper both deletes share.                                                                                                                                                                                                                                                              |
| `lib/actions/stories/operational.ts`                                                                         | 6.2: the hydrate list, for the dead mirrors. 6.4: the switch and its publish. 6.8: the definition parse.                                                                                                                                                                                                                                                                                     |
| `lib/stores/generation/generation.ts`                                                                        | 6.6: `dropBranchRecords`. 6.4: a gate read with no hold, if it adds one.                                                                                                                                                                                                                                                                                                                     |
| `lib/actions/entities/register.ts` and its test                                                              | 6.2: the test's store reads. 6.10: a `branch scope` block appended to the test. 6.8: the flag and its pair.                                                                                                                                                                                                                                                                                  |
| `lib/history/field-labels.ts`, `lib/history/humanize.ts`                                                     | 6.7: the prose. 6.8: the flag's label. 6.1 only checks `humanize.ts` reads the new anchor.                                                                                                                                                                                                                                                                                                   |
| `lib/actions/world/resolve-collision.ts`, `components/world/use-collision-resolve.ts`                        | 6.2: the helper lines. 6.8: the lead refusal's lines.                                                                                                                                                                                                                                                                                                                                        |
| `app/world/[branchId].tsx`                                                                                   | 6.2: the filter lines. 6.8: the lead lines and `Set as lead`'s branch.                                                                                                                                                                                                                                                                                                                       |
| `lib/db/devtools/seed-dataset.ts`                                                                            | 6.3: the fork's rows. 6.8: the definition, the flag and main's stamps.                                                                                                                                                                                                                                                                                                                       |
| `lib/stores/ui/chapter-overlays.ts`                                                                          | 6.2: the filter lines. 6.4: the review window's branch.                                                                                                                                                                                                                                                                                                                                      |
| `eslint.config.js` and `lib/stores/__tests__/generation-mutators-lint.test.ts`                               | 6.6: the record owners. 6.7: any boundary rule its hook needs. 6.3: the owner lists, only if its planning has the fork raise the reversal barrier or carry a record to the child.                                                                                                                                                                                                            |
| `lib/actions/delta/apply-delta-action.ts`                                                                    | 6.1: the read-back at `:220-223`. 6.2: the clears at `:213` and `:390`.                                                                                                                                                                                                                                                                                                                      |
| `lib/pipeline/definitions/generation-context.ts`, `periodic-classifier.ts`, `chapter-close-metadata-call.ts` | 6.2: the filter lines and the map argument (C5). 6.8: the lead lines. 6.9: the projections and inputs.                                                                                                                                                                                                                                                                                       |
| `components/reader/rail/use-rail-data.ts`                                                                    | 6.2: the filter lines. 6.8: the lead lines.                                                                                                                                                                                                                                                                                                                                                  |
| `components/history/history-tab.tsx`                                                                         | 6.2: the store-name filters. 6.7: the rows block and the diff queries.                                                                                                                                                                                                                                                                                                                       |
| `components/chapters/chapter-overlays-host.tsx`                                                              | 6.2: its raw reads. 6.4: the review window's branch. 6.5: the re-run confirm's host.                                                                                                                                                                                                                                                                                                         |
| `lib/db/devtools/seed-dataset.test.ts`, `scripts/seed/`, `e2e/harness/seed.ts`                               | 6.3: the fork. 6.8: the flag and stamps. 6.4: reads the harness only. 6.6: a run-row helper in the harness.                                                                                                                                                                                                                                                                                  |
| `electron/main.ts`, `electron/preload.ts`, `electron/db/types.ts`, `types/db-bridge.d.ts`                    | 6.7 only, if its planning picks a batched read; with `electron/db/service.ts`, `lib/db/runtime/client.ts` and its native twin.                                                                                                                                                                                                                                                               |
| `app/chapter-timeline/[branchId].tsx`, `components/compounds/use-memory-run-banner.ts`                       | 6.2: their raw reads. 6.4: the branch passed to the review window.                                                                                                                                                                                                                                                                                                                           |
| `scripts/classifier-eval/fixture.ts`                                                                         | 6.8: the stamp on its rows. 6.9: its probe's renderer.                                                                                                                                                                                                                                                                                                                                       |

### C12 — Canon and flips

- **The rulings land in canon first.** R1, R2, R3 and R4 change canon,
  and go through one `aventuras-design` pass. No slice starts the tasks
  a ruling governs before that pass lands: 6.1's recovery scoping and
  its read of a branch's unfinished runs (the column, its backfill and
  the delete cascade's entry are schema work, generated with the
  `deltas` rebuild, and wait for nothing); 6.3's
  refusal and its current-branch write; 6.4's switch; 6.5's After
  confirm and re-run route; 6.6's delete and duplicate refusals; 6.7's
  eviction; 6.8's merge dialog, its fixed surviving row and its copy,
  and the refusal's reach to a row a stamp names. Everything else in
  those slices starts without it. 6.8's refusal of a merge whose losing
  row is the flagged lead isn't gated: it is today's behavior, which R4
  keeps, and it has to land with the change that lets the lead be
  deleted, since today the refusal fires from the delete handler that
  change opens up.
- **Each slice's PR makes the canon edits its doc lists.** Among them:
  6.3 renames canon's `planReversal` and `targetBranchId` to what
  ships; 6.6 records the asset-trash deferral on canon's branch-delete
  paragraph; 6.7 amends the walk for held copies.
- **Flips.** 6.5 enables `Re-run on new branch`, which M5 shipped
  disabled, and flips the story and E2E assertions that pin it so. 6.5
  passes `onBranch`, and 6.6 passes `StoryCard`'s `onDuplicate`
  (`components/story/story-card.tsx:26`); both controls render only
  once passed, so neither ships disabled.
- **Forward pointers.** Each comment or string that names M6 or states
  the single-stack or story-level-lead model as fact goes with the
  slice that removes what it describes.

## Definition of done

- **Same ids, two branches.** The `deltas` migration applies to a
  populated database under both runners. On two branches sharing delta
  ids, CTRL-Z, rollback, redo, a journal write-back and boot recovery
  on one leave the other's rows and deltas untouched (vitest). The
  chapter re-run E2E stays green across the migration.
- **Unfinished runs.** A branch with an unfinished run refuses a
  duplicate, refuses a fork that would carry the run's writes, and
  forks from an entry before them. Deleting such a branch leaves boot
  recovery nothing to reverse and no sibling touched (vitest).
- **Fork.** For every harness fixture and each of the four journal
  cases, the child equals a copy of the parent rolled back to the fork
  entry, and the parent is untouched. Captures stay on the parent
  (vitest). The vector copy is probed on Electron and Android, and the
  result is in Slice 6.1's notes.
- **Scoped reads.** No inline branch filter over store rows remains
  outside the accessor, and no store exposes a row read without a
  branch: a type-level pin fails `pnpm typecheck` on one (6.2). Every
  one of the 55 registered handlers has a two-branch test that fails
  when its branch condition is removed (vitest, with a mutation check
  per handler; 6.10).
- **Redo.** Undo on one branch, switch away: Redo is absent there, and
  present on return (vitest in 6.2; Slice 6.4's E2E). A fork leaves the
  parent's Redo (vitest in 6.3; Slice 6.5's E2E).
- **Switching.** The chip shows on a multi-branch story; the navigator
  lists branches current first, switches, renames and pauses during a
  run; `Browse branches…` opens it on a single-branch story;
  `stories.current_branch_id` follows a switch, and Story Settings'
  breadcrumb returns to the branch switched to (E2E; Storybook at three
  tiers).
- **Creation.** `⎇` on a reply, a name and Create land the reader on a
  branch holding the parent's state as of that entry.
  `Re-run on new branch` forks, switches, starts the re-run there, and
  Back lands on the Story List (E2E).
- **Delete.** Deleting a branch removes its rows from every
  branch-scoped table and vector family, re-parents its children, and
  drops its run rows, records and redo stack; the count line matches
  the entries no other branch holds (E2E; vitest).
- **Duplicate.** One branch and all branches copy into a new story with
  fresh story and branch ids and every other id kept; CTRL-Z in the
  copy leaves the source alone; `Open` opens it (E2E; vitest).
- **Diff prose.** World and Plot History show before-and-after prose
  for an update, fall back to field names on a miss, and still show
  the right values after an undo and a redo (Slice 6.7's E2E). That
  flow passes with no eviction at all, so the eviction is proven
  separately: after a reversal rewrites a surviving delta's prior
  value, the cache and the host show the rewritten value (vitest). One
  of those tests runs a real reversal against the cache as the app
  registers it, so a missing registration fails it; a test that calls
  the cache or the hook directly can't. It joins the E2E only if 6.7's
  planning finds a UI path that leaves such a survivor.
- **The lead.** A pre-M6 database migrates under both runners and every
  story opens.
  `Set as lead` is one undoable group; deleting the lead is allowed,
  and a collision merge keeps the lead's row; every existing entry
  carries its branch's lead after the migration; a branch that needs a
  lead and has none refuses
  Send, regenerate, Retry and Save & regenerate, with its reason line
  and the draft kept; every new entry carries its lead (vitest; E2E).
- **The lead in prompts.** A story whose lead never changed gets no
  mark and no "except where a turn names another" clause in any prompt:
  the paths that only gain marks render as before, and the paths canon
  gives new lines (the chapter calls' lead and narration, each close
  task's lead line, the third-person rule) change in those lines alone.
  One with a switch renders its marks; summaries and happening
  descriptions are told in the third person; the classifier probe on
  the dev model is recorded (vitest; `pnpm probe:classifier`;
  `pnpm probe:close`).
- **Hygiene.** Every new chrome string routes through `t()`;
  `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs` and the full vitest
  suite pass on every slice's PR; every new compound has Storybook
  stories; the forward pointers and canon lines the promises sweep
  named flip with their work.

## Open questions

- **Unaudited.** The contract audit ran two rechecks and stopped, as
  planned. The last round's fixes weren't rechecked: C1's pin that a
  row target's branch is the branch the plan writes, with `undoDelete`'s
  child key and patch following it and the children stamped on copies;
  6.3's two harness fixtures, a delete of a character with a
  relationship and an awareness row after the fork entry, and the
  tombstone re-insert's four-write construction; the rule for 6.3's
  tests before 6.1 merges; and 6.6's canon edit for a delete that
  refuses under the gate. The tombstone construction has two readings
  of the code behind it, the auditor's and Slice 6.3's writer's, and no
  run. What the slice writers' reports changed after the audit is
  unaudited too: C2's third backfill source, C5's raw-read rule (which
  6.2's planning replaced with the stores' signatures), C6's group
  branch, C7's core and its seed turns, C8's step order, its
  failed-load rules and the stack replacement, and C10's stamping rule
  and R4. The final audit's fixes had no audit of their own either:
  C8's hold from a switch's or a fork's start to its navigation, its
  abandoned-switch rule and its refresh order, none of which the
  planning session walked in the code; R4's reach to every stamped
  character; C7's predicate default for the survivor copy; C10's rule
  for where the two-flags error is logged; C12's narrower gate on 6.1;
  and the "second to land" criteria. Read them all at slice planning.
- **Canon batch: landed 2026-11-22.** Four rulings were made at
  promotion (2026-11-22), and one `aventuras-design` pass landed them,
  so the tasks C12 gates can start. Its check of R1 against
  `lib/actions/delta` added a third fork refusal, approved the same day:
  an unfinished re-run whose reversal committed, when the plan keeps its
  chapter. A create the plan re-owns doesn't count as carried. What each
  ruling is, and the canon it changed:
  - **R1, unrecovered runs (C2).** `pipeline_runs` gains a branch;
    recovery scopes by it; a duplicate refuses a branch with an
    unfinished run; a fork refuses only when the copy would carry one;
    a branch delete removes the branch's run rows and its hold. Canon:
    `generation-pipeline.md` (Invariants' `actionId` bullet,
    Recovery-failure policy, Startup recovery pass, the `pipeline_runs`
    table under Crash recovery, Multi-run txState's "both records" and
    "nothing clears"); `data-model.md` (Branch model's pre-conditions
    and plan step, its manifest, which gains a
    `pipeline_runs` row and whose `probe_captures` row says "the only
    branch-scoped table the fork skips", and Deleting a branch; Story
    deletion, which calls `pipeline_runs` story-scoped; Story
    duplicate's refusals); `memory/probe.md` (the same "only" claim);
    `memory/chapter-close.md`, Re-running a close (the blanket
    `'running'` refusal among fork's pre-conditions);
    `story-list.md`, Duplicate a story (no
    refusal line for an unfinished run); `code-conventions.md`, Syncing a store after a write (the owners of `dropBranchRecords`);
    `parked.md` ("fork refuses a held branch").
  - **R2, the switch (C8).** A switch replaces the in-story stack and
    gives a fresh reader; the composer's draft doesn't carry; a switch
    is one action and not a story open; it and a fork hold the reader
    until their navigation; switching pauses during a suggestion
    refresh. Canon: `branch-navigator.md` (the row press, During
    generation, which also says generation depends on the
    `current_branch_id` mutation, and After confirm);
    `reader-composer.md` (Loaded-set model's branch switch, the Edge
    cases line that a refresh aborts on a switch, the composer draft);
    `principles.md` (What's gated gains branch delete; a branch held
    until a restart still lets the user switch away); the held re-run's
    error toast now reads "this branch can't be changed", and its string
    in code changes with 6.4, which makes switching live.
  - **R3, diff-cache eviction (C9).** A reversal, a redo and a journal
    write-back evict their branch's entries. Canon: `architecture.md`, Delta history diff resolution (Cache shape and lifecycle;
    Concurrency, rollback, error path); the two lines that say only a
    reversal rewrites a prior value (`generation-pipeline.md`,
    Reverse-replay; `data-model.md`, the delta log) say a redo puts it
    back.
  - **R4, stamped characters and merges (C10).** A character that the
    lead flag or an entry's stamp names survives a merge it is in; no
    merge passes the flag. Canon: `data-model.md`, The lead (four
    writers become three; the merge bullet); `world.md`, Merge (the surviving-row picker and the flag line);
    `patterns/collision-resolve.md` (the default canonical and Merge's
    submit rule); `reader-composer.md`'s undo-target row for a lead
    write. `principles.md`, Mode, lead, and narration, doesn't name the
    merge.
- **Sizes.** 6.6 is planned at 19, and delete and duplicate share only
  the refusal read and the branch read. If its plan skeleton passes 20
  it splits in two, branch delete and story duplicate. The redo map
  stays in 6.2 either way: 6.4 needs it before it lands. 6.1 is planned at
  16 and gates two landings; if R1's recovery work grows it, the copier
  moves to 6.3 and duplicate waits on the planner. 6.3's planner is
  priced by analogy, with no close precedent. M5's plans held 3 to 7
  tasks more than its planning estimates, so check each at its plan
  skeleton. 6.2 was planned at 15 and was nearer 17: its sweep is 111
  raw reads in 36 files, and its register tests cover 55 handlers, not
  the 39 first counted. Its planning (2026-11-23) split the register
  two-branch tests off into 6.10, since nothing waits on them and 6.4's
  landing would have; 6.2's plan holds 17 tasks without them. 6.8 was
  planned at 17 and is
  nearer 19 after R4's reach to stamped characters and the tests the
  final audit added; check it against the same line.
- **6.3 beside 6.1.** 6.3 starts in `reverse-replay.ts` while 6.1 edits
  it, on C1's line ownership. If 6.3's plan can't test anything before
  it splits the op list `buildUndoOps` builds, the edge becomes
  blocking and the planner starts after 6.1.
- **Unverified.** Whether `replace` to the same route pattern mounts a
  fresh reader (C8's key covers either answer); the vector copy on
  Electron and Android; whether a gorhom Sheet presents while another
  dismisses, for `Browse branches…` on phone; what drizzle-kit
  generates for the `deltas` rebuild. Each is a first task of the
  slice resting on it.
- **Unmeasured costs.** A fork and a duplicate are one batch each, and
  a batch blocks a thread on both platforms: the main process on
  desktop, the JS thread on Android. 6.3 measures a fork and 6.6 a full
  duplicate on the dataset story. A bad number reopens that slice's
  approach, not the layout.
- **Prompt changes on the dev model.** 6.9 adds instructions to
  classifier prompts tuned to the dev model, the capability floor. Its
  probe run says whether they hold; a miss reopens the wording, not the
  slice.
