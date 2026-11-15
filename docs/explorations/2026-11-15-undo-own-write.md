# An undo that reverts only its own write

How a reversal undoes a write without taking a later write back with
it. Designed 2026-11-15; resolves the Data-model followup "An undo
restores a whole prior value over later writes" (all three of its
cases) and widens to one yield rule for every field and every
reversal. The code is a plan-mode followup that has to land before
Slice 5.13 is planned.

## Why

A write's undo stores the value it replaced, and reverse-replay
assigns it back. Three cases lose a later write that way:

1. **A keyword write's undo restores the whole prior list.** A
   rollback reverses turn 5's keyword write and spares turn 3's,
   logged after it; the restore takes turn 3's terms away, and the
   clamped watermark never re-reads turn 3.
2. **Undoing a user's keyword edit wipes a later pass's term.** CTRL-Z
   restores the whole list over the pass's append, and the pass's
   stale before-list then credits a term the user had to the pass, so
   a close may remove it. That breaks the v1 rule that a close never
   removes a keyword the user wrote
   ([`retrieval.md → Keywords schema`](../memory/retrieval.md#keywords-schema)).
   The close's own keyword writes (2b) lose a later pass's term to
   CTRL-Z the same way.
3. **A count bump's undo brings back a pre-reset count.** A close
   runs in the background, so a turn past the chapter's end logs a
   `retrieval_count` bump before the close's reset lands. A rollback
   past the end reverses the bump and spares the reset, and the
   bump's undo assigns the pre-reset count over the reset's 0
   (`lib/pipeline/__tests__/close-round-trip.test.ts`, the later-bump
   case).

## Ground truth that shaped it

- **Undo already yields to later writes, coarsely.**
  `restorablePayload` (`lib/actions/delta/reverse-replay.ts`) drops
  every column, or `state` sub-field, that a surviving later write
  changed. A list is one leaf: entity and lore `keywords` have no
  column schema, and arrays inside `state` are leaves to the encoder
  (`delta-encoding.ts`).
- **Most reversals yield only to the user.** CTRL-Z
  (`lib/actions/story-entries/undo.ts`), rollback and abort run in
  `YieldTo = 'user'`; only chapter delete and its re-run run in
  `'any'`. A reversed user delta yields to nothing (`writesOutliving`,
  `user-precedence.ts`), which canon states: "CTRL-Z of the user's own
  action is never filtered."
- **The undo payload is read far beyond undo.** History's labels,
  `keywordAuthors` and `priorTerms` (`keyword-authors.ts`), user
  precedence's `carriesColumn`, the later-turn rule and the closure all
  read it as the field's prior value.
- **Redo restores a snapshot, not the payload.**
  `RedoSnapshot.rowBeforeUndo` (`redo.ts`) holds the whole row from
  before the undo.
- **Canon already derives a write's result from the chain.** The diff
  cache's walk
  ([`architecture.md → Walk algorithm`](../architecture.md#walk-algorithm))
  steps back from the live row through each later delta's payload.
- **Scalars dodge case 2 by user precedence.** A pass can't overwrite a
  scalar the user wrote after its prose, so CTRL-Z of a user edit never
  meets a later pass write to the same scalar; `appendEntityKeywords`
  appends other terms to the same column, which is why the followup
  read as list-only. CTRL-Z of a close has no such guard: the pass over
  the turns past its end lands after its group and can write any field
  the close wrote.

## Decisions

- **One rule for every reversal and every field** (developer,
  2026-11-15), not lists and the counter alone: `YieldTo` goes.
- **Approach A:** the undo payload keeps its shape, and a reversal
  rewrites later survivors' prior values. Rejected: storing each
  write's effect beside its prior value (B), which needs the same
  rewrite for the double-undo case and splits every reader between two
  records; and keeping undone deltas as tombstones and replaying (C),
  which rebuilds the substrate.
- **A user's save confirms nothing.** A term a machine write added and
  the user's later save kept untouched still goes when that write is
  undone; only terms the user added or removed are the user's.
- **No confirmation record** (developer, 2026-11-15). A machine write
  whose terms are all present logs nothing, so the narrower variant of
  case 1 is parked ([Parked](#parked)).
- **The code is a plan-mode followup** (developer, 2026-11-15), not a
  slice: about ten source files in one module. It lands before Slice
  5.13 is planned, and this commit adds that dependency to 5.13's doc
  and revises C13.

## The rule

Every reversal (CTRL-Z, rollback, regenerate, abort, crash recovery,
chapter delete, a re-run) undoes only what each of its writes did,
against the current value, and skips any part a surviving later write
changed. A surviving later write is a delta on the same row, logged
after the reversed one, that the set doesn't hold, from any source,
the user's included. A bump alone still makes no other field yield
(C13), and a reversed machine create still keeps its row only for the
user's later writes (`rowKeepingColumns`): that is row existence, not
a field's yield.

The unit an undo yields on, by field kind:

- **Scalars and `state` sub-fields:** as today. The groups that move
  together stay together: the collision flag's three columns, a
  place's parent and unplaced mark, status with `retired_reason`, a
  thread's status with `resolved_at_entry_id`.
- **String lists:** entity and lore `keywords` and `tags`, chapter
  `keywords`, and `state.traits`, `drives`, `agenda`, `inventory`,
  `equipped_items`. One term is one unit: its presence and its
  spelling. The undo removes the terms its write added, puts back the
  terms it removed and restores the spelling it changed, skipping a
  term a surviving later write changed. Keywords and tags match by
  `normalizeTerm`, the rest exactly. A put-back term takes its
  spelling from the write's prior list and returns to its place in
  that list, relative to the terms still there. A list is a set: a
  duplicate is one term.
- **`retrieval_count`:** a counter. A bump is relative; the reset and
  a merge's summed write are absolute. Undoing a bump subtracts it
  unless a surviving later absolute write exists. Undoing an absolute
  write restores its prior value plus the surviving bumps after it,
  unless a surviving later absolute write exists. A count never goes
  below 0.

The split move canon guards against (an item held and lying somewhere
at once) stays out of reach, not out of the rule: a move writes only
the sides it changes, so a later move can yield one side of an undone
move and not the other, but no reversal that takes a move spares a
later move of the same item ([Adversarial pass](#adversarial-pass)).

## Updating later deltas

**A write's result.** For field f, the prior value of the next delta
on the row that carries f, set member or survivor, else the live row,
or the copy a later surviving delete holds. That is the diff cache's
walk. The reversal walks newest-first, so later set members are
already undone when a write's turn comes.

**The update.** In the reversal's transaction, the survivors on the
row that carry the unit, walked forward in log order, get their prior
value rewritten as if the reversed write had never happened:

- **Scalar or sub-field:** the first survivor that changed it takes
  the reversed write's prior value. This also fixes today's double
  undo: a chapter delete reverses a close's `voice` under a user edit,
  and CTRL-Z of that edit then brings the deleted close's value back.
- **List term:** survivors that didn't touch the term get the term
  reversed in their prior list; the first survivor that changed it
  gets the same and stops the walk for that term.
- **`retrieval_count`:** a reversed bump of n lowers later bumps'
  prior counts by n, through the first absolute write; a reversed
  absolute write shifts them by its prior value less the value it
  wrote, through the next absolute write.

The live row changes only when no survivor stopped the walk.

**A survivor rewritten into a restatement keeps its key.** W sets f a
to b, survivor L sets it b to a, W reverses: L now writes a over a,
and keeps f in its payload, since the payload's keys say who wrote a
field. A user edit stays the user's for user precedence and the
keyword-author walk. An update never deletes a delta.

**The log stays a valid history.** Every survivor's prior value reads
as if the reversed write never was, so `keywordAuthors` credits a
restored term to its real adder, and the diff cache's walk stays
exact. It also retires the residue chapter delete accepted: a later
turn's undo used to write the deleted close's value back, which the
delete confirm warned of ("Undoing one can bring back a value this
removes"). The confirm drops that sentence; the shipped string and its
stories change with the code.

## Redo and the re-run's journal

`prepareUndo` also snapshots the payload of every survivor the
reversal will rewrite, and redo writes them back in its transaction.
Any committed write clears the redo stack, so the snapshot holds until
redo. `keepRedoExact` gains nothing: the update never prunes.

The re-run's journal already covers "every delta row it prunes or
edits"; a survivor's rewritten prior value is one more, written back
with the rest. A survivor the re-run's reversal rewrites sits below
the re-run's first log position, so the exactness check is unchanged.

## Adversarial pass

Verified against the code:

- **Every write to these fields is logged.** The direct `.update()`
  calls on `entities`, `lore`, `happening_awareness` and
  `story_entries` outside `lib/actions/delta` are inside delta
  handlers. Reference clears, which log nothing, touch only scalar id
  fields (`RefPath` is `IdField<EntityState>`, `live-refs.ts`). Raw-SQL
  writes weren't swept.
- **History refreshes after every reversal:** `settleCount` moves when
  `reversalInProgress` clears (`lib/stores/generation/generation.ts`),
  which `bracketProseReversal` sets for CTRL-Z, rollback and chapter
  delete.
- **No writer reorders a list.** Nothing in `components/world` does,
  and a close's `set_keywords` keeps stored order, then adds.
- **A merge's summed count can't drift across rows.** A reversal that
  takes a merge takes its reset: they share one close group.
- **No reversal splits an item move, by reach.** Raised by a side
  review after the canon edit first claimed a move writes both sides:
  it writes only the sides it changes (`lib/piggyback/item-moves.ts`,
  `positionActions` in `lib/world/entity-actions.ts`). What holds is
  that only those two move items, the per-turn writer at its turn, so
  rollback, regenerate and CTRL-Z of a turn take every later move, the
  survival anchor sparing only pass and close facts, which move none,
  and CTRL-Z reaches a World save only with nothing but passes above
  it.
- **A confirmation can't be recorded where it matters.**
  `appendEntityKeywords` refuses a write whose terms are all present
  (`no-new-keywords`, a restated no-op), so it logs nothing. That
  decided the confirmation record out.

Changed by the pass:

- **Spelling.** A term's unit carries its spelling; without that, an
  undo of "Spyglass" to "spyglass" would do nothing.
- **The diff cache's immutability.** Canon's cache keys entries by
  delta id and clears only on restart, safe while an update's old and
  new never change. A reversal now evicts the entries of every row
  whose deltas it rewrites. Today's History shows only field labels
  from payload keys (`lib/history/humanize.ts`), so a rewritten
  survivor's line doesn't change until the cache lands; hiding a unit
  whose old and new values match is part of the cache's contract.

Accepted:

- **A user's removal can stop counting.** A pass adds T, the user
  removes T, the pass's write is undone: as if the pass never ran, the
  user never removed T, so `priorTerms` no longer stops a later pass
  re-adding it. The user can remove it again.

Assumed, not verified:

- **Lists are sets.** Whether the `traits` and `drives` writers dedupe
  wasn't checked.
- **Existing dev databases** carry chains past whole-value undos
  broke. Term and counter undos degrade to wrong but harmless there:
  removing an absent term or putting back a present one does nothing,
  and a count clamps at 0. Reseed; there are no users before the MVP.

## Parked

**A term a surviving turn re-sent can be lost to a reversal.** Turn
5's write adds "the captain"; turn 3's pass, logged later, sends it
again and logs nothing, since the term is present. A rollback to turn
4 undoes turn 5's add and removes the term. Fixing it means logging a
delta for a write that only confirms terms, which turns C11's restated
no-op into a write and adds a delta per known mention per pass. Parked
in [`parked.md`](../parked.md) with case 1's old signal: a keyword of a
surviving turn lost to a reversal.
