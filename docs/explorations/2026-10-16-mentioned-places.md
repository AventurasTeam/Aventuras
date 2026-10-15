# Mentioned places

Resolves the mentioned-places half of the entry in
`followups.md → Data-model` on the periodic classifier creating
factions and mentioned places. The factions half stays there. The
commit that lands this record adds an implementation entry: the
design is settled, the code is not.

The substrate is the per-turn writer's place creates and matcher
([`piggyback.md → New locations and items`](../memory/piggyback.md#new-locations-and-items)),
built by #604 and narrowed for retired and disabled places by #617.
The spec now lives in
[`classifier.md → Mentioned places`](../memory/classifier.md#mentioned-places)
(the setting, what the pass sees and emits, the row and its parent, the
matcher),
[`generation-pipeline.md → No-gate write phase`](../generation-pipeline.md#no-gate-write-phase)
(a pass writes only when no turn is in flight) and
[`cadence.md → Concurrency`](../memory/cadence.md#concurrency). What
follows is why.

## What this closes vs. defers

Closes:

- **Mentioned places.** A place the prose establishes but the scene
  doesn't enter, which the per-turn writer drops as prose, is created
  by the periodic classifier behind a story setting.
- **Which writer wins in one window.** The turn, by sequencing: a pass
  never writes while a turn is in flight on its branch.
- **The closure-gap re-check** the parked entry asks for when the
  classifier creates entities other than characters, for places.

Defers:

- **Implementation**, to a standalone PR (the followups entry).
- **Factions**, the rest of the followup, with the problem this design
  found for it: membership facts make a pass write `entities.state`,
  which a World Save writes whole.
- **Placing a mentioned place later**: re-parenting a place at the root
  once the prose places it, a kind of place outside the tree for
  places nobody can locate yet, and World's missing merge of two
  unflagged rows. Parked.

## Ground truth that shaped it

- **This is enrichment.** The 2026-10-10 design moved mentioned places
  from a per-turn toggle to the classifier because nothing breaks
  while they're missing. Their job is mainly the narrator's
  consistency (a place the story established keeps its name, its place
  in the tree and its first description), and secondly the world
  record, which also tells the user which places exist.
- **A per-turn place is thin.** `newRow`
  (`lib/pipeline/definitions/per-turn-creates.ts`) stores a name, a
  clamped description and a parent, `active`, `auto`, with no keywords
  or `condition`. A place made from a mention has the same shape, so
  two rows for one place differ only in which description they carry,
  and the entering turn's is usually the better one.
- **The per-turn writer matches against the entities it read when its
  narrative phase started** (`lib/pipeline/definitions/per-turn.ts`,
  the working set at the phase's start, used by `planTurnCreates`
  after the stream), and a pass's writes can land mid-stream: the
  classifier is `no-gate`, and neither pipeline's `blockedBy` names the
  other. The common flow puts them together: a turn mentions a place
  and crosses the cadence, the pass starts, and the next turn, the one
  the user sends, goes there. A pass that creates the place during that
  turn's stream leaves the writer creating a second, unflagged one.
- **The pass already re-reads after its model call**
  (`lib/pipeline/definitions/periodic-classifier.ts`), but it plans
  before taking its write lock, with the character reconciliation's
  embed calls in between.
- **Only two things wait on a pass.** A prose reversal waits with
  `cancel`, and runs outside any turn (regenerate brackets before and
  after its run, `lib/actions/turns/regenerate-turn.ts`). Chapter
  close's phase 0 waits with `finish`, and a chained close starts after
  the turn has left `txState`.
- **A prose edit's sweep spares entity creates of every kind**
  (`isReversible` in `lib/actions/story-entries/classifier-facts.ts`),
  CTRL-Z skips classifier groups, and a pass's abort runs inside its
  lock.
- **Layer A hides a staged entity whose name is in recent prose**
  ([`edge-cases.md → Layer A`](../memory/edge-cases.md#layer-a--retrieval-time-same-name-suppression)).
  A mentioned place's name always is.

## Decisions

**Behind a story setting, off by default.** Until now the map grew
only with places the story visited; with this setting it grows with
every place the story mentions. That's the cost the user opts into.

**Created `active`, not `staged`.** "Exists, not yet visited" reads
like `staged`, but Layer A would then keep the place out of retrieval
at exactly the turns that mention it, which defeats the second
purpose. The map, exempt from Layer A, would show it either way.

**Which mentions count.** Any named place the prose establishes as
real in the story's world, however far off ("she grew up in Varn"), and
an unnamed one with an identity the story could return to; not a
generic kind of place, not one in a hypothetical, a dream or a figure
of speech, and not a listed place under another name, which becomes an
alias. Rejected: only places the story points toward, which needs the
model to guess the story's direction; and any place the prose
describes, which is noise for little consistency.

**The pass sees every place as a tree, whether or not the setting is
on.** It needs the tree to parent a new place, and the nesting helps it
tell one "back room" from another when it names a happening's site.
Rejected: the narrator's map, which hides places the pass must still
name; and a tree only when the setting is on, which keeps two prompt
shapes for one gain.

**An unknown parent puts the place at the root, where it stays.** After
the first write, `parent_location_id` is the user's. Rejected for now:
a pass re-parenting a root place once the prose places it, which widens
the authorship contract and needs user precedence and reversal handling
for the parent, and breaks `same-parent` flags; and holding a place
back until its parent is known, which can't tell a top-level region
from a place whose parent the model doesn't know. Parked, with the
developer's idea of a kind of place that sits outside the tree.

**The turn wins, by sequencing.** A pass writes only when no turn is in
flight on its branch, and plans its places inside its write lock
against the rows as they stand. In an overlap the turn's create always
commits first and the pass reuses it: the turn wrote from the newest
prose. Rejected: whoever commits first wins, with both writers
re-matching, where the pass's older description wins the race and
making the turn win means a second machine-written description against
the authorship contract; and flagging instead of resolving, which
leaves every race as a pair to merge.

**The pass matches by the per-turn writer's sibling rule, over real
children.** One rule for both writers keeps World's `same-parent`
review the single place a doubtful pair goes. The per-turn writer
rebuilds the set its map hid; the pass saw every place, so its real
children are the whole set. A reused staged place stays staged because
a mention, unlike a move, doesn't bring the story there.

**The setting is read once per pass,** so a reply is never judged by a
setting its prompt didn't follow.

## Adversarial pass

- **Load-bearing: nothing but the turn writes an entity's row while a
  turn is in flight.** Verified from the declarations: the turn's hard
  gate blocks user writes, every other kind is blocked by `per-turn` or
  chained after it, and the pass now waits. Assumed, not checked: the
  embedding sync stage and the background embed worker touch vectors
  and `embedding_stale` only.
- **The admission race.** A turn starting between the pass's check and
  the end of its burst would reopen the race; the plan has to close it
  without refusing a Send.
- **The pass re-reads global stores.** Nothing found cancels a pass
  when its story closes, so a re-read could see another branch's rows
  (unverified, and older than this design). The wait doesn't widen
  it, since it lasts only while a turn runs on the pass's branch, but
  planning under the lock should check the stores still hold its branch,
  as the per-turn working set does.
- **Two parents, one place.** A place the pass puts at the root and a
  turn nests elsewhere are never compared, so they stay a duplicate,
  and World can't merge them. Parked with re-parenting.
- **A mention edited away.** A prose edit's sweep keeps the place, as
  it keeps a classifier-made character, so it stays on the narrator's
  map until the user deletes it.
- **The map's size.** Mentioned places add lines the structural floor
  pays for. Unmeasured; the token breakdown followup is the signal.
- **The significance rule** is untested with real models; the setting
  is off by default.
- **Starvation.** If turns ever ran back to back with no gap, a pass
  would never write.
- **The closure gap.** Re-checked by reading the reversal canon and
  code: only the existing boot-recovery window can remove a pass's
  place while a later turn's JSON names it.
