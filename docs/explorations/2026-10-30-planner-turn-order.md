# Planning a reply in turn order

What the periodic classifier's planner judges each fact against, and
when a rename's outcome is decided. Designed 2026-10-30; resolves the
design half of the followup "`buildClassifierActions` has outgrown one
function" and leaves its implementation as a new followup.

## Why

The planner plans a reply list by list, each list judged against what
the earlier lists planned as though it landed. Canon judges a fact
against what earlier facts in the reply changed, so two facts from
different turns and different lists can be judged in the wrong order: a
turn-1 rename judged where a turn-3 move leaves the place, a turn-3
mention of a new "Varn" creating a second Varn beside the mill turn 1
renamed, a turn-1 retire of a staged character planned after a turn-3
mention promotes it. The AI writer map's slice review proposed one
queue in turn order (its option A) and left three cases open.

## Ground truth that shaped it

- **Canon never ordered one turn's facts across lists.** A status
  transition is judged against "what earlier facts in the same reply
  changed"; placements, new places, memberships and keyword writes each
  order their own facts by turn, ties in the reply's order. Nothing
  said whether a turn-1 rename comes before a turn-1 new place.
- **Only some lists change what another reads**: creates and matches,
  placements, renames, aliases and mention terms, status flips.
  Memberships and standings read the rows from before the reply on
  purpose; happenings, awareness, relationships and threads change
  nothing a later fact reads. Characters and factions are reconciled
  before the planner, whose reveal rule absorbs a newcomer the reply's
  own rename names, whatever the turns (`lib/classifier/reconcile.ts`).
- **The late parent was no integrity bug.** A turn-1 place under a
  turn-3 new place is judged when its parent settles, so it can take
  over a place the reply creates at turn 2 and write on it at turn 1.
  The reversal closure takes every write to a row whose create it
  reverses (`generation-pipeline.md → Reverse-replay`), so a reversal
  stays sound; reverting turn 2 loses a cellar turn 1 mentions.
- **The followup's likely fix for it mis-merges.** Created unplaced at
  its own turn, the place is compared by exact name with every place
  (`matchUnplaced`), so a lone Cellar under the Keep is reused at turn
  1 and moved under the Loft at turn 3. Waiting for its parent, it's
  matched under it (`matchPlaced`), where only an unplaced namesake is
  reused.
- **The burst writes in plan order.** The pass yields its planned writes
  one by one (`lib/pipeline/definitions/periodic-classifier.ts`), each
  checked against the rows as the earlier ones left them.
- **A rename's outcome was fixed at plan time.** The planner sent
  either a rename or a clash's keyword and flag. The rename handler
  refuses a holder found only as it lands (`nameHeldByOther`) and
  writes nothing; a clash planned against a rename a user edit then
  refuses leaves the second row only the keyword, its flag refused as
  no namesake.

## Decisions

**One queue in turn order.** The facts that change what another fact is
judged against plan as one queue: new characters and factions with
their promotes and known mentions' terms, placements, renames and
aliases, new places with their reuse terms and placements, status
flips. Each is judged against the snapshot plus what the facts ahead of
it changed. Rejected: _list by list_, today's, the cause of the three
cases above.

**Within a turn, renames and aliases come before new places.** The
order is the list above; ties within a list keep the reply's order, a
fact with no source turn counting at the newest. A turn that reveals
the mill as Varn and also declares a new Varn under the same parent
then reuses the renamed mill, as the reveal rule absorbs a character
newcomer. Rejected: _new places first_, today's, which creates the
duplicate and flags the mill for the user to merge.

**Writes land in queue order.** A rename decided as it lands must find
the reply's earlier-turn writes landed and its later-turn writes not,
or the rename-against-placement case returns at write time. Anchors
don't change.

**A late parent keeps waiting.** A new place whose parent is a later
turn's new place is judged when its parent settles, anchored at its own
turn, as today; canon now says so. Rejected: _unplaced at its own turn,
placed at its parent's_, which mis-merges as above.

**A rename is decided as it lands.** The planner sends one
`renameEntity` and predicts its outcome for the view; the handler
renames when no holder stands, else writes the clash's keyword and
`name-taken` flag, each column keeping its own precedence. It fixes
both the refused-first-rename loss and its mirror, a holder found only
as the rename lands, which wrote nothing. Rejected: _accept the loss_,
cheap since both need a user edit between a turn and its pass, but it
loses a reveal no later pass revisits.

**The twin across a placement stays settled.** The developer kept the
twin rule; fixing it means keying the twin on where the first row sits
by then, which reopens the twin of a create a takeover placed. Parked.

## The design

Canonical in:

- [`memory/classifier.md → Planning order`](../memory/classifier.md#planning-order):
  the queue and the order within a turn;
- [`memory/classifier.md → What the classifier writes`](../memory/classifier.md#what-the-classifier-writes):
  the rename decided as it lands;
- [`memory/classifier.md → Mentioned places`](../memory/classifier.md#mentioned-places):
  the late parent;
- [`memory/cadence.md → User edits and classifier writes`](../memory/cadence.md#user-edits-and-classifier-writes):
  the rename's clash judged as it lands.

## Adversarial pass

- **Load-bearing**: writes land in queue order, each handler reading
  the rows as the earlier ones left them. The order is verified (the
  pass yields `plan.planned` in order); the visibility is assumed, as
  the rename's write-time check already relies on it.
- **Two holder rules**: the planner predicts with its own name view and
  place comparison, the handler decides with `nameHeldByOther`. Unless
  the implementation shares one rule, the prediction drifts from the
  outcome on more than refusals.
- **A prediction a refusal overturns**: a later fact planned against a
  predicted rename lands against a clash instead. The two-layer
  check's standing limit, accepted.
- **The clash log** (`classifier.rename_clash`) comes from the planner,
  so it reports a prediction; the outcome is the handler's to log.
- **`raiseCollisionFlag`** keeps no classifier caller. It stays: logged
  deltas name it (`lib/actions/delta/apply-delta-action.ts`), and chapter
  close may raise flags.
- **Read sites**: `lib/classifier/plan.ts` and its tests, whose cases
  pinned to list order change; the rename handler and its tests; the
  clash log and its test. Nothing else calls the planner, so the probe
  and the evaluation set are untouched.
- **Stored data untouched**: no schema change, no migration. A rename's
  delta covers name and keywords or keywords and flag, columns that
  reversal and redo already handle per row.

## Integration plan

- `memory/classifier.md → What the classifier writes`: a `### Planning
order` subsection after the list (the queue, the order within a turn,
  writes landing in queue order); the status-transition bullet's
  "earlier facts in the same reply" points at it; the Names bullet
  decides rename or clash as it lands.
- `memory/classifier.md → Mentioned places`: the Parent paragraph gains
  the late parent.
- `memory/classifier.md → Disambiguation on new-character mentions`:
  the `name-taken` line has the flag come from the rename as it lands.
- `memory/cadence.md → User edits and classifier writes`: the clash's
  flag raise planned against the stored flag becomes the rename decided
  as it lands.
- `followups.md → Data-model`: "`buildClassifierActions` has outgrown
  one function" is replaced by "Implement per-row planning"; "Parked
  items play gives a signal for" gains the twin.
- `parked.md → Parked until signal → Memory pipeline (parked)`: "A twin
  across a placement", the followup's bullet carried over.
