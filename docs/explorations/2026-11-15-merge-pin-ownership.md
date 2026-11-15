# A World merge keeps a pin's owner

How World's character merge moves an awareness row without making its
pin the user's. Designed 2026-11-15; resolves, as design, the
Data-model followup "World merge re-creates awareness rows as the
user's". The code is a plan-mode followup.

## Why

World's merge moves each awareness row the kept character lacks by
re-creating it on the kept character as a `user_edit`, while the
loser's `deleteEntity` cascades the original. User precedence reads a
user create as writing every field, so the copy's pin reads as one the
user set, whoever set it. Four reads ask whether the user ever set a
pin, and each then leaves the row alone at every close:

- `set_pin` skips it (`awareness-tools.ts`, `userEverWrote`);
- the Awareness start leaves it out of the frequent set
  (`close-awareness.ts`, `userPinned`);
- a Happenings merge keeps its pin on the kept row
  (`happening-tools.ts`, the fold's `userKept`);
- a Happenings merge that would absorb a happening a merged character
  knows is skipped (`happening-tools.ts`, `mergeProtection`).

A second gap sits beside it. When the kept character already knows the
happening, the merge drops the loser's row whole
(`merge-links.ts`, the `known` filter), so a pin the user set on it is
lost, and the kept row's machine pin stands.

## Ground truth that shaped it

- **Only the pin reads a row's whole history.** The four reads above
  read every user delta on the row. Every other read that sees the
  copy reads user edits since the cited prose: pass writes of awareness
  (`register-awareness.ts`), relationship views
  (`relationships/register.ts`), involvement re-creates, the close
  guard's `userWrote` and `userTouched`, and Q5's deleted-link check.
  They see the merge only for prose older than it, and read it as a
  user act after that prose, which it is. They aren't the defect, so
  the followup's re-point, which changes them too, buys little for its
  cost.
- **The merge is built and dispatched in one tick, from stores**
  (`lib/actions/world/resolve-collision.ts`). It can't read the delta
  log before it builds, so ownership is read where the write applies.
- **Handlers read the state from before the group,** and a no-op
  outcome writes nothing without refusing the group
  (`apply-delta-action.ts`). So a handler in the merge's group still
  sees the loser's rows and their history ahead of the cascade.
- **A create's `undo_payload` is null by canon,** and nothing that
  reads a create looks at its payload: `undoCreate`, redo, the
  closure's create scan, `later-turn.ts`, History's `Created` summary,
  row signals (a create looks its link row up). Every walk of a
  payload's keys skips `$` keys or reads updates only (`changedPaths`,
  `planOwnWrite`, `onlyNulledViews`, History's free-text search).
- **Redo re-inserts each delta row whole** (`redo.ts`), so a mark on a
  create survives undo and redo.
- **`Resolve →` is disabled while a turn, a pass or a close runs**
  ([`world.md → Edit restrictions during in-flight generation`](../ui/screens/world/world.md#edit-restrictions-during-in-flight-generation)),
  and only the user writes user deltas, so nothing changes a row's
  ownership between the dialog and the write.

## Decisions

All by the developer, 2026-11-15.

1. **The defect is the pin's "ever" rule.** The reads since the prose
   stay as they are.
2. **Scope: ownership plus a user pin's carry.** A merge copy carries
   its original's pin ownership, and a user pin on a row the merge
   drops carries to the kept row. The kept row's other fields stand on
   an overlap, as today; a 3e-style fold of the overlap was rejected
   as more than the defect needs.
3. **A carried pin fills a machine pin only.** When both pins are the
   user's, the kept row's stands. The rule mirrors the merge's
   relationships, which keep the canonical's views and fill blank
   ones. "Higher pin wins" and "higher pin always" were rejected.
4. **A mark on the copy's create.** Rejected:
   - **A `user_pinned` column.** Cheaper reads, and the merge copies
     it without a log read, but a migration and backfill, a second
     source of truth beside the log that every future pin writer must
     keep, a History label and a new paired-field group. Every other
     ownership rule reads the log.
   - **Re-pointing the rows** (the followup's four parts, plus closure
     canon that judges `character_id` by its prior value). It touches
     the group runner, redo's cascade, the closure and History to fix
     what `wroteField` fixes, and it changes the reads since the prose,
     which aren't broken.

## The pin rule

An awareness row's pin is the user's when the user created the row or
a user update carried `decayResistance`, at any time, except that a
user create carrying `$machinePin` copied a pin the user never chose
and doesn't count.

- **`wroteField` takes an awareness-pin case,** beside its placement,
  collision-flag, retirement and thread-status groups: on
  `happening_awareness`, `decayResistance` counts a create only without
  `$machinePin`. It holds for every read of the pin, since the prose or
  ever: a pin is the user's preference, not a fact about the prose
  ([`chapter-close.md → 3d`](../memory/chapter-close.md#3d--awareness-pin-tuning)),
  so a pin the merge copied from a machine is a close's to tune,
  whatever turn it cites. The copy's other fields still read as the
  user's to prose older than the merge.
- **The pass writes' precedence reads the pin through `wroteField`.**
  `register-awareness.ts` calls `wroteColumn`, which skips
  `wroteField`'s table cases.
- **The Awareness start's `userPinned` query** counts a user create
  only when its payload has no `$machinePin`.
- **Canon.** A create's `undo_payload` is null or holds only `$` keys,
  and `$machinePin` joins the payload metadata keys
  ([`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).

## The merge's writes

The builder stays pure and synchronous. Each awareness action it sends
names the loser's row it comes from, and the handler reads that row's
ownership when it applies.

- **A moved row** (the kept character doesn't know the happening) is
  created on the kept character as today, with `$machinePin` when the
  source row's pin isn't the user's. A source row that was itself a
  marked copy reads as not the user's unless a user edit set its pin
  since, so a copy of a copy carries the same answer with no chain to
  follow.
- **An overlap row** (the kept character knows the happening) sends an
  action on the kept row naming the loser's. When the source pin is the
  user's and the kept row's isn't, the handler logs an update carrying
  `decayResistance` at the source's value, even when the two are equal:
  the restatement claims the pin, as a rewritten restatement keeps its
  key under
  [undo-own-write](../generation-pipeline.md#reverse-replay). Otherwise
  it writes nothing. The loser's row is dropped as today.
- **Reversal.** CTRL-Z removes the copies and reverses the carry, which
  takes the kept row's ownership back with its pin. Redo re-inserts the
  deltas. The carry's undo yields to a later pin write on the kept row,
  which only the user can make, since `set_pin` skips the row from then
  on.
- **UI.** History lists the carry as `Modified Pin` on the canonical's
  awareness row, with an unchanged value when it restated. The merge
  dialog doesn't count carried pins: that would need an ownership read
  in the dialog, and the carry only keeps a choice the user made.

## What stays

- A copy still reads as a user create to every read of its other
  fields from prose older than the merge.
- Copies keep new ids, so History lists a row's earlier edits on the
  loser's original.
- Involvements and relationships: unchanged. They carry no pin.

## Adversarial pass

- **Load-bearing: no reversal takes a user write from under a later
  user group.** The mark records the loser row's ownership when the
  merge applies; a user pin edit on that row reversed while the merge
  survives would leave the mark wrong. Read from canon and the code:
  CTRL-Z takes only the head group, and rollback and regenerate a
  suffix, so both take the merge first. A prose edit's sweep, a chapter
  delete, a re-run, an abort and crash recovery reverse machine groups
  only. Undo-own-write rewrites a surviving delta's prior values but
  never removes a key. So the answer can't go stale.
- **The restated carry breaks "a restated column is dropped"**
  (`changedColumns`) on purpose, for one path. History shows a pin
  unchanged, which is what happened: the pin stayed and became theirs.
- **A common-knowledge happening's carry** writes a pin that reaches
  nothing. Harmless; not special-cased.
- **Both pins the user's:** the loser's is lost, by decision 3.
- **A copy's value can outlive the write that set it.** A close's
  `set_pin` on the loser's row, later reversed by a chapter delete,
  stays on the copy, as a swept pass's fact already does
  ([`world.md → Reversibility`](../ui/screens/world/world.md#reversibility)).
  Not changed here.
- **Plot's happening save doesn't claim a pin by accident.**
  `register-awareness.ts` drops a field sent unchanged, so only a pin
  the user moved writes the key.
- **Dev databases.** Copies made before the build have no mark and read
  as the user's until a reseed. No users until the MVP.
- **Not verified:** whether a periodic pass in practice cites prose
  older than a World merge made inside its window. It doesn't change
  the design: those reads are kept as they are.
