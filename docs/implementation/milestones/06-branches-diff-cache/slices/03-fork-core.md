# Slice 6.3 — Fork core

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** none to start. Lands after
  [Slice 6.1](./01-copy-substrate.md), whose composite `deltas` key,
  branch-scoped delta writes and restore stamp
  ([C1](../milestone.md#c1--delta-rows-on-two-branches)), read of a
  branch's unfinished runs
  ([C2](../milestone.md#c2--run-records-and-the-copy-refusal)) and copier
  ([C3](../milestone.md#c3--the-manifest-and-the-copier)) the fork rests
  on. It starts beside 6.1 in the planner's row-level code, on C1's line
  ownership. The refusal and current-branch write tasks wait on the
  design pass that lands R1 and R2 in canon
  ([C12](../milestone.md#c12--canon-and-flips)). Reads
  [Slice 6.2](./02-scoped-reads-redo.md)'s redo map when it is on main,
  with no edge ([C6](../milestone.md#c6--one-redo-stack-per-branch)).
- **Blocks:** [Slice 6.5](./05-fork-from-reader.md). The rebuilt
  `br_hero_fork` is read by [Slice 6.4](./04-switching-navigator.md),
  [Slice 6.6](./06-delete-duplicate.md) and
  [Slice 6.8](./08-per-branch-lead.md) under C7's seed rule, with no
  edge. Two order-free meets give whichever lands second a job, an
  acceptance criterion here written "if the other has landed": with
  6.8, the harness's lead switch and the `metadata.leadId` stamps on
  the seed fork's own turns
  ([C10](../milestone.md#c10--the-leads-surface)); with 6.2, the check
  that a fork's child starts with an empty redo stack
  ([Dependency graph](../milestone.md#dependency-graph)).

## Goal

`forkBranch` exists and is proven equal to canon's definition of a
fork: a snapshot of the parent rolled back to the fork entry, committed
in one transaction, with the parent untouched. The slice delivers the
reversal planner's write branch, the fork's copy on 6.1's copier, the
action with its refusals and its lock, an equivalence harness whose
fixtures reach every restore path, the fork case of the captures test,
the dev seed's `br_hero_fork` rebuilt as a real fork with turns of its
own, and a fork's measured cost. [Slice 6.5](./05-fork-from-reader.md) puts it behind `⎇`
and `Re-run on new branch`.

## Background

Canon defines a fork from entry `N` as the parent's state, delta log and
journal set, less probe captures and a system tail, rolled back to `N`;
the parent and its redo stack stay as they were, and the child starts
with an empty stack. It is planned on the frozen parent with rollback's
sweep and executed on the child in one batch. Canon calls that planner
`planReversal` with a `targetBranchId`, and neither exists: the shipped
planner, `buildReverseAndPrunePlan`, reads and writes one branch, so
running its plan as it stands would rewind the parent. This slice gives
it a write branch, with rollback the case where the two are equal, and
proves each fork against a plain copy of the parent rolled back by the
shipped rollback.

## Required reading

- [`data-model.md → Branch model`](../../../../data-model.md#branch-model),
  whole: the definition, pre-conditions, the single-transaction
  execution, the four journal cases, the manifest, `classifier_status`
  at fork and the primary-key paragraph. R1's canon pass replaced the
  blanket refusal of a parent whose `classifier_status.state` is
  `'running'` with step 1's unfinished-run refusal (C2).
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor):
  the window predicate `resolveSweep` builds.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback),
  the "One redo stack per branch" paragraph.
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay):
  the yield rule, the closure, held deletes, the re-run journal and its
  drop rule, and "Restored rows always stamp the executing branch's
  `branch_id`".
- [`generation-pipeline.md → Branch write lock`](../../../../generation-pipeline.md#branch-write-lock).
- [`generation-pipeline.md → Recovery-failure policy`](../../../../generation-pipeline.md#recovery-failure-policy),
  its last paragraph ("a branch from an entry before the orphan starts
  idle and can"), and
  [`Invariants`](../../../../generation-pipeline.md#invariants), the
  `actionId` bullet.
- [`generation-pipeline.md → Multi-run txState`](../../../../generation-pipeline.md#multi-run-txstate):
  `deferred`, `pendingClose`, `pendingRerun`, `heldBranches`.
- [`memory/classifier.md → Persistence`](../../../../memory/classifier.md#persistence):
  `processedThrough` and the clamp.
- [`memory/chapter-close.md → Re-running a close`](../../../../memory/chapter-close.md#re-running-a-close):
  the fork's second caller and how it picks `N`.
- [`memory/probe.md → Branch fork and capture portability`](../../../../memory/probe.md#branch-fork-and-capture-portability).
- [`branch-navigator.md → After confirm`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#after-confirm)
  and
  [`During generation`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked),
  for the caller's side.
- [`testing.md → Fixture + seed contract`](../../../../testing.md#fixture--seed-contract).
- [`code-conventions.md → Action layer`](../../../../code-conventions.md#action-layer).
- [`dev-environment.md → What a slot owns`](../../../../dev-environment.md#what-a-slot-owns),
  for the slot AVD the device runs use, and
  [`Measuring on a release build`](../../../../dev-environment.md#measuring-on-a-release-build).
- The milestone's [C7](../milestone.md#c7--fork) in full, and
  [C1](../milestone.md#c1--delta-rows-on-two-branches),
  [C2](../milestone.md#c2--run-records-and-the-copy-refusal),
  [C3](../milestone.md#c3--the-manifest-and-the-copier),
  [C6](../milestone.md#c6--one-redo-stack-per-branch),
  [C9](../milestone.md#c9--the-diff-caches-seams),
  [C10](../milestone.md#c10--the-leads-surface),
  [C11](../milestone.md#c11--shared-files),
  [C12](../milestone.md#c12--canon-and-flips) and the milestone's
  [Open questions](../milestone.md#open-questions).

## Scope: in

Code paths below are at `8b5da25ac`. `reverse-replay.ts` is
`lib/actions/delta/reverse-replay.ts`.

### The planner's write branch, before 6.1 merges

C1 splits `reverse-replay.ts` while both slices are in it. 6.1 owns
`reownOrPrune` (`:178-187`), the held-payload rewrite (`:363`), the
survivor rewrite (`:818`), the stamp in `emitInsert`, `undoDelete`'s
children (their stamp, key and patch), `redo.ts` and `rerun-journal.ts`.
6.3 owns `rowTargetOf` and the row target's shape (`:468-497`),
`emitUpdate`, `emitDelete`, `clearRef` (`:756-768`) and the walk's read
in `rowStateOf` (`:499-513`).

- `buildReverseAndPrunePlan` (`:171`) gains a write branch, the set's
  own branch when a caller names none. Every read stays on the set's
  branch, the parent: the closure, the chains, the held rows, the
  journal heads, `liveLinks` at `:629`, `strandedWritesOf` and
  `refuseWriteBack`.
- `RowTarget.branchId` becomes the write branch, building the target's
  `where` for writes, its key in `rowStates` and its patch (C1). A
  second `where`, on the read branch, serves the walk's row read in
  `rowStateOf` (`:502-505`), which C1 gives to 6.3. `undoTargetOf` (`:495-497`)
  builds both from the plan's two branches, never from `delta.branchId`
  alone.
- `clearRef` targets the write branch and reads the parent.
- `emitUpdate` and `emitDelete` write the child. Patches name the
  child, and a fork emits none (below).
- **Tests in this stretch.** Fixtures with updates, creates whose undo
  deletes their row, and ref clears, run on a child hand-seeded with
  copies of the parent's domain rows and no deltas, since `deltas` is
  still keyed by `id`. Restores can't run on a fork yet: until 6.1's
  stamp, `undoDelete`'s target and children and the tombstone re-insert
  insert the row as its payload or the parent's read names it, onto the
  parent. And `ops` still carries the held-payload and survivor
  rewrites by `deltas.id` and the vector sweeps on the delta's branch,
  so a fixture with a held copy, a survivor or a swept row asserts the
  op list without running it (C1).
- Every other reversal passes no write branch. The shipped suites under
  `lib/actions/delta/`, `lib/actions/story-entries/` and
  `lib/actions/chapters/` are the regression net for rollback, CTRL-Z,
  redo, regenerate, abort and the re-run.

### The planner after 6.1 merges

At 6.1's lines, per C1's last bullet:

- The held-payload rewrite, the survivor rewrite and the re-own take
  the plan's write branch where 6.1 put the delta's, so each writes
  `(child, id)`.
- `reownOrPrune` separates the re-owns from the prune deletes, and the
  vector sweeps (`:821-823`) separate from the row writes in `ops`, so a
  fork runs one without the other. `journalOps` already sits apart; a
  fork leaves it out.
- `ReversePlan` (`:81-109`) keeps its fields, so
  `reverseAndPruneDeltaRows`, `reverseReplayGroup` and the journal's
  `opsFromPlan` read it unchanged, and gains what the split needs.
- 6.1's restores read the row target's branch (C1), so with the write
  branch in place `undoDelete`'s target and captured children (stamp,
  key at `:659`, patch at `:666`) and the tombstone re-insert
  (`:732-738`) land on the child with no further edit. No stamp, key or
  patch in the walk reads `delta.branchId`.

### The fork's copy

- On 6.1's copier, whose signatures are what 6.1 ships (C3): every
  table the manifest has a fork copy, `story_entries` with
  `kind = 'system'` left out. `probe_captures` and `pipeline_runs` are
  not copied.
- `deltas`: every row but the plan's prune set, `plan.prunedDeltas`,
  which is canon's `(set.rows \ reowned) ∪ prunedHolders ∪ strandedWrites`
  (`reverse-replay.ts:188-189`); a re-owned create copies and takes its
  re-own. `reversal_journals`: every row but `plan.droppedJournals`.
  The prune set is never one bound id list: a fork near the start of a
  long story removes more ids than SQLite binds
  (`lib/db/bind-limit.ts:3`).
- **The survivor copy is a SQL predicate (C7).** Most of the prune set
  is the rollback window, which `resolveRollbackWindow` already builds
  as a predicate (`story-entries/operational.ts:279-284`); `resolveSweep`
  returns the window's rows, not that predicate, so it exposes it for
  the copy. Two short id lists cover the rest: the deltas the plan
  prunes outside the window (the closure's additions, the pruned
  holders and the stranded writes), and the creates the plan re-owns,
  which are kept. So a delta copies when it is outside the window and
  outside the first list, or in the second. This holds only while every
  window row is in the plan's set, which the closure keeps; Acceptance
  criteria 10 checks it. Dropped journals
  are one row per re-run, so their action ids bind as a list too. The
  predicate is evaluated inside the batch, under the lock, so it reads
  the parent as the plan did. With no `B` there is no window, and every
  delta copies.
- **The fallback, a temp table inside the batch.** If planning finds
  either short list can pass the bind cap, the excluded ids go through a
  temp table created, filled in chunks and dropped inside the batch.
  Before it is built, a check runs that exact batch shape, table
  creation included, on desktop and on the slot AVD through
  `app/dev/db-check.tsx`, as 6.1's vector probe does: the Android batch
  runs inside `withTransactionSync`
  (`lib/db/runtime/transaction.native.ts`), and vec0 table creation is
  already kept out of the desktop batch (`lib/db/runtime/exec.ts:3-5`).
  This check blocks the slice, unlike its other device runs.
- Vectors last, by 6.1's vector ops, filtered to rows the child's
  source tables still hold after the rewind. A row the rewind restored
  or changed carries `embedding_stale = 1` from the planner
  (`:533-537`, `:558`, `:642-643`).
- With no `B` (`N` is the narrative tail) the plan is empty and the
  copy takes every non-system row, every delta and every journal.

### `forkBranch`

C7's action: the parent branch, the fork entry `N`, a name and whether
to make the new branch current; it returns the new branch's id or a
typed refusal. It lives in `lib/actions` (suggested:
`lib/actions/stories/fork-branch.ts`) and is exported through
`lib/actions/index.ts`.

- **The core.** `forkBranch` wraps a core that also takes the new
  branch's id and its creation time (C7). The action mints a `br_` id
  and reads the clock; the seed passes `br_hero_fork` and a fixed time,
  so the fixture stays deterministic. Everything below is the core's,
  refusals and lock included, so the seed's fork refuses and locks as
  the reader's does.

- **`B` and the plan.** `B` is the earliest non-system entry on the
  parent after `N`. `resolveSweep(parent, B)`
  (`lib/actions/story-entries/operational.ts:306-334`) gives the window
  and the closed set; the fork discards its `clampOps` (`:329`), which
  clamp the parent's watermark. The plan is
  `buildReverseAndPrunePlan` with the child as its write branch and
  `keepRedoExact: false`, as rollback's.
- **Refusals, before any write.** Each returns its own typed code, and
  C7 pins every one:
  - **The gate is closed.** The gate leaves out the branch's hold, as
    the switch's does
    ([C8](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row)):
    R1 judges a held parent by its run row (below), and R1's fork from
    an entry before a leftover run's writes needs a held parent to be
    forkable. So it is `isUserEditBlocked(txState)` read with no branch
    (`lib/stores/generation/generation.ts:89-93`): a registered
    hard-gate run, a pending turn or a reversal. Not the store's
    convenience read (`:404-405`), which adds the open branch's hold.
    The read takes no caller's mark: 6.5's parent-side checks hold
    none, since this gate counts every pending turn.
  - **An embedder swap is pending** on the parent's story
    (`isStorySwapPending`, `lib/embedder-swap/app-deps.ts:165-169`). It
    sees a persisted marker only on the open story, which is where the
    reader forks from; the seed has none.
  - **`N` is missing** on the parent, **or is `system`**.
  - **An unfinished run the copy would carry** (R1, C2): for an
    unfinished run row of the parent, from 6.1's read, a delta of that
    run the plan doesn't prune or re-own, its journal the plan doesn't
    drop, or, for a re-run whose reversal committed (`rerun_chapter_id`
    set), its chapter the plan keeps
    ([`data-model.md → Branch model`](../../../../data-model.md#branch-model)).
    This replaces canon's blanket refusal of a parent whose
    `classifier_status.state` is `'running'`. A fork from an entry
    before the run's writes goes ahead.
  - **The sweep refuses**, passed through: a fork point whose next
    entry `B` has no create delta, which `resolveSweep` reads as
    `rollbackFloor` (`operational.ts:268-273`), and a reversal the
    closure or the planner refuses as a `ReversalIntegrityError`, which
    canon has abort the fork before any SQL runs.
- **The lock.** The parent's branch write lock, held exclusive
  (`lib/actions/delta/branch-write-lock.ts:86-101`) from before the
  first plan read until the commit, and released in a `finally`. The
  refusal reads run once the hold is granted: a delta-logged write
  queued ahead of the hold commits before the plan reads, and a run
  admitted while the fork holds it can write only after the commit, on
  the parent. The hold's id is unique per call:
  `holdBranchWriteExclusive` is idempotent per id (`:82-89`), so two
  forks of one parent under one constant id would share a hold, and the
  first release would free the second mid-plan.
- **The `branches` row.** The core's id; the parent's `story_id`;
  `parent_branch_id` the parent; `fork_entry_id` `N`; the name as the
  caller gives it (the creation modal trims it, C8); `created_at` the
  core's time; `classifier_status` idle with
  `processedThrough = min(parent's, position(N))`, written whole
  (`lib/classifier/status.ts:3-19`).
- **The batch.** One `runInTransaction`, in canon's order: the
  `branches` row; with make-current, `stories.current_branch_id` (R2),
  so the branch and the pointer commit together; the copier's ops with
  the plan's exclusions; the plan's ops on the child (row writes, ref
  clears, held-payload and survivor rewrites, re-owns); the vectors.
  The prune deletes, `journalOps` and the vector sweeps are left out.
- **Nothing else.** It clears no redo stack (C6), so it can't commit
  through `applyDeltaAction` or `commitNewAction`, both of which clear
  (`lib/actions/delta/commit-new-action.ts:24,27`), nor through
  `reverseAndPruneDeltaRows`, which runs the prunes and emits the
  patches (`reverse-replay.ts:914-930`). It fires no eviction (C9: a
  fork's commit is its own batch), emits no store patch, refreshes no
  branch list and navigates nowhere. Its callers show the branch (C8).

### The equivalence harness

A suite (suggested: `lib/actions/stories/fork-equivalence.test.ts`)
that runs each fixture the same way:

1. Build the parent through the action layer, then seed its vectors,
   since the action layer writes none: with
   `lib/db/__tests__/vec-fixtures.ts`, in two dimension families, a
   vector for a row the window creates, one for a row it keeps
   (`seedVec`), and one for a row it restores (`plantVec`, since the
   parent's delete left that row no live source). Without them the
   vector comparison and the sweep mutation below pass on empty tables.
   Then snapshot the parent: every manifest table, `deltas`,
   `reversal_journals`, every vector family, its `branches` row and its
   redo stack.
2. Fork at `N`.
3. Build the reference: 6.1's copier copies the parent, with
   `kind = 'system'` entries left out, into a third branch, which the
   shipped rollback rolls back to `N` (`sweepToEntry` on target `B`,
   with the counts `getRollbackCounts` gives; nothing when there is no
   `B`). The rollback clears the redo stack, so the parent's stack is
   read before it.
4. Compare the child with the reference table by table, `branch_id`
   aside: every manifest table, `deltas` (id, log position, source,
   entry, action, payload), `reversal_journals`, and each vector family
   by id, `model_id` and embedding bytes. Compare the parent with its
   snapshot on all of those, its watermark and its redo stack.

The child's `classifier_status` is asserted by canon's rule, not against
the reference: a rollback clamps to `position(B) − 1` and keeps the rest
of the status (`lib/actions/story-entries/prose-reversal.ts:82-93`),
where a fork writes idle with `min(parent's, position(N))`.

The fixtures:

- **A delete inside the window.** After the fork entry, the parent
  deletes a character holding a relationship and an awareness row, with
  a turn's `retrievalCount` bump on that awareness row earlier in the
  window. The character, the relationship and the awareness row land on
  the child with the bump undone, and none lands on the parent. This is
  the only fixture that reaches `undoDelete`'s captured children on a
  fork, whose insert is separate from `emitInsert`
  (`reverse-replay.ts:641-655`), and the bump's undo reaches the
  restored row only through the child's key at `:659`. A held delete is
  not this: it is a delete outside the set whose payload the plan
  rewrites, and it inserts no row.
- **The tombstone re-insert** (`reverse-replay.ts:732-738`), which the
  shipped test with a similar title
  (`lib/actions/delta/reverse-replay-user-writes.test.ts:805`) never
  reaches: its clear becomes a delete. Before the fork entry, pair R
  holds `kind: 'k'` and `inverseKind: 'w'`. After it, two writes on
  entries the window removes: one clears `kind`, and a later one sets
  it to `'b'`. Then a write clearing `inverseKind`, anchored on an entry
  before the fork point so the window spares it (a World edit carries
  no entry and would be swept). The walk undoes the `'b'` write first,
  leaving R with no view, so it tombstones R; it then undoes the clear,
  which gives `kind: 'k'` back and re-inserts R. R on the child reads
  `kind: 'k'`, `inverseKind: null`, and the parent's R is unchanged.
- Held deletes, survivor rewrites, a kept create (a machine create a
  user write kept, re-owned on the child), and ref clears (a place's
  parent and a character's faction).
- A close spanning the fork entry, and the `entry_assets` rewind.
- **The four journal cases.** Each asserts the child's journals equal
  the reference's and names which way it went. The shared drop rule
  (`journalsToDrop`, `lib/actions/delta/journal-drop.ts:18-45`) decides, not canon's
  four-case summary, which it extends with a rewritten holder at or
  below the floor.
- A parent ending in an error card: the copy leaves it out, which a
  rollback can't, since it has no delta.
- `N` the narrative tail, with no `B`.
- **A lead switch after the fork entry**, if
  [Slice 6.8](./08-per-branch-lead.md) has landed (C10; whichever of
  the two lands second writes it): 6.8's logged set of another
  character as lead. A set is the switch: no merge passes the flag
  (R4). The child's flagged row is the parent's lead as of `N`, and the
  parent keeps the character it switched to.

Beside the harness:

- **CTRL-Z on the child.** A fork whose copy carries a delete from
  before `N`, with captured children: `undoLastAction` on the child
  restores the row and its children on the child, and the parent's rows
  and deltas don't change.
- **The parent's Redo.** An undo on the parent before the fork leaves a
  group on its stack; after the fork that group is still the parent's
  top. This is the unit half of the milestone's "a fork leaves the
  parent's Redo"; 6.5 carries the E2E half. Before 6.2 lands the stack
  is one array, and the assertion is that the fork left it as it was.
- **The child's empty stack**, if
  [Slice 6.2](./02-scoped-reads-redo.md) has landed (whichever of the
  two lands second writes it): `hasRedo` on the child is false after a
  fork whose parent holds a redo group. It can't be written before
  6.2's map gives the child a stack of its own.

### Captures

The fork case in `lib/probe/fork.test.ts`, beside the duplicate case
6.1 writes (C3): a parent holding captures forks, the child holds none
and the parent all of them.

### The seed's fork

`br_hero_fork` holds twelve entries of its own and no entity
(`lib/db/devtools/seed-dataset.ts:292-312`) and names a fork entry it
doesn't hold (`:2245-2251`).

- It is rebuilt by running the fork's core at seed time on
  `br_hero_main`, with `br_hero_fork` as its id and a fixed creation
  time (C7). It keeps its id, its name and its parent. Its static rows
  go: `forkEntries()`, the create deltas `entryCreateDeltas` builds for
  them (`:1364-1386`) and its branch row. It then holds main's entries
  through its fork entry, under their ids.
- **Turns of its own.** The seed then appends a few turns to the fork
  (C7), continuing from `N` as a played branch would and ending on a
  reply. Each entry gets a create delta as main's entries have
  (`entryCreateDeltas`: its own action, a null anchor, `user_edit` for a
  `user_action` and `ai_classifier` for a reply), at log positions after
  the fork's highest. Their ids are the fork's alone, so a branch
  delete's count of entries no other branch holds reads that number,
  and [Slice 6.6](./06-delete-duplicate.md)'s confirm shows a real one.
  Their content and metadata follow main's entries of the same kind.
- **Their lead stamps**, if Slice 6.8 has landed (C10; whichever of the
  two lands second writes them): each appended `user_action` and reply
  carries `metadata.leadId` naming the fork's flagged row, the copy of
  main's lead, as main's entries do. An unstamped turn under a flagged
  lead would read as written under no lead in every prompt once
  [Slice 6.9](./09-lead-in-prompts.md) marks lead changes.
- The fork entry stays `entry_hero_0040` unless the action refuses a
  `user_action` fork point: entry 40 is one (`heroKind`, `:245-250`).
- **The watermark.** The fork writes `min(parent's, position(N))`. Once
  the turns are appended, the seed parks the fork's watermark at its
  last non-system entry, as `parkedClassifierStatus` (`:2175-2190`) does
  for every seeded branch, so the seed contract holds there too.
- It runs wherever the seed runs: `pnpm db:seed` (`scripts/seed/index.ts`),
  which every E2E spec's setup calls (`e2e/harness/seed.ts:23-34`), and
  the on-device reseed (`lib/db/devtools/reseed.native.ts`).
- What it breaks, fixed in this slice:
  - `lib/db/devtools/seed-dataset.test.ts:795-799`, the fork's
    `processedThrough: 12`, read from the static steps; the fork's
    watermark is asserted on a seeded database instead (Acceptance
    criteria, 20).
  - `scripts/seed/dataset-story.test.ts:17,180` and
    `scripts/dataset-chapter/seed-export.test.ts:55,71`, which read the
    fork's rows, its own entries included, from the static steps. Its
    entries, copied and appended, now come from the seeded database.
  - `e2e/tests/embedder-drain.spec.ts:82-88`. Its absence assertion
    holds only while no embeddable row sits on the fork. The fork's
    copies are stale rows on a non-open branch, which keep a
    story-wide count the drain never clears
    ([`parked.md → Staleness pill on non-open branches`](../../../../parked.md#staleness-pill-on-non-open-branches)).
    The assertion keeps its meaning, for instance with the fork's rows
    marked clean before launch as `markEntitiesEmbeddingStale` marks
    rows stale (`e2e/harness/seed.ts:167`), and isn't deleted.
  - The comment at `e2e/harness/seed.ts:378-381`, which describes the
    old fork ending on a `user_action`; the new one ends on a reply.

### Cost

A fork timed on the dataset story (`pnpm db:seed:dataset`) at its
earliest reply, where the copy excludes and the plan reverses the most,
and at its tail: in the running app on desktop, where the batch runs in
Electron's main process, and on the slot AVD, where it runs on the JS
thread. A dev-only entry point under `app/dev/` triggers it, since no UI
forks until 6.5. The numbers go in Implementation notes. The AVD's
number is indicative only
([`dev-environment.md → Measuring on a release build`](../../../../dev-environment.md#measuring-on-a-release-build)).
A bad number reopens this slice's approach, not the layout. The Android
run never blocks the slice.

### Forward pointers

- `lib/actions/delta/reverse-replay.ts:107`: "a fork's copy will omit
  them (no forks yet, M6.1)".
- `lib/pipeline/definitions/memory-chain.ts:65`: "a fork will copy
  chapter ids (no forks yet, M6.1)".

### Canon edits

The PR makes these:

- `planReversal` and `targetBranchId` renamed to what ships, in
  [`data-model.md → Branch model`](../../../../data-model.md#branch-model)
  (step 1) and
  [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay)
  (the "Restored rows always stamp" paragraph).
- The answers to the fork details canon leaves open (Open questions):
  in `data-model.md → Branch model` (which "idle" the pre-condition
  reads, a `user_action` fork point, the in-memory records,
  `classifier_status` at fork for a null watermark and
  `lastSuccessAt`), and the fork sentence in
  [`memory/classifier.md → Persistence`](../../../../memory/classifier.md#persistence).
- The fork table's `P_first` against the code's floor
  (`lib/actions/delta/rerun-journal.ts:121`), if the wording still
  differs once R1's pass lands.

R1's rewrite of the pre-conditions and R2's current-branch write land
in the design pass before this slice's tasks for them (C12), not in
this PR.

## Scope: out

- The composite `deltas` key, the scoped delta writes and the read-back,
  the restore stamp in `emitInsert` and on `undoDelete`'s children, the
  run-record column and its read, the manifest, the copier, the vector
  copy and its device probe, the duplicate side of the captures test
  ([Slice 6.1](./01-copy-substrate.md)).
- The redo map and the per-branch clears
  ([Slice 6.2](./02-scoped-reads-redo.md)). The fork clears nothing on
  either shape of the stack.
- The branch list and its store, `switchBranch`, the tail that shows a
  branch already current, the fresh reader
  ([Slice 6.4](./04-switching-navigator.md)).
- `⎇`, the creation modal and its refused and failed states,
  `Re-run on new branch` with its parent-side checks, the fork's E2E and
  the E2E half of the parent's Redo, refreshing the branch list after a
  fork ([Slice 6.5](./05-fork-from-reader.md)).
- Branch delete, story duplicate, `dropBranchRecords`
  ([Slice 6.6](./06-delete-duplicate.md)).
- The eviction hook and the diff cache
  ([Slice 6.7](./07-diff-cache.md)). A fork evicts nothing (R3).
- The lead flag, its migration and the `leadId` stamps
  ([Slice 6.8](./08-per-branch-lead.md)); the copy carries them as a
  column and as JSON with no edit here.
- Canon for R1 and R2: the `aventuras-design` pass (C12).
- A vector family created between the copier's listing of the families
  and the batch, whose first vectors the copy then misses: Slice 6.1's
  default accepts and records it. A re-list after
  the commit that marks a new family's copied rows stale would be this
  slice's, and isn't built unless planning reopens that default.
- Trashing assets: a fork shares `assets` by reference and trashes
  nothing.
- The staleness pill on non-open branches, which stays parked.

## Acceptance criteria

Unit paths run with `pnpm vitest run --project unit <path>`. The test
files named are suggestions the plan may rename, with this doc amended.

**The planner's write branch.**

1. `lib/actions/delta/reverse-replay-write-branch.test.ts`, before 6.1
   merges: with the child as write branch, a plan over updates, a create
   whose undo deletes its row and a ref clear, run on a hand-seeded
   child, leaves the child's rows as the reversal leaves them on a
   branch it reads and writes, and the parent's rows unchanged. A
   fixture with a held copy or a survivor asserts the op list only.
2. The same file, after 6.1 merges: the held-payload rewrite, the
   survivor rewrite and the re-own write `(child, id)`, and the prune
   deletes, `journalOps` and the vector sweeps are separable from the
   ops a fork runs.
3. `pnpm vitest run --project unit lib/actions/delta lib/actions/story-entries lib/actions/chapters lib/pipeline`
   passes with no edit to an assertion main holds when 6.3 rebases:
   a reversal that names no write branch commits what it did before,
   `lib/actions/delta/reverse-plan-fields.test.ts` included.

**`forkBranch`.**

4. `lib/actions/stories/fork-branch.test.ts`: each refusal returns its
   code and leaves every table, `branches` and `stories` as they were: a
   registered hard-gate run, a pending turn, a reversal in progress, a
   pending swap, `N` missing, `N` `system`, an unfinished run whose
   delta would survive, an unfinished re-run whose journal would
   survive, an unfinished re-run whose reversal committed, with no
   delta of its own and its journal dropped, forked at its chapter's
   end, a `B` with no create delta, and a closure that refuses as a
   `ReversalIntegrityError`. An unfinished run whose only surviving
   delta is a create the plan re-owns doesn't refuse.
5. The same file: the unfinished run of (4), forked from an entry
   before every entry its writes are anchored on, succeeds, and the
   child holds none of its deltas. A parent in `heldBranches` forked
   from an entry before its re-run's chapter succeeds; forked at that
   chapter's end, it refuses.
6. The same file: the `branches` row carries the parent, `N`, the name
   and the story, and an idle status whose `processedThrough` is
   `min(parent's, position(N))`, from a parent whose status is `failed`
   with a `lastError` and from one at `running`; the parent's own status
   is unchanged. The action's row has a fresh `br_` id and the current
   time; the core's has the id and time it was given.
7. The same file: with make-current, `stories.current_branch_id` names
   the child after the commit; without it, the parent. A batch that
   throws partway leaves no `branches` row, no child row in any table
   and the pointer unchanged.
8. The same file: an `applyDeltaAction` on the parent dispatched while
   the fork holds its lock commits after the fork, on the parent only,
   and the child holds none of it. Two forks of one parent started
   together both commit, each child equal to the reference.
9. The same file: after a fork, the loaded parent's working-set store
   rows are unchanged and no patcher ran, the redo stack is as it was,
   and, once 6.7's post-commit hook is on main, no eviction fired.

**The survivor copy.**

10. `lib/actions/stories/fork-equivalence.test.ts`: for every fixture,
    the ids of the parent's deltas the child lacks equal
    `plan.prunedDeltas`, and the parent's journals the child lacks equal
    `plan.droppedJournals`.
11. The same file: a fork whose prune set is longer than the bind cap
    (`lib/db/bind-limit.ts:3`) commits, and its child equals the
    reference. `lib/actions/delta/reverse-replay-bind-limit.test.ts` is
    the precedent for building one.
12. If planning takes the temp-table fallback: its batch shape, table
    creation included, runs on desktop and on the slot AVD through
    `app/dev/db-check.tsx`, and Implementation notes record both results
    before the copy task starts. This check blocks the slice.

**Equivalence.**

13. `lib/actions/stories/fork-equivalence.test.ts`: for every fixture
    under The equivalence harness, the child equals the reference and
    the parent equals its snapshot, on every compared table, vector
    family, watermark and redo stack, with the seeded vectors present
    in both families.
14. The same file, each shown red by a mutation restored by `cp`: a
    stamp or key read from `delta.branchId` on `undoDelete`'s children
    fails the delete-inside-the-window fixture; the same on the
    tombstone re-insert fails the tombstone fixture; dropping the copy's
    system-entry predicate fails the error-card fixture; keeping the
    vector sweeps in the fork's ops fails a parent-untouched vector
    assertion; running the vector copy before the plan's ops fails the
    restored row's vector; copying `deltas` without the prune exclusion
    fails a delta comparison.
15. The same file: `undoLastAction` on the child of a copied pre-fork
    delete restores the row and its captured children on the child, and
    the parent's rows and deltas are unchanged.
16. The same file: the parent's redo top before the fork is its top
    after.
17. If Slice 6.2 has landed: after a fork whose parent holds a redo
    group, `hasRedo` on the child is false.
18. If Slice 6.8 has landed: the harness's lead-switch fixture is green,
    with the child's flagged row the parent's lead as of `N`, and it
    goes red when `isLead` leaves the register's logged columns
    (`lib/actions/entities/register.ts:104-117`).

**Captures.**

19. `lib/probe/fork.test.ts`: after a fork of a parent holding
    captures, `probe_captures` holds none on the child and every one on
    the parent.

**The seed.**

20. `pnpm db:seed <tmp>/a.db`, then a read of that file:
    `br_hero_fork` has its id, name, parent and fixed `created_at`; its
    `fork_entry_id` names an entry it holds; its entries equal
    `br_hero_main`'s through that entry, by id and content, followed by
    the appended turns, which end on a reply, hold ids no other branch
    holds and each have one create delta on the fork; its
    `processedThrough` is its last non-system entry's position. Two runs
    of the seed give byte-equal `br_hero_fork` rows in every table. A
    test seeding through the script's path asserts it (suggested:
    `scripts/seed/hero-fork.test.ts`).
21. `lib/db/devtools/seed-dataset.test.ts`,
    `scripts/seed/dataset-story.test.ts` and
    `scripts/dataset-chapter/seed-export.test.ts` pass, with every
    assertion that read the fork from the static steps moved to a seeded
    database or removed where (20) covers it.
22. If Slice 6.8 has landed: in the same seeded database, every
    appended `user_action` and reply on `br_hero_fork` carries
    `metadata.leadId` naming the fork's flagged row, and the fork holds
    exactly one flagged row.
23. `pnpm test:e2e` passes, `e2e/tests/embedder-drain.spec.ts`
    included, with its absence assertion
    (`statusPill.memoryIncomplete … toBeHidden()`) still in the spec and
    its offline positive-control describe green.
24. The on-device reseed on the slot AVD leaves `br_hero_fork` a real
    fork as in (20), checked by a read of the device's database.
    Non-blocking.

**Cost, pointers, canon, gates.**

25. Implementation notes hold a fork's time on the dataset story at its
    earliest reply and its tail, on desktop and on the slot AVD.
26. `grep -n "no forks yet" lib/actions/delta/reverse-replay.ts lib/pipeline/definitions/memory-chain.ts`
    prints nothing.
27. `grep -rn "planReversal\|targetBranchId" docs/data-model.md docs/generation-pipeline.md`
    prints nothing, and `data-model.md → Branch model` states the
    answers to the fork details canon leaves open.
28. `pnpm lint`, `pnpm typecheck`, `pnpm compiler:check`,
    `pnpm lint:docs`, `pnpm format:check` and
    `pnpm vitest run --project unit` pass.

## Tests

- **Unit (vitest, `--project unit`).** The planner's write branch on
  both sides of 6.1's merge; the action's refusals, branch row, batch,
  atomicity, lock and side effects; the equivalence harness over its
  fixtures, on the Node test stack with sqlite-vec loaded, building
  fixtures through the action layer (the close and re-run fixtures in
  `lib/actions/chapters/__tests__/chapter-delete-fixture.ts` and
  `lib/actions/delta/rerun-journal.test.ts` are the precedent) and
  seeding vectors by hand, which the action layer never writes; the
  survivor copy's exclusions and a fork past the bind cap; the
  captures case; the seed through the script's path. Every new
  assertion that guards a branch is shown red once by a mutation in a
  copy of the file restored by `cp`, never by `git stash`.
- **Regression.** The shipped reversal suites stay green unchanged:
  rollback is the write branch equal to the read branch.
- **E2E.** No new spec: the UI that forks is 6.5's. The whole suite
  runs once the seed forks, since every spec seeds the hero story.
- **Device.** The on-device reseed and the cost run on the slot AVD,
  non-blocking. The temp-table check, run only if planning takes that
  fallback, runs on desktop and the slot AVD and blocks the slice.
- **Order-dependent.** The criteria written "if Slice 6.2 has landed"
  or "if Slice 6.8 has landed" are met by whichever of the pair lands
  second; at this slice's rebase, check which of them is on main.

## Open questions

- **The split's shape.** Whether the write branch is an option on
  `buildReverseAndPrunePlan` or a field the walk carries, and what
  `ReversePlan` gains: separate re-own ops, separate vector-sweep ops,
  or a fork view over the plan. `ReversePlan` keeps its fields either
  way.
- **How short the survivor copy's two lists stay.** The predicate is
  the default (C7). Whether the deltas the plan prunes outside the
  window, or the creates it re-owns, can pass the bind cap on a real
  story decides whether the fallback is needed. The closure's additions
  are writes to rows reached by reference from removed rows, so a fork
  that removes a long stretch of a richly linked world adds the most.
  Planning reads it from the code and measures it on the dataset story.
- **The fork's details canon leaves open.**
  - `processedThrough` when the parent's is null (never processed, or
    a NULL column read as idle), and whether `lastSuccessAt` copies or
    resets.
  - Whether a parent's `deferred` work or `pendingClose` pick whose end
    entry is at or below `N` follows the child. Both are in memory and
    keyed by branch. Writing either takes an owner entry in
    `eslint.config.js` (`CLOSE_RECORD_MUTATORS`, `:38-41`) and in its pin
    test, `lib/stores/__tests__/generation-mutators-lint.test.ts`, which
    C11 gives 6.3 in that case.
  - Whether the action refuses a `user_action` fork point. Canon refuses
    only `system`, and the UI offers `opening` and `ai_reply`. The
    seed's fork entry is a `user_action`. The re-run path's `N` is a
    reply or the opening, by Slice 6.5's reading of the code
    ([its Open questions](./05-fork-from-reader.md#open-questions)), so
    a refusal there wouldn't reach that path.
  - Whether the fork raises the reversal barrier from its refusal reads
    to its commit. The lock alone doesn't hold a pending swap off: a
    staging swap or a relabel admitted after the fork's swap read checks
    the gate only at its start and lists the story's branches without
    the child (`lib/embedder-swap/app-deps.ts:527-535`, `:639-646`).
    Raising the barrier takes an owner entry for `setReversalInProgress`
    (`eslint.config.js:25-35`) and its pin test, both C11's lines for 6.3
    in that case, and it must not interrupt runs as
    `bracketProseReversal` does: a fork refuses under the gate.
  - Which "idle" holds across stories: `isUserEditBlocked` counts a run
    on any story.
- **R1, reading "survives" from the plan.** Settled by the canon pass
  ([`data-model.md → Branch model`](../../../../data-model.md#branch-model)).
  A delta of the run in `plan.prunedDeltas` doesn't survive. A
  re-owned create doesn't count as carried: it takes a new `action_id`
  (`reverse-replay.ts:182-186`), as recovery on the parent would leave
  it. A journal survives unless `plan.droppedJournals` holds it. A
  re-run marker with `rerun_chapter_id` set carries its chapter's state
  even with no delta and no journal, so its chapter surviving the plan
  refuses.
- **How the seed runs an action.** How `scripts/seed` and the on-device
  reseed run the fork's core. `scripts/seed/index.ts`'s `--overlay` path already loads the
  action layer, but every E2E spec runs `pnpm db:seed`, so its load
  time lands on every spec. `reseedDevDatabase` sits in `lib/db`, which
  can't import `lib/actions` without a cycle, so its caller
  (`app/dev/reseed.tsx`) or an injected step runs the fork.
- **Whether main forks at the seed's `N`.** Seed rows with no create
  delta that the closure reaches by reference refuse as `no-create`
  (`lib/actions/delta/row-closure.ts:329-330`). Whether the planner
  reaches one from `entry_hero_0040` is read at planning; a refusal
  moves the fork entry, not the approach.
- **The appended turns' lead stamps.** With
  [Slice 6.8](./08-per-branch-lead.md) on main, the appended turns
  carry `metadata.leadId` as main's entries do. C10 pins who stamps
  them: the second of 6.3 and 6.8 to land, as with the harness's lead
  switch. What is open is only how the stamp is written at seed time,
  beside the other appended fields.
- **Unaudited contract text.** Not rechecked by any audit round: C1's
  pin of the row target's branch, the two harness fixtures, the
  tombstone construction (two readings of the code, the auditor's and
  this doc's writer's, and no run), the rule for tests before 6.1
  merges, C7's core and its seed turns, C7's predicate default for the
  survivor copy, C8's hold from a fork's start to its navigation, and
  the "second to land" criteria. Read them against the code at planning
  ([milestone → Open questions](../milestone.md#open-questions)).
- **6.3 beside 6.1.** If the plan can't test anything before the op
  list splits, the edge becomes blocking and the planner starts after
  6.1 merges.
- **Size.** Planned at 15 tasks, priced by analogy with no close
  precedent. M5's plans held 3 to 7 more than their estimates; check at
  the plan skeleton.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
