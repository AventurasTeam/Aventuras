# Classifier factions

Resolves the factions half of the entry in `followups.md → Data-model`
on the periodic classifier creating factions and mentioned places; the
mentioned-places half was designed 2026-10-16. The commit that lands
this record adds an implementation entry: the design is settled, the
code is not.

The substrate is the classifier's character path: the new-character
list, Layer B
([`classifier.md → Disambiguation on new-character mentions`](../memory/classifier.md#disambiguation-on-new-character-mentions)),
the live-row guards and user precedence
([`cadence.md → User edits and classifier writes`](../memory/cadence.md#user-edits-and-classifier-writes)),
and #624's reversal clear of a reference inside `state`
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).
The spec now lives in
[`classifier.md → Factions`](../memory/classifier.md#factions) (what
the pass sees and emits, matching, the row, memberships), `cadence.md`
(the membership guard, per-field precedence and the Save gap) and
`generation-pipeline.md → Reverse-replay` (the faction reference).
What follows is why.

## What this closes vs. defers

Closes:

- **Faction creates.** The classifier creates the factions the prose
  establishes, matched by Layer B against the branch's factions.
- **Memberships.** The classifier sets and clears a character's
  `faction_id` from prose, which the authorship contract gave it and
  nothing machine-wrote until now.
- **How a membership meets a World Save**, which the followup named
  as the open problem: smaller than it said, and settled below.
- **The closure-gap re-check** for the faction ids a pass writes into
  `state`.

Defers:

- **Implementation**, to a standalone PR (the followups entry).
- **Entity state in the narrator's prompt**, a new followup. No entity
  `state` reaches the narrator but held items, the items lying here and
  the location map, so a character's faction is invisible to it, and so
  are `visual`, `traits`, `drives`, `voice`, a place's or item's
  `condition` and a faction's `standing` and `agenda`. Which fields
  render, where, and at what budget is one decision across every kind,
  not one to settle for factions alone.
- **The Save gap below**, written into `cadence.md → What stays open`
  beside the keyword one.

## Ground truth that shaped it

- **Nothing reads a character's faction.** A retrieved or pinned
  entity renders as its name, status and description
  (`lib/retrieval/rendered-text.ts`, `lib/prompts/bundled/memory-blocks.ts`);
  an in-scene one as its name, id, description and `Holds:` line
  (`lib/prompts/bundled/per-turn.ts`). The classifier's entity lines
  carry kind, name, description and keywords
  (`lib/pipeline/definitions/classifier-context.ts`). The per-turn
  writer emits a visual change as the full new value without being
  shown the current one (`lib/prompts/bundled/state-emission.ts`),
  which the narrator followup also covers.
- **A World Save already spares an untouched field.** The form
  refreshes every field the user hasn't touched when the row changes
  in the store (`hooks/use-row-save-session.ts`), and the Save rebuilds
  `state` from the store's row at Save, writing only the fields the
  user changed (`lib/world/entity-actions.ts`). What's left is the gap
  between building the Save's actions and their commit, which can
  include waiting on the write lock while a pass's burst holds it.
- **User precedence is per column.** A Save writes the `state` column,
  so a traits edit would block every membership from older prose. The
  undo payload is per field: the column's schema is one object with
  `faction_id` a nullable leaf, and `computeUndoPayload`
  (`lib/actions/delta/delta-encoding.ts`) records only changed paths.
- **The reversal restores every changed `state` field.** Undoing a
  schema-backed column overlays the undo payload's fields whatever a
  later user edit wrote (`undoUpdate` in
  `lib/actions/delta/reverse-replay.ts`). Unreachable until now: the
  prose-edit sweep takes only `periodic_classifier` deltas
  (`resolveClassifierFactDeltas` in
  `lib/actions/story-entries/classifier-facts.ts`), and no classifier
  fact wrote `state`.
- **#624's reference registry is generic.** A `state` reference is any
  nullable id field (`RefPath` in `lib/actions/delta/live-refs.ts`),
  and the closure's clear reads the registry, not a place.
- **Factions are never in a scene**
  ([`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)),
  so Layer B's scene signal never fires for one. And the per-turn
  writer never creates or names a faction, so no turn races a pass for
  one.
- **Reconciliation runs before the write lock**, against a re-read,
  and planning inside it (`lib/pipeline/definitions/periodic-classifier.ts`).

## Decisions

**No setting; factions are created as characters are.** Mentioned
places were gated because the place map is seated on every turn. A
faction costs nothing until retrieval ranks it, and then competes in
the entity budget like any character. The risk is noise, which the
significance rule addresses. Rejected: a setting off by default, which
leaves factions out of World in stories where the user never finds it.

**Membership is the main allegiance, now.** A pass sets a character's
faction when the prose establishes the group they belong to now and
clears it when they leave; a secondary tie, a past membership, a
disguise or a cover story doesn't count. Rejected: set-only, which
keeps a character who quit listed in the group until the user fixes
it. Joining a faction retired before the reply is dropped as a
misreading; a member at retirement keeps it, since retiring touches no
member. A staged faction is a valid target and isn't promoted, as a
mention reusing a staged place isn't.

**The pass sees each character's faction.** Without it a pass can't
tell a change from a repeat, the reason relationship views are listed.
This is the classifier half of "factions in prompts"; the narrator half
is the new followup.

**Factions reconcile by Layer B, without the scene.** One path for the
classifier's creates. An exact namesake absorbs only above `τ_high`,
and the ambiguous band flags. Candidates in one reply aren't compared,
as with characters: a model repeating itself in one reply makes an
unflagged duplicate.

**A per-field write, checked per field (approach A).** A narrow
handler writes `state.faction_id` alone against the live row, and user
precedence reads the undo payload's fields. Rejected: also closing the
Save gap by making `updateEntity`'s `state` a merge, which changes
every caller's semantics and can't express a removed key without a
marker, for a gap that needs a Save inside a burst; and a membership
link table, against a specced single field that World's picker and
Members list already read.

**Several facts for one character all write**, in source-turn order,
each on its own turn, so rolling back the later turn leaves the
earlier membership the prose still holds.

**A removed faction is cleared from its members, not taken back.**
Registering `faction_id` gives it #624's clear: the character stays
with its facts and no faction, as World's delete of a faction leaves
its members. Taking the membership back would restore an earlier
faction, but would also, rule-wide, undo a user Save that set the
faction beside other fields.

**A reversal keeps what the user wrote since, field by field, and
never restores a dead id.** The first is the rule `cadence.md` already
states, now enforced inside `state`. The second covers a sweep
restoring a faction the user deleted since: it writes null, the
counterpart of the filter that drops a restored link whose far end is
gone.

## Adversarial pass

- **Load-bearing: the undo payload is per field.** Verified by
  reading the schema and the encoder; a schema change that made
  `state` a union would make every Save look like a faction edit.
- **The Save gap shields as well as reverts.** A Save committed after
  a burst writes the older faction, and its delta records that as the
  user's change, so per-field precedence then blocks that membership
  from older prose. Rare, in the user's favor, and written down.
- **World's delete re-points from a snapshot.** It clears members'
  factions with whole-`state` patches built before it takes the write
  lock (`lib/world/entity-delete.ts`), so a membership landing in
  between would be overwritten, or a character a pass just put in the
  deleted faction would keep naming it. Found by the drift pass; the
  delete now builds under the lock's shared hold, as the collision
  merge already does.
- **A faction created during reconciliation.** Reconciliation runs
  before the lock, so a faction the user creates in that window isn't
  compared and can be duplicated unflagged, as with characters. One
  reconciled to a row deleted in that window is dropped for the pass.
- **The clear's cost.** A membership to a faction a later reversal
  removes leaves the character with no faction rather than its earlier
  one. Rare: a membership on an earlier turn than its new faction, or a
  user's create of the faction undone after a pass named it.
- **A retired character.** Layer B can absorb a new character into a
  retired one, which a membership then names; it is written. Harmless,
  and the prose said it.
- **Status flips in the same reply.** The retired check reads the rows
  as they stood before the reply, so a faction the reply retires keeps
  the memberships from the turns before.
- **History.** A membership shows in History as a faction change by
  the classifier (`lib/history/field-labels.ts` has the label); how the
  id renders there is unverified.
- **The narrator still doesn't see it.** Until the new followup lands,
  memberships fill World's record and the classifier's own prompt only.
