# Fork partition, anchors, and copy invariants

Reconciling the branch-fork delta partition, `reversal_journals` copy
rules, `user_action` create anchor, and branch-copy identity invariants
for M6.1. Designed 2026-11-19 from the three M6.1 contract items in
[`roadmap.md`](../implementation/roadmap.md#m6--branches--diff-cache).

## Why

[`data-model.md → Branch model`](../data-model.md#branch-model) defined
forking from entry `N` in three steps whose predicates disagreed: step 2
copied post-`L` deltas only when their source was `periodic_classifier`
or `chapter_close` and their anchor was `≤ N`, while step 3
reverse-applied everything at `≥ L` with
`entry_id IS NULL OR position(entry_id) >= position(N+1)` — source-blind.
A `user_edit` (prose or metadata) or `translation` anchored on a kept
entry `≤ N` therefore fell between the two: copied by neither, rewound
by neither, silently dropped from the fork's history.

Verifying the schema and reversal planner against the fork contract
turned up three more hazards:

- `deltas` is the only branch-scoped table shipped with a single-column
  `id` primary key (`lib/db/system/system.table.ts`), contradicting
  `data-model.md`'s composite `(branch_id, id)` rule. Verbatim
  `INSERT ... SELECT` copy would collide on `deltas.id`, and minting
  fresh delta UUIDs would force rewriting delta IDs inside copied
  `reversal_journals`.
- `deltas.undo_payload` on `op='delete'` (target row + captured
  children) and `reversal_journals.journal` store serialized JSON rows
  carrying the parent's `branchId`. Reversing a copied delete or writing
  back a copied journal on a fork currently inserts those objects
  verbatim, targeting the parent branch instead of the fork.
- `submitTurn` (`lib/actions/turns/submit-turn.ts`) writes a
  `user_action`'s create delta with `entryId: null`, contradicting canon
  ([`data-model.md → Diagram`](../data-model.md#diagram) and
  [`Survival anchor`](../data-model.md#survival-anchor)) and asymmetric
  with `ai_reply` (`lib/pipeline/definitions/per-turn.ts`).
- `reversal_journals` needed exact fork rules matching
  [`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)
  (including the case where a rewind sweeps from below a spared re-run
  group's first `log_position`).

## Decisions

- **Fork ≡ snapshot + rollback-to-`N`.** Forking `parent` at entry `N`
  produces the exact state, delta log, and journal set of snapshotting
  `parent` (minus `probe_captures` and any `kind='system'` tail entry)
  and rolling back to `N`, with `classifier_status` reset to idle and
  `processedThrough = min(parent.processedThrough, position(N))`.
  Rejected: rewinding post-`L` edits on kept entries (breaks symmetry
  with rollback and with `data-model.md`'s rule that text edits on `N`
  propagate through a fork).
- **Plan-on-parent, execute-on-child in one atomic transaction.**
  Because `DbCtx.runInTransaction(ops: SqlOp[])` commits a pre-computed
  batch, fork plans on the frozen parent through the existing
  `resolveSweep` + `planReversal` (parameterized with
  `targetBranchId: newBranchId`), then commits branch creation, copies,
  and reversal ops in one SQLite transaction. Rejected: two-transaction
  copy-then-rollback (non-atomic — crash or integrity refusal leaves an
  un-rewound orphan branch) and a fork-specific Step 3 loop (duplicates
  closure, own-write yield, prior-value rewrites, held-delete patches,
  kept-create re-owning, `refClears`, and journal drops).
- **Avoid copy-then-delete churn on the two large tables.** On a large
  story forked near the start, copying all vectors and all deltas only
  to delete almost all of them wastes megabytes of `vec0` writes/scans
  and tens of thousands of delta deletes. Because `planReversal` runs
  before the transaction, fork copies only surviving `deltas` and
  `reversal_journals`, and copies `*_vec` _last_ (filtered to rows still
  live in `newBranchId`), omitting `DELETE FROM deltas`,
  `DELETE FROM reversal_journals`, and `vecSweepIdsOps` from the fork's
  reversal batch.
- **Composite PK `(branch_id, id)` on `deltas`.** Brings the schema into
  compliance with `data-model.md`; all `deltas` `UPDATE`/`DELETE` sites
  scope by `(branch_id, id)`.
- **Re-stamp `branch_id` at restore time, never rewrite JSON at fork.**
  `undoDelete` (target + captured children) and journal write-back
  always overwrite `branch_id` with the executing/target branch. Zero
  JSON-walking on fork; safe across arbitrary multi-generation forks.
- **Keep canon on `user_action`'s anchor; fix `submitTurn`.** `submitTurn`
  stamps `entryId: entryId` on `user_action` creates to match `ai_reply`.
  `resolveRollbackWindow` stays anchor-agnostic (locates `L` by
  `target_table = 'story_entries' AND target_id = B.id AND op = 'create'`),
  so existing `entry_id = null` rows need no migration.

## The design

### Pre-conditions (refused before any write)

- Generation gate on `parent` is idle
  ([`branch-navigator.md → During generation`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked)).
- `parent.classifier_status.state !== 'running'` (a branch held by an
  unrecovered orphan pass cannot be forked; resetting status to idle on
  the child would bake uncommitted orphan deltas into the fork with no
  recovery marker).
- No embedder swap is pending on the story (`isStorySwapPending`).
- `N` exists on `parent` and `N.kind !== 'system'` (UI exposes fork on
  `opening` and `ai_reply`; action layer rejects `system`).
- Executed under `parent`'s exclusive branch write lock through plan +
  commit.

### Plan (read-only on frozen `parent`)

1. Locate `B` = earliest non-system entry on `parent` with
   `position > position(N)`.
2. If `B` exists, run `resolveSweep(parent, B)` →
   `planReversal(set, { keepRedoExact: false, targetBranchId: newBranchId, forkMode: true })`.
   - Uses the single source-blind survival-anchor predicate
     `log_position >= L AND (entry_id IS NULL OR position(entry_id) >= position(B))`
     plus `selectReversalSet`'s fixed-point closure.
   - A `ReversalIntegrityError` aborts before any SQL executes.
3. If `B` does not exist (`N` is the narrative tail), the reversal plan
   is empty.

### Atomic commit (one `runInTransaction` batch)

1. Insert `branches` row (`parent_branch_id = parent`,
   `fork_entry_id = N`,
   `classifier_status = { state: 'idle', processedThrough: min(parent.processedThrough, position(N)) }`).
2. Copy domain tables with `branch_id = newBranchId`: `story_entries`
   (`WHERE kind != 'system'`), `entities`, `lore`, `threads`,
   `happenings`, `happening_involvements`, `happening_awareness`,
   `character_relationships`, `chapters`, `branch_era_flips`,
   `translations`, `entry_assets`. (`probe_captures` is skipped.)
3. Copy surviving `deltas` only — all rows when `B` does not exist;
   otherwise excluding
   `allPruned = (set.rows \ reowned) ∪ prunedHolders ∪ strandedWrites`
   (concrete query: `log_position < L` minus any `< L` member of
   `allPruned`, plus surviving `>= L` IDs, which includes `reowned`
   creates). Copy surviving `reversal_journals` only (excluding journals
   dropped by the plan).
4. Execute `planReversal`'s row mutations, `refClears`, surviving-delta
   prior-value rewrites, held-delete payload patches, and kept-create
   re-owns on `newBranchId` (omitting `DELETE FROM deltas`,
   `DELETE FROM reversal_journals`, and `vecSweepIdsOps`).
5. Copy `*_vec` **last**, synthesizing `pk = newBranchId || ':' || id || ':' || model_id`,
   filtered to rows still present in `newBranchId`'s corresponding
   source table. Rows whose embedded fields changed already got
   `embedding_stale = 1` in step 4; removed rows' vectors are never
   written or scanned.

Parent rows and `undoRedoStore` are untouched.

### `reversal_journals` across fork

Because fork uses the shared sweep planner, journals follow the exact
four cases of
[`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay):

| Fork case (`B` = first non-system entry `> N`, `L = create_lp(B)`)                                                                    | Re-run group (`anchor = E`, first `lp = P_first`) | Journal on fork                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. `N` is narrative tail (no `B`)                                                                                                     | Spared                                            | **Copied**                                                                                   |
| 2. Chapter ends after `N` (`position(E) > position(N)`)                                                                               | Swept                                             | **Dropped**                                                                                  |
| 3. Chapter ends `≤ N`, re-run committed before `B` (`P_first < L`)                                                                    | Spared; sweep starts above `P_first`              | **Copied** (foreign spared delta above `P_first` is caught by the standard write-back check) |
| 4. Chapter ends `≤ N`, re-run committed after `B` (`P_first ≥ L`, e.g. manual close + re-run while open-region turns `B..head` stood) | Spared; sweep runs from below `P_first`           | **Dropped** (rewinding `B..head` changed state under what the journal snapshotted)           |

## Adversarial pass

**Load-bearing assumption: `newBranchId`'s pre-filtered tables agree
with `parent` for every op `planReversal` emits.** Verified against
`lib/actions/delta/reverse-replay.ts:701-730`: `buildReverseAndPrunePlan`
prunes three sets — `set.rows \ reowned`, `prunedHolders`, and
`strandedWrites` — while `reowned` machine creates stay in `deltas` and
receive an `UPDATE`. Defining `allPruned` as that exact three-way union
guarantees every `UPDATE deltas` op in step 4 finds its row in
`newBranchId` and no pruned delta is ever copied. `story_entries`
omitting `kind='system'` is safe because system entries carry no deltas
and are never referenced by any delta or link.

**Edge cases.**

- Pending embedder swap (`isStorySwapPending`) and held orphan pass
  (`classifier_status.state === 'running'`) are both refused pre-fork so
  neither staged vectors nor uncommitted orphan deltas leak into a new
  branch.
- `kind='system'` as `N` is rejected at the action layer.
- `vec0` synthetic `pk`: verified in `0005_embedder_vec0.sql` and
  `lib/db/embeddings/ops.ts` that `pk` is global
  `<branch_id>:<id>:<model_id>`, so step 5 synthesizes `pk` for
  `newBranchId`. _Unverified at runtime:_ whether `sqlite-vec` allows a
  self-referencing `INSERT INTO <vec> SELECT ... FROM <vec>` in one
  statement. If `sqlite-vec` rejects concurrent read/write on the same
  vtab, M6.1 reads surviving parent vectors before the transaction (or
  stages through a temp table inside the tx) — same contract.
- Restoring a deleted `entry_assets` row during a fork rewind shares
  rollback's M9.3 trash-can requirement: clear
  `assets.pending_delete_at = NULL` so the sweeper cannot unlink an
  asset the fork now references.

**Read-site impact.** Moving `deltas` to composite PK `(branch_id, id)`
requires auditing every `deltas` `UPDATE`/`DELETE` site to scope by
`(branch_id, id)` (verified `reverse-replay.ts:716` currently uses
`eq(deltas.id, ...)` alone). All readers of `deltas.entryId` were
checked (`operational.ts`, `pre-entry-locations.ts`, `undo-target.ts`,
`classifier-facts.ts`, `entry-reads.ts`, `lib/history/`); none break
when `submitTurn` stamps `entryId: entryId`, and `resolveRollbackWindow`
continues handling historical `entry_id = null` rows with no migration.

**Adjacent observation (out of scope for M6.1).** `branches.parent_branch_id`
(`lib/db/stories/stories.table.ts:44`) currently has a bare FK to
`branches.id` with no `ON DELETE SET NULL`, which M6.3's branch delete
will need to handle before deleting a non-root parent branch.

## Integration plan

**Canonical files:**

- `docs/data-model.md`
  - `## Diagram` (`deltas` table): note `branch_id` is composite PK with
    `id`; note `reversal_journals` fork behavior matches the manifest.
  - `### Branch model`: replace the 3-step pre-partition prose with the
    unified snapshot + rollback-to-`N` contract (pre-conditions, single-
    transaction plan-on-parent / execute-on-child shape, surviving-only
    `deltas`/`reversal_journals` copy, post-rewind `*_vec` copy,
    `branch_id` re-stamping invariant, and four-case journal rules);
    update the Branch-copy manifest rows (`story_entries`,
    `entry_assets`, `*_vec`, `deltas`, `reversal_journals`).
- `docs/generation-pipeline.md`
  - `### Reverse-replay`: add the `branch_id` re-stamping rule on
    `undoDelete` (target + captured children) and journal write-back,
    and note that branch fork reuses `planReversal` scoped to
    `targetBranchId` in one atomic transaction.
- `docs/implementation/roadmap.md`
  - `### M6 — Branches + diff cache`: update M6.1's slice bullet and
    replace the three resolved M6.1 design deferrals (Steps 2 vs. 3
    partition predicate, `reversal_journals` copy, `user_action` create
    anchor) with one focused M6.1 build checklist covering the `deltas`
    composite PK migration + `(branch_id, id)` write audit, `branch_id`
    re-stamping, `submitTurn` anchor fix, and `sqlite-vec` self-insert
    check; note `branches.parent_branch_id` FK on M6.3's branch-delete
    item.

**Renames:** none.

**Patterns adopted on a new surface:** none.

**Followups resolved:** none in `followups.md`; resolves three M6.1
carried deferrals in `docs/implementation/roadmap.md` (Steps 2 vs. 3
predicate mismatch, `reversal_journals` fork copy, `user_action` create
anchor).

**Followups introduced:** none in `followups.md` (all remaining work is
M6.1 / M6.3 implementation detail recorded in `roadmap.md`).

**Wireframes updated:** none (no UI surface changed in Piece 1).

**Intentional repeated prose:** `data-model.md#branch-model` and
`generation-pipeline.md#reverse-replay` each briefly state the
`branch_id` re-stamping rule from their own side (storage copy invariant
vs. reverse-replay execution contract) and cross-link.
