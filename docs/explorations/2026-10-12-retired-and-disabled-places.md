# Retired and disabled places

Resolves the entry in `followups.md → Data-model` on leaving places off
the `# Places` map. The commit that lands
this record replaces it with a one-line implementation entry: the
design is settled, the code is not.

The substrate is the per-turn writer's location map and place matcher
([`piggyback.md → New locations and items`](../memory/piggyback.md#new-locations-and-items)),
built by #604. The spec now lives in
[`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)
(what retired and disabled mean for a place),
[`piggyback.md → What the writer sees`](../memory/piggyback.md#what-the-writer-sees)
and [`→ Matching before creating`](../memory/piggyback.md#matching-before-creating)
(the map and the matcher), and
[`world.md → Settings`](../ui/screens/world/world.md#settings--entity-management-chrome)
(the confirms and refusals). What follows is why.

## What this closes vs. defers

Closes:

- **The unflagged duplicate.** A place whose parent the map hides
  showed under the parent's nearest listed ancestor, while the matcher
  compared a re-created place only with the real parent's children, so
  re-creating the place by its exact name under the parent the model
  saw made a second, unflagged row.
- **Machine retirement of places.** The periodic classifier could
  retire any entity on "structural dissolution", so "the inn burned to
  the ground" could retire The Rusty Anchor, after which the next scene
  in its ashes re-created it.
- **Children left behind.** Retiring or disabling a place touched only
  its own row, so its active children sat inside a gone or hidden
  place.
- **Triage's item on the entity snapshot the per-turn writers plan
  against.** Its every route was a place retired mid-turn, and nothing
  can retire a place mid-turn any more.

Defers:

- **Implementation**, to a standalone PR (the followups entry).
- **Who writes `condition`.** A destroyed place stays active with its
  destruction in `condition`, which no machine writes today; the
  chapter-close design owns that question.
- **The periodic classifier's view of places.** It sees every place,
  flat; the mentioned-places followup gives it a full tree when it
  starts creating places.

## Ground truth that shaped it

- **The defect has three cases, and only two are about hidden
  parents.** A listed place under a hidden parent, and a hidden place
  under a hidden parent, both match against the wrong set. A retired
  place re-created by name is a fresh row wherever its parent is,
  because canon compared active and staged siblings only.
- **`disabled` means "never reaches the prompt".**
  [`principles.md → Injection / retrieval rules`](../ui/principles.md#injection--retrieval-rules-for-prompt-context)
  defines it so, with the structural floor as the only exception. Two
  of the followup's three candidate fixes (always list disabled places;
  show a hidden parent as a bare name) put a disabled place's name in
  the prompt, which gives away a place disabled as a secret.
- **A destroyed place is still a place.** Canon's only retired-place
  example was "temple destroyed in quake", yet ruins can be visited,
  searched and camped in, and `LocationState.condition` already holds
  "war-damaged" and "abandoned since the plague".
- **Nothing kept a new place out of a retired one.** The per-turn
  planner accepts any location id as a parent
  (`lib/pipeline/definitions/per-turn-creates.ts`); only the map
  hiding retired places kept it from happening, and a retired place
  pinned `always` still reaches the prompt with its id.
- **The listing can't change mid-turn.** `parent_location_id` is
  written only by the user or the per-turn create, status and mode
  edits are blocked while a turn runs
  ([`principles.md → What's gated`](../ui/principles.md#whats-gated)),
  and the classifier no longer retires places. So the matcher can
  rebuild the prompt's map at fold time.
- **The `.avts` import drops `parent_location_id`**
  (`lib/avts/entity.ts`), so an imported place lands at the root and
  can't break the retired-place invariant.

## Decisions

**A retired place can't be entered, and only the user retires one.**
The test was: if a retired place can be entered, nothing separates it
from an active place whose condition reads "sank beneath the waves".
So retired means gone, destruction is a condition, and the classifier
never retires a location. Rejected: keeping machine retirement with a
narrower prompt, which still leaves a misfire hiding a place the story
returns to.

**Retiring cascades, stored.** The temple on a sunk island is gone too,
so retiring a place retires every place inside it, in one action.
Rejected: computing "retired through an ancestor", which every reader
of `status` would have to learn (retrieval, World's lists, the matcher,
the location checks); and refusing to retire a place with active places
inside, which is tedious for a region of rooms. Stored is safe here
because a retire is a fact about the world, so the children keep no
state of their own worth restoring, and one undo restores the cascade.

**No active or staged place inside a retired one.** The cascade makes
it an invariant, so every write that could break it refuses or
redirects: retiring while the story is inside, bringing back a place
whose parent is retired, creating or moving a place into a retired
one, and a merge whose result breaks it. A per-turn create naming a
retired parent goes to the root, as an unresolvable parent already
does.

**Retired places stay on the map, without ids.** Showing them keeps the
tree true for their children (in older data) and tells the model a gone
place is gone, so it doesn't re-create it from the prose. Without an
id, the model can't move the scene there or nest a place under it.

**Disabling cascades, computed.** A disabled region's rooms leaking onto
the map, filed under the region's parent, defeats most reasons to
disable a place. Computed rather than stored because disabling is a
visibility setting: each place keeps its own mode, and re-enabling the
parent gives the children theirs back. It can't be map-only, or a room
retrieved by keyword would reach the prompt with an id the map doesn't
show, so retrieval reads the same effective mode. Rejected: skipping the
disabled place in the tree, today's behaviour, for the leak.

**Disabling is refused while the story is inside,** like retiring, and
the scene editor offers neither retired nor disabled places. The user
always has a better route into a disabled region: re-enable it first.

**The model's move into a disabled region is a discovery.** The model
can't see a disabled place, so when the prose walks into one, matching
the re-created place to the disabled row is what stands between "the
story found the Vault" and a duplicate. While the story is inside, an
ancestor's disabling doesn't spread to the places around it, so the
map stays usable; it closes again when the story leaves. Rejected:
accepting a map that lists only the current room inside the region,
which makes duplicates whenever the model nests a room under the room
it's leaving; and never reusing a disabled place (create it flagged and
let review decide), which reverses #604's reuse, leaves a flagged
duplicate per discovery, and misses rooms deep inside the region.
Retired is a fact about the world; disabled is a setting about the
prompt, so the story may be in a disabled place but never a retired
one.

**The matcher reuses by the map's view and flags by real siblings.**
Reuse compares a new place with every place the map would have shown
under the named parent had the hidden ones been listed, so a place
hidden from the model is still found. Flagging keeps to real siblings,
because World pairs a `same-parent` flag only while the two share a
real parent; a partner found through a hidden place would be dormant
the moment it was written. Rejected: World pairing by the map's view,
which depends on the current location and the modes and so flickers;
and a new `same-area` reason, which costs a schema value and its own
pairing rule for a heuristic miss. Retired siblings join the flag
candidates, never the reuse ones, so a retired place comes back only
through review.

**The periodic classifier keeps its flat list for now.** It already
sees every place with its id, so nothing is hidden from it and real
siblings are what it sees. A tree serves it only when it creates
places, and then it needs the full tree, not the narrator's map, which
drops places it must still be able to name.
