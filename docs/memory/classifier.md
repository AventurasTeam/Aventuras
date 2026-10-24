# Periodic classifier contract

A pipeline that runs every N entries (see
[`cadence.md → classifierCadence`](./cadence.md#user-tunable-knobs)),
chained after the turn that brings it due, and blocks the story while
it runs. It reads the recent prose window not yet covered by
piggyback's per-turn writes. Its job is populating the structured
graph that retrieval queries against, and the first profile of
everything it creates. Declares against the framework's Pipeline shape
per [`generation-pipeline.md`](../generation-pipeline.md); see
[Pipeline framing](#pipeline-framing) below for its declaration
values.

## What the classifier reads

The prompt opens with its system half
([`architecture.md → System and user halves`](../architecture.md#system-and-user-halves)):
the role line and the extraction rules, which name the lists they
refer to rather than pointing above. Its user half carries the
branch's world as lists the classifier addresses by placeholder id
([ID handling](#id-handling-in-classifier-output)), then the turns:

- **Known entities** — every character, item and faction on the
  branch, of any status, with its description and keywords, a
  character with its faction's id when it has one, and a faction with
  its standing
  ([Factions](#factions)). The
  classifier sees the whole roster, so the
  [reconciliation](#disambiguation-on-new-character-mentions)
  below is a backstop for a row the model missed, not a lookup the
  model can't do.
- **Places** — every place on the branch, of any status and mode, as
  a tree with the same details per line, and the unplaced places in a
  group of their own
  ([Mentioned places](#mentioned-places)).
- **Known relationships** — the stored views, as the relationships
  bullet below describes.
- **Known happenings** — the branch's happenings by id and title, so a
  character can learn of one the pass didn't create.
- **Threads** — the branch's threads by id, title and status
  ([Threads](#threads)).
- **Turns to classify** — the window's entries by turn handle, each
  with its prose and the scene saved on it: the entry's
  `sceneEntities` and `currentLocationId`
  ([`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)),
  as the same placeholder ids. The saved scene includes the user's
  corrections and carries forward over a turn that reported none, a
  user action among them: it carries the scene saved before it. An id
  the branch no longer has is left out, so no raw id reaches the
  prompt; an entry with no saved scene shows none.

Two rules lean on the scene and the roster. Prose naming an entity in
a turn's scene refers to that entity. And a shortened or fuller name,
a title or an alias of a listed character is that character, unless
the prose shows it is someone else: it takes the listed id rather than
a `newCharacters` entry, and the new name form goes in the reply's
alias list (the keywords bullet below).

## What the classifier writes

- **Happenings** — `happenings`, `happening_involvements`,
  `happening_awareness`. New rows for events extracted from the prose
  window, each with a free-form `category` and an `icon` from the
  catalog, and `decay_resistance` set per awareness row from the
  model's per-character severity judgment at extraction time. An
  awareness row may also name a happening Known happenings lists, when
  the turns show a character learning of it ("Kael tells Aria about
  the massacre"); a pair the reply repeats lands at its earliest
  learning turn.
- **Status transitions** — `entities.status` flips:
  - `staged → active` when prose mentions a staged entity in scene
    (the slow path; see
    [Staged-entity promotion](./edge-cases.md#staged-entity-promotion)).
  - `active → retired` on hard finality signals only (death, exile,
    faction-disbanded). Conservative bias. Never a location: a
    destroyed place stays active, its destruction a `condition`, and
    only the user retires a place
    ([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).

  - `retired → active` when the turns put a retired character in the
    scene now: not a memory, a flashback, a vision or someone's report
    of them. Never a place.

  Each is checked against the pass's view — its snapshot plus what
  earlier facts in the same reply changed — when planned, and against
  the row as it stands when the write lands. A status the user wrote
  after the flip's prose stands (see
  [`cadence.md → User edits and classifier writes`](./cadence.md#user-edits-and-classifier-writes)).

- **Mentioned places** — with the story's setting on, the places the
  turns mention but the scene doesn't enter
  ([Mentioned places](#mentioned-places)).
- **Factions and memberships** — the factions the turns establish, and
  each character's `faction_id`, set and cleared from prose
  ([Factions](#factions)).
- **First profiles** — when the classifier creates a character or a
  faction, one the
  [reconciliation](#disambiguation-on-new-character-mentions) didn't
  absorb into an existing row, or a mentioned place, it authors the
  initial `description` from prose, and the profile the window shows:
  a character's visual categories, `traits`, `drives` and `voice`, a
  faction's `standing` and `agenda`, a place's `condition`. Within the
  [soft caps](../data-model.md#soft-caps--compaction-discipline), and
  empty where the prose says nothing. A visual category, a condition
  or a standing, a new faction's or a later one, past its bound is cut
  at a clause and logged, as the per-turn writer's is
  ([`piggyback.md → Trailing block format`](./piggyback.md#trailing-block-format)).
  After first introduction it never amends the description, traits,
  drives, voice or agenda;
  chapter close does
  ([`data-model.md → Authorship contract`](../data-model.md#authorship-contract)).
- **Names** — a listed entity's name, when the turns establish it as
  the entity's own: a reveal ("the hooded stranger is Kael"), not an
  alias, a title, a disguise, or a shortened or fuller form of its
  name, which go to its keywords. On a rename the old name joins the
  keywords, so retrieval still finds it. A name is the entity's own,
  or another row's, when the two are exact namesakes, case and spacing
  aside
  ([Disambiguation on new-character mentions](#disambiguation-on-new-character-mentions)),
  so a rename that changes only case or spacing is no reveal and
  writes nothing. A name another row of the
  kind already holds isn't written (for a place, a place it is
  compared with: a real sibling, or any place when either is
  unplaced): the name joins the entity's
  keywords, as a name the turns use for it, and the pass flags the
  entity (`name-taken`) with the oldest holder as its partner, for the
  user to merge. The rename is checked again against the rows as they
  stand when it lands, since a write the pass counted on may have been
  refused by then: a holder found only then leaves the rename unwritten,
  with no keyword and no flag. An entity already flagged keeps its flag
  and gets the keyword only. A flag whose partner is gone, whose pair
  are no longer namesakes once the keyword is counted (World may still
  show the latter's strip), or whose `same-parent` pair no longer share
  a parent
  ([`world.md → Surfacing`](../ui/screens/world/world.md#surfacing))
  counts as no flag: the pass re-points it at the holder.
- **Where a place sits** — a listed place's parent, when the turns
  place one the Places list shows unplaced or move one; and the
  top-level mark for an unplaced place nothing on the map could
  contain
  ([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
  A parent that would close a cycle or sits below a broken chain,
  names a retired place, or is no listed place (a row of another kind,
  or a handle the reply declares, whose create carries its own parent)
  is dropped and logged; so is one that would put a disabled place
  around the story's place (`story-inside`), as World refuses that
  move
  ([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
- **A faction's standing** — when the turns establish a change in a
  listed faction's position: it declares war, is outlawed, comes to
  power.
- **Threads** — the threads the turns set up, and the status of listed
  ones ([Threads](#threads)).
- **Entity keywords** — the same brand-new-entity object carries
  `keywords`: the titles, epithets and relational references the prose
  used for the character alongside its name ("the Grey Wolf", "the
  innkeeper"). These feed the keyword retrieval pathway, which matches
  an entity on its name plus this list — see
  [`retrieval.md → Keywords schema`](./retrieval.md#keywords-schema).
  Unlike `description`, keywords are **not** frozen after first
  introduction: later passes append newly-observed references through
  the reply's alias list, which names a listed entity of any kind and
  the titles, epithets or name forms the prose used for it. Writes
  are strictly append-and-deduplicate against the row as it stands
  when the write lands, and never remove, so user-authored
  aliases survive every subsequent pass, including one added while the
  pass ran. An alias the user removed after the fact's prose is not
  re-added ([user precedence](./cadence.md#user-edits-and-classifier-writes)).
- **Character relationships** — `character_relationships`. One
  perspective per fact, the subject's view of the object and never the
  inferred inverse, upserted into the pair's row as it stands when the
  write lands. The prompt shows the classifier the stored view for
  every stored pair on the branch whose two characters exist (one
  line per non-null perspective), and it is told to emit a fact only
  when the prose establishes a view or changes one already listed. A
  write repeating the stored view, ignoring case and surrounding
  whitespace, is rejected as a no-op at the action layer — it writes
  no delta. So is one against a view the user wrote, or a pair the user
  deleted, after the fact's prose
  ([user precedence](./cadence.md#user-edits-and-classifier-writes)).

## Provenance attribution

Every delta the classifier commits carries a **survival anchor** in
`deltas.entry_id` — the window entry whose prose produced _that row_ — so
a prose reversal spares facts about surviving turns rather than
over-reversing them (see
[`data-model.md → Entry mutability & rollback → Survival anchor`](../data-model.md#survival-anchor)).
The structured output therefore tags each emitted fact with a provenance
handle drawn from its input window; the parse path resolves it to an
`entry_id` and stamps the delta. Sub-rows produced with a parent (a
happening's involvements) inherit the parent's anchor unless independently
sourced — a character learning of an _old_ happening now anchors to the
turn that narrated the learning, not the happening's.

- **Single-turn extraction** → that turn (the common case).
- **Cross-turn synthesis** → the **latest contributing turn**; anchoring
  at the earliest contributor would leave a stale fact standing after its
  newer evidence rolled back.
- **Status flip / first-introduction** → the triggering / introducing
  turn.
- **Unattributed fallback** → the window head, so the fact reverses on any
  reversal into its window (re-derivable) but never survives as an orphan.

Provenance is a **distinct axis** from the narrative anchors
`happenings.occurred_at_entry_id` (where an event sits in story time; `null`
for the temporal / historical class) and
`happening_awareness.learned_at_entry_id` (when a character learned a fact).
They frequently coincide, but the classifier already had to map each
extraction to a window entry to populate those — provenance formalizes the
single per-fact attribution channel that feeds all three, the anchor read
directly and the narrative fields the classifier's judgment on top.

## ID handling in classifier output

References to existing entities in the classifier's structured
output are **placeholders** (`c1`, `l1`, `hp1`, …), not the
underlying `char_<uuid>` / `loc_<uuid>` / etc. forms — the
substitution layer swaps both directions
(see [`generation-pipeline.md → ID placeholder substitution`](../generation-pipeline.md#id-placeholder-substitution)).
The placeholder universe shown to the classifier covers the rows
in the prompt's structured entity, place, happening, thread and
relationship lists.

When the classifier creates a brand-new entity, it emits the
entity as a **full object with no `id` field** — name, description,
state fields, etc. Parse allocates a fresh `char_<uuid>` (or other
kind-appropriate prefix). Any subsequent reference in the same
response uses a temporary handle the LLM picks; the planner maps the
temporary handle to the newly-allocated UUID for the rest of that
reply, outside the idMap. A handle declared twice keeps its first
declaration, and the later entry plans nothing; across the lists that
share the namespace, `newCharacters` claim first, then `newFactions`,
then `newPlaces`.

This separation keeps the LLM's surface area small (no UUID
copying) while preserving the existing disambiguation flow below
unchanged — name-match + embedding-similarity work on prose +
embeddings regardless of how identity is rendered to the model.

## Embedding compute boundary

The classifier emits rows but does **not** embed them: new
happenings, first-introduction entity descriptions, and any other
write touching an embedded field land `embedding_stale = 1` and
leave the vector to the pre-retrieval sync stage, per the
[sync-before-read contract](./retrieval.md#compute-lifecycle).
Nothing embeds on the classifier's write path; the dirty rows are
picked up by the opportunistic background worker between turns and,
as a backstop, by the next retrieving pipeline's sync stage — so the
embed cost stays off the user-facing critical path, decoupled from
the write. (The classifier itself runs as a gated pipeline; see
[Pipeline framing](#pipeline-framing) below.)

If the embedder is still unavailable when that sync stage runs
(local model initializing, provider mode network down), the row
stays `embedding_stale = 1` and absent from vec0, and the stage's
blocking failure path applies. No classifier-specific deferral
mechanism — same path as any other dirty row.

The classifier does not modify already-embedded fields on existing
rows. Status flips (with a retirement's `retired_reason`) and keyword
appends touch no embedded field. If a future extension lets the
classifier modify an embedded field, it flags the row dirty the same
way — no special path required.

The transient embeddings computed in the disambiguation flow below
(the candidate's and its namesakes' descriptions, for the similarity
check) are a decision-time computation, not a persisted embedding
write — outside this boundary.

## Disambiguation on new-character mentions

For every "new character" candidate the classifier extracts, code-side
reconciliation runs before the create / promote decision. It compares
the candidate with the branch's characters (active, staged, retired)
and decides whether to absorb it into one of them, create it flagged
for World-panel review, or create it plain. Candidates in one reply
are not compared with each other.

**Namesakes.** Names compare under the keyword-term normalization
(trimmed, case-folded, NFC), split into words on whitespace.

- **Exact** — the two names are equal.
- **Partial** — not exact, and either one name's words appear inside
  the other's, whole and contiguous ("Kael" in "Kael Stormborn",
  "Innkeeper" in "the Innkeeper", but not "John" in "Johnson"), or one
  row's name is among the other's keywords (a candidate "Marta" whose
  keywords hold "the innkeeper", against a row named "the Innkeeper").

The rule pairs rows of one kind, works for any kind, and lives in
`lib/world` beside World's pairing. The classifier reconciles the
characters and the factions it creates, a faction without the scene
signal below ([Factions](#factions)); the places it creates, and the per-turn
writer's locations and items, match under their own rules
([Mentioned places](#mentioned-places),
[`piggyback.md → New locations and items`](./piggyback.md#new-locations-and-items)). A name in a script written without spaces never
contains another, so it matches only exactly or through a keyword.

**Signals.**

- **Similarity** — every namesake's description is embedded with the
  candidate's in one call and compared by cosine, so the decision
  never depends on whether a vec0 row has drained. A namesake with a
  blank description has no score. No namesake has one when the
  candidate's own description is blank (no call is made), when the
  call fails, or when its vectors don't line up (an embedder swap in
  progress).
- **Scene presence** — whether the namesake is in the saved
  `sceneEntities` of the candidate's `sourceTurn`. Ignored when that
  handle fell back to the window head, since the head's scene isn't
  the candidate's.

**Decision.** The first row that applies wins:

| Condition                                                                                     | Outcome                                                                                                    |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| An exact namesake scores `sim ≥ τ_high`, or scores `τ_low ≤ sim < τ_high` and is in the scene | **Absorb** into the best-scoring such row: promote it if staged, otherwise treat the mention as that row's |
| Any exact namesake                                                                            | Create with `name_collision_flag = 1`                                                                      |
| A partial namesake scores `sim ≥ τ_low`, is in the scene, or has no score                     | Create with the flag                                                                                       |
| Otherwise                                                                                     | Create, unflagged                                                                                          |

An exact name keeps the similarity bands, the scene breaking the
ambiguous band's tie. A partial match never absorbs: a misattribution
lands the reply's involvements, awareness and relationships on the
wrong row unreviewed, and nothing splits them apart again. So it flags
only with a second signal and otherwise creates a plain row. Without a
score nothing absorbs; the namesake flags, deferring to the user.
Absorbing appends the candidate's new keywords to the row; its
description stays, per the first-introduction rule above.

**Partner and reason.** A flagged create stores in
`name_collision_partner_id` the namesake it was compared against: the
first of the namesakes that qualified to flag it (every exact one, and
a partial one under the third row's conditions), ordered by score with
the unscored last, then in-scene first, then exact before partial, then
unflagged, older and by id. `name_collision_reason` records why, read
from that partner:

| Reason      | Partner                              |
| ----------- | ------------------------------------ |
| `alike`     | Partial, `sim ≥ τ_high`              |
| `ambiguous` | `τ_low ≤ sim < τ_high`               |
| `distinct`  | Exact, `sim < τ_low`                 |
| `in-scene`  | Partial, `sim < τ_low`, in the scene |
| `no-signal` | No score                             |

The per-turn writer and a pass creating a mentioned place add two more
reasons: `same-parent`, for a location created beside a similarly
named sibling, and `unplaced`, for an unplaced one created while places
elsewhere share its name. The per-turn writer gives an item's exact
namesake `alike` or `ambiguous` by the same bands. A pass whose rename
meets a name another row of the kind holds flags the entity
`name-taken`, with the oldest such row as its partner
([What the classifier writes](#what-the-classifier-writes)). World
pairs a flagged row with its partner and states the reason in the
resolve dialog
([`world.md → Collision review and entity merge`](../ui/screens/world/world.md#collision-review-and-entity-merge)).

Thresholds (`τ_high`, `τ_low`) are tunable. Defaults TBD empirically
once real story data exists; sensible starting ranges (e.g. 0.75 /
0.50 cosine) until tuning lands.

## Mentioned places

With `stories.settings.classifierMentionedPlaces` on, off by default,
a pass also creates the places the turns mention but the scene doesn't
enter, which the per-turn writer leaves as prose
([`piggyback.md → Creating a place or an item`](./piggyback.md#creating-a-place-or-an-item)).
They keep the narrator consistent: a place the story established stays
on the `# Places` map, under its parent, with the description it was
first given, and World shows which places exist. The cost is a map that
grows with every place the story mentions, not only the ones it visits.
The pass reads the setting once, when it builds its prompt, so a reply
carrying new places creates them even if the setting was turned off
while the model ran. Turning it on doesn't revisit prose an earlier
pass read.

**What the pass sees.** Places aren't in Known entities. A `Places`
list nests every place on the branch by `parent_location_id`, children
sorted by name, whatever its status or mode, each with its placeholder
id, a status note when it isn't active, its description and keywords.
Unlike the narrator's map
([`piggyback.md → What the writer sees`](./piggyback.md#what-the-writer-sees))
it hides nothing, and a retired place keeps its id, since a happening
can still name it as where something happened. The tree renders
whether or not the setting is on: its nesting tells one back room from
another when the pass names a happening's site.

**What it emits.** With the setting on, the reply's schema carries a
`newPlaces` list and the system half carries the rule below; with it
off, neither appears. An entry has a handle starting `new:`, in one
namespace with the `newCharacters` handles, a name, a description,
keywords, a `sourceTurn` and an optional `parent`: a place's id from the
tree or another new place's handle. The handle stands wherever a
listed place's id would: in a happening's involvements and as another
new place's parent. The rule:

> Add a place the turns mention but the scene doesn't enter when the
> prose establishes it exists in the story's world with its own
> identity: a named place (a town, a keep, a region, an inn), or an
> unnamed one the story could come back to ("the old mill on the
> ridge"). Not a generic kind of place ("a tavern", "the road north"),
> not one that exists only in a hypothetical, a dream or a figure of
> speech, and not a place already in the Places list, even under
> another name: use its ID and add the name form as an alias.

**The row.** `active`, mode `auto`, the entry's keywords and its
description, clamped to a new character's bounds (the first
introduction above), landing `embedding_stale = 1` with `sourceTurn` as
its survival anchor. Not `staged`, though the story hasn't been there:
Layer A would keep a staged place out of retrieval on exactly the turns
that name it
([`edge-cases.md → Layer A`](./edge-cases.md#layer-a--retrieval-time-same-name-suppression)).

**Parent.** Parents resolve top-down, so the child of a new place hangs
under whatever row that place resolved to; otherwise the places settle
in the reply's order, each waiting only for its own parent. A place
whose parent the
turns don't give is top-level when nothing on the map could contain it,
and unplaced when something could and the turns don't say which; when
unsure, unplaced
([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
The schema makes the choice explicit: a parent, `top-level`, or none
for unplaced. A later pass places it when the prose does, or moves a
placed one ([What the classifier writes](#what-the-classifier-writes)).
A retired parent, a parent that names nothing, or one whose chain is
already broken above it leaves the place unplaced, logged, as it does
for the per-turn writer
([`piggyback.md → Creating a place or an item`](./piggyback.md#creating-a-place-or-an-item)).
The create handler refuses a place under a retired parent that slips
through, which fails the whole pass. A place created under a parent
anchored on a later turn becomes unplaced when that turn is reversed,
keeping its facts, since its own turn survives
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).

**Matching.** Each new place is matched by the per-turn writer's
sibling rule
([`piggyback.md → Matching before creating`](./piggyback.md#matching-before-creating)),
with its parent's real children as the candidates, since the pass saw
every place, and with unplaced places by exact name; a top-level place
is matched against the top-level places, and an unplaced one against
every place
([`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)).
An exact name reuses an active or staged sibling, never a retired one;
an exact retired namesake or a partial match creates the row with
`name_collision_flag = 1`, reason `same-parent`, the partner picked in
that rule's order. An unplaced place flags with the reason `unplaced`
instead: several active or staged exact namesakes anywhere, or an
exact retired one alone, create it flagged, the partner an unplaced
match first, then the older, then by id, and a partial name flags it
only against another unplaced place. A reused place keeps its
description and its status, since a mention doesn't enter a staged
place, gains the entry's new keywords, takes the parent the entry gave
when it was unplaced, and stands for the handle in the rest of the
reply. A parent that would close a loop, sits below a broken chain or
would put a disabled place around the story's place leaves it
unplaced, and each entry that maps onto it with that parent is logged
as left unplaced. Two new places with one name and parent,
or both with none, map to the first before any other match. Otherwise
the reply's places match
as successive passes' would: an unplaced one counts the reply's
earlier new places of its name as stored places, newer than any, one
match mapping it there and several flagging it `unplaced`; a placed
one the stored places would create takes over an earlier unplaced new
place of its name and places it. A partial name or a keyword hit flags
against the reply's earlier new places as against stored ones, newer
than any and in the order they settle: a placed one against those under
its parent, or at the top level, a takeover's included, and an unplaced
one against those still unplaced. The reply's placements plan, and
land, before any new place of their turn or a later one, a fact with no
source turn counting at the newest: a new place matches and is written
where they leave the places, so a place one of them puts under another
parent is no unplaced namesake to reuse, and one it puts under the new
place's parent is reused there, placed once. The twin rule above still
comes first: a new place maps to an earlier one of its name and
declared parent even after a placement moved that one's row.

**After the turn.** A pass runs after the turn that brought it due, so
a place the turn created is already a row it matches against, and the
pass reuses it.

## Factions

A pass creates the factions the turns establish and records which one
each character belongs to, with no setting, as it creates characters.
A faction keeps the narrator consistent once retrieval ranks it or an
in-scene member seats it, and World shows its members, read from the
characters' `faction_id`
([`data-model.md → FactionState shape`](../data-model.md#factionstate-shape)).
The narrator's prompts show each character's faction, as the pass's
prompt does, and each faction's members
([`architecture.md → Entity state on the template surface`](../architecture.md#entity-state-on-the-template-surface)).

**What the pass sees.** Factions are in Known entities with every
other kind, each with its standing. A character's line also shows its
faction's placeholder id;
a `faction_id` naming no faction is left out, so no raw id reaches the
prompt. Without it a pass couldn't tell a change of side from a repeat,
the reason relationship views are listed too.

**What it emits.** Two lists, always in the schema, and both rules
below in the system half. A `newFactions` entry has a handle starting
`new:`, in the namespace the `newCharacters` and `newPlaces` handles
share, a name, a description, keywords, a `sourceTurn`, and the
`standing` and `agenda` the turns show, if any, as a new character
carries its traits; chapter close revises them over the chapter
([`data-model.md → Authorship contract`](../data-model.md#authorship-contract)).
A `standings` entry names a listed faction, its new standing and a
`sourceTurn`, emitted only when the turns change it. One naming a
faction retired as the rows stood before the reply is dropped and
logged, as a membership is (a pass never returns a faction, so no reply
brings one back); a faction the reply itself retires keeps the
standings from its turns.
The handle stands wherever a listed faction's id would: in a
happening's involvements and in a membership. A `memberships` entry
has a character (an id or a new character's handle), a faction (an id,
a new faction's handle, or null for none) and a `sourceTurn`. The
rules:

> Add a faction when the prose establishes an organized group with its
> own identity in the story's world: a named one (a guild, an order, a
> noble house, a gang, a church, a government), or an unnamed one the
> story could come back to ("the smugglers who run the docks"). Not a
> loose crowd or a kind of person ("the guards", "the villagers"), not
> one that exists only in a hypothetical, a dream or a figure of
> speech, and not one already in Known entities, even under another
> name: use its ID and add the name form as an alias.

> Set a character's faction when the turns establish which organized
> group they belong to now: they join it, are revealed as a member, or
> change sides. Set it to none when they leave it or are cast out. Only
> their main allegiance: a secondary tie, a past membership ("once of
> the Iron Circle"), a disguise or a cover story doesn't change it.
> Emit a fact only when the turns establish one or change the faction
> their line shows.

**Matching.** A new faction reconciles against the branch's factions
of every status, by the namesake rule, similarity and thresholds of
[Disambiguation on new-character mentions](#disambiguation-on-new-character-mentions).
A faction is never in a scene
([`data-model.md → Entry metadata shape`](../data-model.md#entry-metadata-shape)),
so the scene signal never applies, and the decision table reads:

| Condition                                                | Outcome                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| An exact namesake scores `sim ≥ τ_high`                  | **Absorb** into the best-scoring such row: promote it if staged, otherwise treat the mention as that row's |
| Any exact namesake                                       | Create with `name_collision_flag = 1`                                                                      |
| A partial namesake scores `sim ≥ τ_low`, or has no score | Create with the flag                                                                                       |
| Otherwise                                                | Create, unflagged                                                                                          |

An exact namesake in the ambiguous band flags, with nothing to break
the tie. Partner and reason follow the character rule, so the reason is
never `in-scene`. Absorbing appends the entry's new keywords. Candidates
in one reply aren't compared with each other, so a model naming one
faction twice in a reply makes two rows. A candidate reconciled to a
row deleted before the pass plans is dropped for the pass, as a
character is.

**The row.** `active`, mode `auto`, the entry's keywords and its
description, clamped to a new character's bounds, the flag columns from
the table, landing `embedding_stale = 1` with `sourceTurn` as its
survival anchor. Its `state` holds the entry's `standing` and
`agenda`, empty when the turns gave none.

**Memberships.** A fact's character must resolve to a character and its
faction to a faction or null; one resolving to nothing or the wrong
kind is dropped and logged, so an unresolvable faction never reads as
none. A fact naming a faction retired as the rows stood before the
reply is dropped as a misreading of a past membership. A member at
retirement keeps the faction, since retiring touches no member, and a
faction the reply itself retires keeps the memberships from its turns.
A staged faction takes members and stays staged. One character's facts
are planned in source-turn order, ties in reply order. A fact matching
the stored faction writes nothing, but only until a fact for the
character is sent: from then on each is sent, since user precedence
may refuse the earlier write and the later turn is newer prose, and
the handler no-ops one whose faction is already written. A character
who joins at one turn and leaves at a later one writes twice, and
reversing the later turn leaves the earlier membership the prose still
holds. Each is planned after the reply's creates, so it can name
a character or faction the same burst creates, anchored on its
`sourceTurn`. The handler writes `state.faction_id` alone, checked
against the rows as they stand and the user's later edits
([`cadence.md → User edits and classifier writes`](./cadence.md#user-edits-and-classifier-writes)).
A reversal that removes a faction clears it from its members, which
keep their facts, as World's delete of a faction does
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).

## Threads

A pass tracks the story's threads: the goals, quests, mysteries and
threats the turns set up. The narrator's prompt carries a thread while
it is active
([`retrieval.md → Structural floor`](./retrieval.md#structural-floor--always-inject)),
chapter close consolidates them over the chapter
([`chapter-close.md`](./chapter-close.md)), and the user audits them in
[Plot](../ui/screens/plot/plot.md).

**What the pass sees.** The Threads list: every thread on the branch by
id, title and status, the user's included.

**What it emits.** A `newThreads` entry has a title, a description, a
free-form category, an icon from the catalog, a status and a
`sourceTurn`: `pending` when the story knows of the thread but no one
pursues it, `active` when someone does. A thread the turns both open
and close arrives as `resolved` or `failed`, with `resolvedAtTurn` the
turn that closed it; `sourceTurn` stays the turn that opened it. A
`threadStatuses` entry names a listed thread, its new status and a
`sourceTurn`: `active` when it is taken up, `resolved` when it is
achieved, `failed` when it is made impossible. The rule:

> Add a thread when the turns set up something the story will follow
> past the current scene: a goal a character commits to, a quest given,
> a mystery raised, a threat that looms. Not a passing intention, and
> not one already in the Threads list, even worded differently: change
> its status instead. Emit a status only when the turns establish the
> change.

**The row.** Mode `auto`, `triggered_at_entry_id` its `sourceTurn`,
landing `embedding_stale = 1` with `sourceTurn` as its survival anchor.
A change to `resolved` or `failed` sets `resolved_at_entry_id` to its
`sourceTurn`; one back to `pending` or `active` clears it, and so does
any change of status the user makes. A thread a reply both opens and
closes is written as two changes, each kept by its own turn: the
create, `active`, at its opening turn, and the status change at its
closing turn (the opening turn when `resolvedAtTurn` is missing,
names no turn of the window, or an earlier one, the last two logged).
A `newThreads` entry with a blank title creates nothing and is logged.
So reversing the
closing turn while the opening survives leaves the thread `active`,
`resolved_at_entry_id` cleared. A status the user wrote after the
change's prose stands
([`cadence.md → User edits and classifier writes`](./cadence.md#user-edits-and-classifier-writes)).

**The cost.** An active thread is injected every turn, outside the
budgets, so a thread the pass activates grows the narrator's prompt
until it resolves. The rule leans against creating, and chapter close
resolves or fails stale threads.

## Pipeline framing

The periodic classifier is a Pipeline declaration in the framework's
registry, gated like per-turn and chapter-close:

| Field                           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`                          | `'periodic-classifier'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `gateBehavior`                  | `'hard-gate'` — user-source writes wait for it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `concurrencyPolicy`             | `{ blockedBy: ['per-turn', 'periodic-classifier', 'chapter-close', 'translation-retry'] }` — a chain, Send or Run now starts it, never under another run but suggestion refresh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `affordance`                    | `'pill-and-banner'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Write set (prose, not declared) | happenings, happening_involvements, happening_awareness, threads, new character and faction entities with their first profiles and, with the setting on, mentioned places (first-introduction description, keywords, a place's parent or unplaced mark, collision flag with its partner and reason), names, the collision flag a rename that meets a taken name raises or re-points on an existing row, a place's parent and top-level mark, a faction's standing, a character's `state.faction_id`, entity status flips with retired reasons, entity keyword appends (aliases, absorbed candidates, reused places, replaced names and taken names), character relationships |

**When it runs.** Per-turn's `chainsTo` starts a pass when the turn's
commit brings the cadence due — the unprocessed entries reach
`classifierCadence` — unless the classifier is `running`. A persisted
`running` is a pass left unfinished: by a crash,
or in session by an interrupt whose reversal could not commit or a
status write that failed its retry. It holds the cadence until boot
resets it, which boot skips while the branch still holds the pass's
own unreversed orphans
([`generation-pipeline.md → chainsTo on predecessor`](../generation-pipeline.md#chainsto-on-predecessor)).
The pass runs while the user reads the reply. A pass's own `chainsTo`
returns another pass while a chapter close is pending and entries
remain unprocessed, then the close
([`chapter-close.md → Phase 0`](./chapter-close.md#phase-0--catch-up-passes)).
`[Run classifier now]` starts one directly, and Send runs one first when
a pass is owed ([Failure policy](#failure-policy)).

**Interrupted, then deferred.** A head reversal — regenerate, swipe, an
edit of the head turn, CTRL-Z of the turn, rollback — and the pill's
Cancel interrupt a pass: it is cancelled and waited out, and the
reversal goes ahead
([`generation-pipeline.md → Prose reversals and the interrupt`](../generation-pipeline.md#prose-reversals-and-the-interrupt)).
Leaving the story interrupts it too, through the story-leave confirm
([`principles.md → Edit restrictions during in-flight generation`](../ui/principles.md#edit-restrictions-during-in-flight-generation)).
A toast says the memory
update moved to the next turn, and the pass is marked deferred for its
branch. At the next Send it runs before the turn, as its own run,
committing before the turn's first write; Cancel then cancels the
whole Send and keeps the user's text in the composer. The mark lives
in memory: after a restart, the next Send finds the pass due and runs
it first anyway ([Failure policy](#failure-policy)). A pass cancelled before its writes commits nothing; one
cancelled during them reverses its own group, as any aborted run does.
An interrupted pass leaves the watermark; it restores
its pre-run status through the pipeline's `onInterrupt` hook, which runs
after that reversal has committed. A reversal that cannot commit skips
the hook and leaves the branch `running` for boot recovery
([`generation-pipeline.md → Recovery-failure policy`](../generation-pipeline.md#recovery-failure-policy)).

**Undo.** A pass holds its own `actionId`, stamped
`source = periodic_classifier` (distinct from per-turn piggyback's
`piggyback_tagged_block`), and is **never an undo target** — CTRL-Z's
head-selection skips it (see
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).
A deferred pass keeps its own group too: sharing the turn's would let a
regenerate of that turn sweep facts about turns already settled.

**Alongside.** Suggestion refresh runs beside a pass: it writes only
the head entry's chips, which a pass neither reads nor writes.
Translation retry and chapter close wait for it.

**Pill.** A pass shows on the generation indicator pill with the
banner, as chapter close does, reading `Updating memory…`, and
`Updating memory before your turn…` when it runs as Send's owed pass.
No ETA, since run length isn't predictable; the classifier's timeout
bounds the whole structured call, retries included
([Failure policy](#failure-policy)). The pill's popover carries
Cancel.

## Settings · Memory · Classifier panel

The Story Settings · Memory tab surfaces classifier controls and
state for the active branch in a compact panel.

### Cadence config

In-place edit of `stories.settings.classifierCadence`,
`piggybackMode` and `classifierMentionedPlaces`
([Mentioned places](#mentioned-places)). The buffer-aware indicator from
[`cadence.md → User-tunable knobs`](./cadence.md#user-tunable-knobs)
renders inline so the user sees the cadence-vs-recent-buffer
overlap.

### Status block

Reflects the classifier's current state:

- **Idle** — `Last run N turns ago, processed P happenings + Q awareness rows.`
- **Running** — `Running... processed N of M turns.` Mirrors the pill.
- **Failed** — `⚠ Last run failed: [reason]. It runs again before your next turn.` Inline `[View error details]`. The reader shows the failure itself: a toast, and a system entry when the pass fails a Send ([Failure policy](#failure-policy)).

### Manual override

`[Run classifier now]` triggers an immediate pass over unprocessed
turns, gated like any pass. Disabled while a run is actively in
flight; enabled in **idle** and **failed** (lets the user retry
without taking a turn).

### Failure policy

A pass that comes due must succeed before its branch's next turn: a
turn generated over unclassified prose is memory the story has lost.

A pass's only retries are the structured call's own provider and parse
attempts
([`generation-pipeline.md → Error, cancel, and retry`](../generation-pipeline.md#error-cancel-and-retry)).
A reply that still doesn't parse fails the pass, so the reply's
optional profile and plot fields never fail the parse: sent as `null`
or the wrong type, they read as absent. They are a new
character's visual categories, traits, drives and voice, a new
faction's standing and agenda, a happening's or a new thread's category
and icon, a new thread's `resolvedAtTurn` and a new place's condition.
In the renames, placements, standings, new threads, thread statuses and
known awareness, a `null` list reads as empty, a `null` field as absent,
and an enum value is read trimmed and lowercased first, so a `null`
source turn leaves the fact unattributed and `"Resolved"` lands as
`resolved`. An entry there that still doesn't fit, a required field
missing or an enum value outside the list (a status change to
`pending`), is dropped alone and logged with its list, and the rest of
the reply lands. In the older lists, a
required field or an enum the model gets wrong still fails the reply.
A chained pass that still fails leaves the watermark where it was,
records the failure in the status, and shows a warning toast,
`Memory update failed. It runs again before your next turn.` Nothing
retries on a timer: a pass holds the gate, and a timer would raise it at
a random moment, in the middle of a World edit.

At the next Send, a pass that is owed runs before the turn, as deferred
work does ([Pipeline framing](#pipeline-framing)): its own run,
committing before the turn's first write. A pass is owed when one is
deferred for the branch or the cadence is due. The cadence is read from
the persisted watermark, so a failure, an interrupt, a crash and a
restart all end the same way. One pass is owed per Send: a settings
change (a lowered cadence or window max) can leave a backlog that drains
over the next Sends, so a turn may run while a pass is still due. If the
owed pass fails, the Send fails:
no user_action is written, the text goes back to an empty composer
(else onto the entry), and the reader shows the failure as a system entry with its cause
([`reader-composer.md → Transient pipeline failures`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)).
Its `Retry` runs the pass alone, holding the reader's actions, head
reversals included, until the pass ends; the pill's `Cancel` ends it.
Send runs it first again. There is no
attempt counter and no suspension: every Send is a fresh attempt,
whatever the cause. A cause that isn't transient (an invalid key, a
model removed from the catalog) stops the branch's turns until the user
fixes it at the source. A failure while the pass applies its planned
writes (a rejected write rolls the whole pass back) is a failed run too.

The structured call is bounded by the classifier profile's `timeout`
when the user set one, longer or shorter, and by ten minutes otherwise,
so a hung provider ends in an error the user can act on.

A branch held `running`, a pass left unfinished whose reversal hasn't
committed, can't run a pass, so its Send fails with the recovery error,
keeping the text on the entry, until a boot reverses the orphan
([`generation-pipeline.md → Recovery-failure policy`](../generation-pipeline.md#recovery-failure-policy)).

### Persistence

Per-branch classifier status — current state, last-success-at,
last-error, and **`processedThrough`** — persists in
a `branches.classifier_status` JSON field. `branches` is not delta-logged,
so the status is operational state outside the reversal log.

`processedThrough` is the highest entry position (`story_entries.position`)
the classifier has fully processed; the pass range is
`(processedThrough, head]`. It is the concrete field behind "unprocessed
entries," read by the cadence trigger, Send's check for an owed pass,
`[Run classifier now]`, and chapter-close phase 0. A pass's range excludes
trailing `system` rows: an untruncated window covers through its last
non-system entry, so the watermark never lands on a trailing system row
whose position the next Send's user_action reuses (a truncated window
still claims its cut). A successful pass over `(processedThrough, E]` sets
`processedThrough = E` in its commit transaction, in the same write as its
success status. A prose reversal clamps
it — `processedThrough ← min(processedThrough, position(B) − 1)` for `B`
the earliest removed entry (see
[`data-model.md → Entry mutability & rollback → Survival anchor`](../data-model.md#survival-anchor))
— so changed turns are re-processed without re-deriving spared facts. A
content edit removes no entry and clamps only inside the head turn, where
`B` is the edited entry and the reversal covers everything the clamp
re-reads; below it the edit leaves the watermark alone rather than force a
re-read of an unbounded suffix whose facts survive
([`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).
At
fork from entry `N`, the new branch sets
`processedThrough = min(parent.processedThrough, position(N))` and resets
the rest of the status to idle.

The panel sits in the same Memory tab as the embedder controls
(see
[`model-management.md → Embedder config`](./model-management.md#embedder-config--where-it-lives-in-settings))
and the cluster-1 staleness panel. Wire-level layout lands at the
per-screen Story Settings design pass.
