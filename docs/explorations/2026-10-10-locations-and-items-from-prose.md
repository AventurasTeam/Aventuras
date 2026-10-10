# Locations and items from prose

Resolves `followups.md → Data-model`'s
`Nothing introduces a location the prose moves to`, including its
closing note that items share the gap. The commit that lands this
record replaces the entry with a one-line implementation entry: the
design is settled, the code is not. It reuses the namesake matcher,
flag, partner and reason designed in
[the partial-name collision record](./2026-10-10-partial-name-collisions.md),
so its implementation follows that one.

The spec lives in
[`piggyback.md → New locations and items`](../memory/piggyback.md#new-locations-and-items)
and the sections it links; what follows is why.

## What this closes vs. defers

Closes:

- **A move to a new place.** The per-turn writer creates the location
  in the turn, so the scene's location, and every in-scene character's,
  is right on the turn the prose moves.
- **A move to a known place retrieval didn't offer.** The per-turn
  prompt carries the whole location map.
- **An item first met in prose.** The per-turn writer creates it when
  someone takes or receives it, so the transfer lands.
- **The parent chain in the prompt**, which canon's LocationState
  specified and no template rendered.
- **The followup's open sub-questions.** Interim names and back-fill
  dissolve, since nothing is interim; the parent is set at creation;
  "major" becomes the significance rules plus "kept only if used"; one
  place's name variants collapse through sibling matching.

Defers, each to its own followup:

- **Factions and mentioned-but-unvisited places**, to the periodic
  classifier.
- **Upkeep of places and items** (state, keywords, description
  refresh), to the chapter-close agent design.
- **A per-turn token breakdown**, which the map's cost made worth
  having.

## Why the 2026-10-05 direction was reversed

That direction had the per-turn writer emit an interim place name and
the periodic classifier reconcile it later. It fits locations alone
tolerably, but items are per-turn state too, and there it gets heavy:
an interim transfer has to be stored and replayed at reconciliation,
replaying it writes item ids into characters' `inventory` arrays
(ids inside JSON, the parked closure gap) on a path that runs often,
and the gap lasts up to `classifierCadence` turns every time.

The split that replaced it is by urgency. Locations and items are
per-turn state: the per-turn writer names them every turn, and a
missing row makes that turn's state wrong at once. Characters and
factions are narrative introductions that can wait for a pass. So the
per-turn writer creates locations and items, in the turn's own action
group, and the periodic classifier keeps characters and, later,
factions. Creating per-turn means no interim state, no back-fill and no
lag, and undoing or regenerating the turn removes the row with the
writes that name it.

## Decisions

**The whole map, as a tree.** A writer that can only name the
locations retrieval offered can't move to a known place retrieval
missed; listing every active and staged location by name and id, nested
by parent, fixes that without new rows. It is also the first line of
duplicate defence, since the writer sees what exists.

**Held items are shown.** The per-turn prompt never rendered
inventories, so a character's own sword was invisible to the writer
and would have been re-created. In-scene characters' held items and the
current location's loose items give the writer the handles a scene can
touch.

**Kept only if used.** A new location survives only as the current
location or an ancestor of it; a new item only when a transfer gives it
to a holder. That is the code-side half of the significance rule, and it
keeps passing mentions out. A mentioned place that isn't entered was
considered for a per-turn toggle and moved to the periodic classifier
instead: nothing breaks while it's missing, the classifier sees a
window and the roster to judge significance and the parent, and a
mentioned place's parent is usually unknown in a single turn.

**The writer sets the parent.** It knows narratively where the place
slots in and sees the map; a parentless place for a few turns would sit
misplaced at the root of every prompt and be compared against the wrong
siblings. A new location can't close a cycle, having no children, so
only the existing chain is walked, against the depth cap.

**Locations match their siblings only.** The parent hierarchy confines
real duplicates to similar names under one parent: two taverns in two
cities are distinct by construction. An exact sibling is the same place
the writer failed to reference, so it is reused; a partial sibling is
flagged with the reason `same-parent`, because the shared parent is the
evidence and a similarity line would leave the user asking why it
flagged. A parentless copy of a nested place goes uncaught, accepted:
the map makes the parent obvious and World shows the copy misplaced.

**Items are never reused.** A sword picked up while another "sword"
exists elsewhere is usually a different sword, and reusing it would
teleport the other into the new holder's hands. Only exact namesakes
are compared, by description, and only alike descriptions flag; with no
evidence the default is a different item.

**Enrichment waits for chapter close.** The per-turn create carries a
name, a short description and, for a location, its parent. The periodic
classifier has no path to amend descriptions or set location and item
state, and chapter close already does chapter-scope upkeep of entities.

**Settled during integration.** A `disabled` location means disabled:
it leaves the map, except as the current location, which the floor
seats whatever its mode, and the injection-mode copy says a place's
mode governs its description while its name sits on the map. The map
and held-item lines count with the structural floor's tokens rather
than sitting outside every budget. The map is exempt from Layer A's
staged-name suppression, since it carries names only and naming the
place is how a move to it resolves. And `stateReport` records each
create's outcome and resolved id, so the entry card's "Changes this
turn" can list new and matched places and items.

## Adversarial pass

- **The narrative model emitting the tags well.** The block parses
  best-effort per top-level tag, so a malformed create drops alone and
  a `<current_location>` naming it falls back to today's inherited
  location. How often real models get handles and parents right is
  unverified.
- **Re-parenting a flagged pair.** A `same-parent` pair is a pair
  because of its shared parent; a re-parent that separates the two now
  clears the flag, as a rename that breaks a name match does.
- **The map's size.** Unbounded but growing only with visited places;
  tens of places cost a few hundred tokens. Not measured; the token
  breakdown followup is the signal to collapse distant branches.
- **An item listed twice**, in the scene and in its holder's line. The
  template lists it once, under the holder.
- **The periodic followup.** Once mentioned places land, two pipelines
  create locations, so that design must apply the same sibling rule and
  settle which writer wins in one window.
- **The parked JSON-columns gap.** Its revisit signal (a machine writer
  creating entities other than characters) fired. Re-checked by reading
  the reversal canon: CTRL-Z is newest-first; rollback, regenerate and a
  fork's reverse-apply take every later write; a prose edit's sweep
  spares entity creates; an aborted turn has nothing after it. So no
  reversal removes a per-turn create while keeping a later write naming
  it, apart from the boot-recovery caveat the entry already carries.
  Verified against canon, not by test.
