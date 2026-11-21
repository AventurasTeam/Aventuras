# M6 branch rulings

Four canon fixes the M6 readiness check found (2026-11-21), each a short
ruling, settled before M6 is planned. All four come from the hard-fork
design: a fork copies rows verbatim, ids included, and the branch tree
is a record, not a structure anything runs on
([`data-model.md → Branch model`](../data-model.md#branch-model)).

## Why

Canon written before the fork design assumed a delta or action id
named one row in one place, kept one redo stack for the whole app,
called branch deletion a single SQL cascade, and promised an Actions
menu entry the menu doesn't list. Each holds until M6 lands fork and
switching, then fails quietly.

## Decisions

**The diff cache keys on `(branch_id, delta.id)`.** A fork or a story
duplicate copies deltas with their ids, and a fork's rewind can
rewrite a surviving copy's prior value, so one id holds a different old
and new on each branch; a cache keyed on the id alone could show a
fork's History the parent's values. `peek` takes the branch, `populate`
reads it off the delta, and the TanStack key becomes
`['diff', branchId, delta.id]`. A reversal evicts its own branch's
entries; a fork or a duplicate evicts nothing, since the copies' branch
ids are new. The chain-walk index stays: `target_id` is unique within a
branch, which is all the three-column form needs.

**A copied `actionId` is scoped by branch, a live one isn't.** Each
run mints a fresh id and no run reuses one, but copies repeat a past
action's id across branches, so a lookup of a past action scopes by
branch, as `reversal_journals`' `(branch_id, action_id)` key does. A
live or orphaned run's id names deltas on one branch only, since fork
and duplicate refuse while a run is registered or a branch is held, so
reverse-replay of a run may select by the id alone.

**One redo stack per branch.** The stack becomes a map from a branch
to its groups. A write clears the stacks of the branches it can
change: a delta-logged write its own branch's; a story-level write
every branch of its story's. The reader reads its own branch's stack.
Deleting a branch or a story drops its stacks. Redo then survives a
fork for the parent, as canon intends, and a look at another branch or
story and back. Rejected: one stack with Redo shown only for the
loaded branch's top group, under which undos on two branches
interleave and the lower branch's Redo hides behind the other's; and
clearing the stack on every switch, which loses the parent's Redo
across a fork.

**A branch delete re-parents its children, and the root is
deletable.** The children's `parent_branch_id` becomes the deleted
branch's own parent, null when it had none. `fork_entry_id` stays: a
fork copies its entries up to the fork point with their ids, so it
names an entry the child holds itself. Nothing reads the tree, so a
root delete leaves its children parentless and nothing else changes;
the `×` hides only on the current branch, which also covers a story's
only branch. The delete is one transaction of per-table deletes scoped
by the branch, as `deleteStory` runs them: every branch-scoped table,
`reversal_journals` included, the branch's vec0 rows by their `branch_id` column,
the re-parenting, then the `branches` row. Its in-memory records go
with it: `generationStore`'s `deferred`, `pendingClose` and
`pendingRerun`, and its redo stack. It waits on generation, as canon
already has it, and on an embedder swap pending on the story, since the
swap embeds across the story's branch ids and would write vectors for
a branch that's gone. The confirm becomes an AlertDialog over the
navigator, `Delete <name>?`, with the impact line
`<N> entries exist only on this branch.` and
`Its world, plot and chapter changes go with it. This can't be undone.`,
and a `Delete branch` button. The count is the branch's non-system
entries whose id no other branch of the story holds, since copies keep
entry ids; it misses edits this branch made to entries the branches
still share, so it indicates the loss rather than inventories it.
Rejected: `SET NULL` with the root rule kept,
which turns the children into roots and hides their delete; and
refusing a branch with children, which makes the user delete a subtree
leaf first.

**`Browse branches…` joins the reader's contextual zone.** The
navigator's single-branch path promises it, and the menu didn't list
it. Branch navigation is the reader's alone
([`principles.md`](../ui/principles.md#top-bar-design-rule)), so it
sits beside Undo, Redo and Jump to bottom rather than in `STORY TOOLS`.
Always present in the reader, single-branch stories included; the `…`
because it opens the navigator; never disabled in flight, since the
navigator pauses switching and hides delete itself.

## Adversarial pass

**Load-bearing assumption: no lookup of a past action or a delta uses
its id alone.** Checked in code: every `deltas.actionId` query filters
by `branchId` except `reverseReplayDeltas`
(`lib/actions/delta/reverse-replay.ts:817`), whose three callers —
boot recovery, the orchestrator's abort, a failed turn's own rollback —
all reverse a live or orphaned run, and boot recovery's held-branch
quarantine (`lib/actions/classifier/deps.ts`), which reads orphaned
runs only. The diff cache isn't built yet.

**A list mixing branches repeats a copied delta.** The Diagnostics
delta log's `All branches` scope
([`diagnostics.md → Tab 5`](../ui/screens/diagnostics/diagnostics.md#tab-5--delta-log))
shows each pre-fork delta once per branch, under one id, on rows that
don't say which branch. The cache ruling covers the summaries; the rows
need the branch named. Routed to M7.3, which builds the tab.

**Who clears which stack.** `apply-delta-action.ts` and
`commitNewAction` clear on a delta-logged write: their branch's. The
re-run's undo clears for the journal it wrote back: its branch's.
`set-lead.ts` clears because a redo replays deletes past the lead
refusal, and the lead is story-level until M6 builds the per-branch
lead: every branch of the story then, its own branch after.

**A held branch can be deleted.** Its orphan pass's deltas go with it;
boot recovery's unfinished `pipeline_runs` row then reverses no deltas
and settles its marker, which reverse-replay already handles at zero.
Not refused: deleting is a way out of a held branch.

**The inline confirm under-warned, found by a side review.** The
navigator's `Delete this branch? [Cancel] [Delete]` strip named no
loss, and the delete can't be undone. It took two clicks and never
reached the current branch, but a root delete makes it the original
line's gate, usually the branch holding the most turns of its own.
[`inline-delete-confirm.md`](../ui/patterns/inline-delete-confirm.md)
justified the strip by a consequence "bounded to that row's data" and
sends a cascading delete to AlertDialog; a branch delete cascades
across every branch-scoped table, so the move was owed before the root
became deletable.

**Root delete leaves several parentless branches.** The navigator sorts
by `created_at` and shows no lineage, so nothing a user sees changes.
The ER diagram's "null if root" becomes "null for a branch with no
parent".

**Not traced:** whether the swap engine holds the branch ids for its
whole run or rereads them (`lib/embedder-swap/app-deps.ts:439` reads
them per call). Either way, a delete mid-swap can race a vector write;
the refusal costs one hidden icon.

**Edge cases.**

- Redo stacks accumulate per visited branch for the session: bounded by
  the user's undos, cleared by any write there, gone on restart.
- A deleted branch's diff-cache entries stay until LRU evicts them;
  nothing reads them.
- Undo of a branch delete: none, as for a story delete.

## Integration plan

**Canonical files:**

- `docs/architecture.md`
  - `### Cache shape and lifecycle`: key on `(branch_id, delta.id)`,
    `peek(branchId, deltaId)`; replace the globally-unique claim; a
    reversal evicts its branch's entries; the index justification reads
    "unique within a branch".
  - `### Consumer flow`: `peek(delta.branchId, delta.id)`; the TanStack
    key `['diff', branchId, delta.id]`; a list mixing branches
    identifies a delta row by branch and id.
- `docs/generation-pipeline.md`
  - `### Multi-run txState`: the `actionId` comment.
  - `## Invariants`: the `actionId` bullet as ruled.
  - `### Reverse-replay` (two lines): every delta-logged write clears
    its branch's redo stack.
- `docs/data-model.md`
  - ER `branches.parent_branch_id`: "null for a branch with no parent".
  - `### Branch model`: the fork paragraph's redo-stack clause; a new
    **Deleting a branch** paragraph after the composite-PK one.
  - `### Entry mutability & rollback`: the redo stack is per branch
    (step 3 and the redo paragraph); the survival-anchor slot paragraph
    and the edit bullet clear "its branch's" stack.
- `docs/memory/chapter-close.md` → `## Re-running a close`: the re-run's
  undo clears its branch's redo stack.
- `docs/ui/screens/reader-composer/reader-composer.md` →
  `### Undo and redo`: Redo and the notice's Redo come from the reader
  branch's stack.
- `docs/ui/patterns/entry-card.md`: "the global redo stack" becomes
  "its branch's redo stack".
- `docs/ui/patterns/actions-menu.md`: `Browse branches…` in the reader
  row; Redo absent when the reader branch's stack is empty.
- `docs/ui/screens/reader-composer/branch-navigator/branch-navigator.md`
  - `### Row actions — inline icons`: delete hidden on the current
    branch only.
  - `### Inline delete confirm` becomes `### Delete confirm`: the
    AlertDialog with its count, the per-table transaction in place of
    the single SQL cascade, children re-parent.
  - `### During generation`: delete also hidden while an embedder swap
    is pending.
  - `## Single-branch state`, `## Data-model touchpoints`,
    `## Screen-specific open questions`: the root rule's mentions.
- `docs/ui/patterns/inline-delete-confirm.md`: the branch navigator
  leaves its Used-by and its examples; the upgrade rule names a branch
  delete as the cascading case.
- `docs/ui/patterns/icon-actions.md`: the hidden-vs-disabled example
  hides delete on the current branch only.
- `docs/ui/patterns/alert-dialog.md`: Used-by gains the branch delete;
  the closing note no longer sends branch rows to the inline pattern.
- `docs/ui/screens/reader-composer/rollback-confirm/rollback-confirm.md`:
  its warn-colour link points at the inline pattern instead of the
  renamed heading.
- `docs/implementation/roadmap.md`
  - M6 readiness block: drop the four resolved canon defects, keep the
    entry corrections.
  - M6.3 branch-delete item: rewritten to canon.
  - New M6 item: per-branch redo stacks, with the clear sites.
  - New M6.4 note: the cache key.
  - New M7.3 item: the `All branches` delta log names each row's
    branch.

**Renames:** `branch-navigator.md` `### Inline delete confirm` →
`### Delete confirm`. Inbound refs: `branch-navigator.md` (row
actions), `inline-delete-confirm.md` (Used-by, removed),
`rollback-confirm.md` (repointed), `roadmap.md` (the readiness bullet,
removed).

**Patterns adopted on a new surface:** (`branch-navigator.md`,
`alert-dialog.md`) for the branch delete; the navigator leaves
`inline-delete-confirm.md`.

**Followups resolved:** none in `followups.md` or `parked.md`; the
roadmap's four readiness defects.

**Followups introduced:** roadmap items only (M6 redo stacks, M6.4
cache key, M7.3 branch-named rows).

**Wireframes updated:** `docs/ui/patterns/actions-menu.html`'s three
reader states list canon's contextual zone (Undo, Redo, Jump to bottom,
`Browse branches…`); they showed a stale `Jump to top of branch` and no
Undo or Redo.
`docs/ui/screens/reader-composer/branch-navigator/branch-navigator.html`
encoded the root rule (`!b.isRoot && !b.current`); its header and chip
counts now follow the branch list. Delete now hides on
the current branch only; a `current:` review group makes `alt-ending-2`
current so the root shows its `×`; a `swap:` group hides delete while
an embedder swap is pending, with switching still live. The
`delete confirm` row state becomes the AlertDialog over the navigator.

**Intentional repeated prose:** none.
