# `entities.state` discriminated-union shape

Settles the kind-specific `state` shape for the four entity kinds —
character, location, item, faction. Resolves the **`entities.state`
kind-specific shape** followup (removed from `followups.md` in this
same change), unblocks the Per-kind Overview composition followup
(partial), and lightly bundles the dependent UI surface updates
(World wireframe + form-pattern reference).

## Background

`entities.state` has been a stub since the schema was sketched.
[`data-model.md`](../data-model.md) carries the entities row with
`state json "typed per kind"` and two pre-locked decisions —
`LocationState.parent_location_id` (compositional location
hierarchy) and `CharacterState.lastSeenAt` (cached classifier-
maintained snapshot). The shape of every other field has been
deferred: the world wireframe mocks `disposition` (enum),
`condition` (enum), `equipped_items`, and `faction_id` as
placeholder examples, but those mocks were not load-bearing —
they're explicitly to be re-derived from first principles.

This design re-derives the shape with two questions in front:

1. What does the AI need to know about each kind to portray it
   well in narrative?
2. What is genuinely typed (queryable, classifier-maintainable,
   needed for prompt rendering) vs what lives in `description`
   prose?

Out of scope: how the classifier writes state (architecture
territory — write-cadence stratification, prompt design, agent
boundaries), per-kind UI Overview composition for non-character
kinds (its own followup), wizard flow for state authoring at story
creation (wizard pass).

## Scope

In:

- The four discriminated-union types: `CharacterState`,
  `LocationState`, `ItemState`, `FactionState`.
- The cross-cutting `description` vs `state` boundary rule.
- Description authorship contract (who writes, when, mutability).
- Stackable / fungible items modeling.
- Light UI integration: World wireframe sweep replacing mock
  fields, form-pattern reference update.

Adjacent (cited, not designed):

- Classifier write-cadence stratification (per-turn /
  every-N-turns / chapter-close) — `architecture.md` territory.
- Lore-management agent shape (existing followup) — gains
  explicit responsibilities here but is designed elsewhere.
- Per-kind UI Overview composition for Location/Item/Faction —
  its own followup; this design unblocks it but does not draw it.
- Wizard authoring of state fields — wizard pass owns.
- Per-field provenance metadata (`{ value, last_observed_entry,
source }`) — v1.5 escalation, deferred to a new followup.

## Decisions

### 1. Description vs state boundary

**Decided:** `entities.description` (top-level text column) is the
**user-authoritative "who" prose**. State is the **typed,
classifier-mutable layer** carrying everything that needs structure
for query, classifier evolution, or prompt rendering.

The split rule:

- **Description** holds the prose-y identity sketch. Whoever
  spawns the entity authors the initial description (user via
  wizard / `+ New entity` → user-authored; classifier via
  mid-story discovery → classifier-authored _once_). Subsequent
  writes are **user-only** in v1.
- **State** holds typed slots for: things that evolve mid-stream
  (classifier needs structural slots to record changes), things
  needed structurally (entity refs, hierarchy walks, caches),
  and things the UI needs as discrete fields rather than parsed
  from prose.

Rationale: the classifier writes prose well at _introduction_
moments but writing description-rewrites mid-stream risks
coherence drift across long stories. Keeping description as a
stable user-authoritative surface protects the entity's "who"
from per-turn churn; typed state slots absorb the per-turn /
per-chapter evolution.

**v1 collapse:** the lore-management agent suggestion-queue UI
(autonomous-vs-confirm-mode toggle) is deferred. Until that
ships, classifier never updates description after first
introduction; user is the only ongoing editor. Stale descriptions
are the user's problem until they edit — acceptable v1 floor.
The suggestion-queue UI design folds into the
[Lore-management agent shape](../followups.md#lore-management-agent-shape)
followup.

### 2. CharacterState — 10 top-level fields (15 leaf slots)

```ts
type CharacterState = {
  // Identity — visual descriptors (type-relaxed strings, no enum lock-in)
  visual: {
    physique?: string // height + build merged ("tall, lean", "wiry, broad-shouldered")
    face?: string // facial features, complexion, expression-tendency
    hair?: string // color + style + state ("silver-streaked since the war")
    eyes?: string // color + distinctive eye traits
    attire?: string // live current attire, classifier-updates on observed change
    distinguishing?: string[] // catch-all: scars, tattoos, voice tone, gait, posture, scent
  }

  // Identity — personality + motivation
  traits: string[] // who they are: personality / skills / background
  // soft cap 8 (in classifier prompt, not Zod)
  drives: string[] // what pushes/pulls them: goals, fears, sore spots
  // soft cap 6
  voice?: string // single prose note on speech pattern

  // Relationships — entity refs
  current_location_id: EntityId | null
  equipped_items: EntityId[] // unique items only (worn/wielded)
  inventory: EntityId[] // unique items only (carried, not active)
  stackables?: Record<string, number> // currencies + ammo + supplies
  // string-keyed quantities, lowercase canonical
  faction_id: EntityId | null // primary affiliation, single

  // Cache (classifier-maintained denormalization)
  lastSeenAt: {
    entryId: string
    locationId: string | null
    worldTime: number
  } | null
}
```

**Rationale highlights:**

- **Visual descriptors are type-relaxed strings, not enums.**
  Enum vocabularies don't survive contact with genre flexibility
  ("disposition" in romance vs war saga vs eldritch horror).
  Free strings let classifier write whatever fits the prose;
  field names stay stable for UI and translation. Six slots
  (down from past app's six; brought back to six after
  `face` was added).
- **`attire` is live current attire, not signature.** Classifier
  updates on observed prose change ("Kael changed into noble
  robes"). Risk of staleness is acknowledged; mitigation is
  prompting discipline + chapter-close compaction.
- **`traits` and `drives` are flat string arrays.** Symmetric
  shape; UI renders as chip groups; classifier emits one element
  at a time. `behaviors` was considered as a third bucket and
  rejected: "negotiates before fighting" is functionally a trait
  ("diplomatic") or a drive ("avoids violence"); separate bag
  silently bloated with mis-classified entries.
- **`voice` is single-string, optional.** Distinct from
  `distinguishing[]` because dialogue-coherence demands voice be
  surfaced explicitly; folding into distinguishing buries it.
- **`equipped_items` vs `inventory` asymmetry.** Both are
  `EntityId[]` of unique items; the split is semantic — equipped
  is what's actively in use, inventory is what's carried but
  stowed. Stackables don't go through either; they live in the
  separate `stackables` slot.
- **`stackables: Record<string, number>` is the answer to
  fungibles.** Gold pieces, arrows, rations are not entities;
  they're holder-side string-keyed quantities. No item-entity
  registry to inject into classifier prompts; no entity-dedup
  problem; no "200 gold-piece entities" silliness. Cross-character
  key consistency is a small surface (typically 1-5 keys per
  story) and lore-mgmt compaction handles drift.
- **`faction_id` is single, not array.** Multi-faction is a
  speculative complexity escalation; most characters have one
  primary affiliation. Add multi-faction in v1.5 if real demand.

### 3. LocationState — 2 typed fields

```ts
type LocationState = {
  parent_location_id: EntityId | null // compositional hierarchy (locked in prior decision)
  condition?: string // ongoing dynamic state delta from description baseline
  // ("war-damaged", "abandoned since the plague",
  //  "partially rebuilt")
}
```

**Rationale.** Locations are dramatically less dynamic than
characters. Type, appearance, atmosphere, landmark features —
all naturally live in `description` prose, established at spawn
time and edited by the user when needed. The few things that
genuinely can't fold into description:

- **`parent_location_id`** — needs typed slot for compositional
  hierarchy walks during prompt rendering (`Aria is in [Shop in
Town Square in City]`). Description prose isn't walkable.
  Locked in prior decision.
- **`condition`** — ongoing dynamic state that evolves
  separately from description. Description is user-only after
  establishment; classifier needs somewhere to record "the
  village was burned in chapter 5" without rewriting the
  user's authored description.

Discrete change events (the bell tower fell; the gate was
breached) are recorded as `happenings` rows with the location
as a participant via `happening_involvements` — not as state
mutations. State carries the _running consequence_ (`condition:
"earthquake-damaged"`), not the event log.

**Considered and rejected:**

- `type?: string` (canonical category like "tavern", "ruin",
  "starship-bridge") — folds into description prose; the entity
  `name` plus prose disambiguates well enough.
- `appearance?: string` — same. User-authored description prose
  is the natural home; rare significant changes are user-edits
  or new condition.
- `controlling_faction_id` / `proprietor_id` — speculative;
  same family as the deferred relationships graph.
- `distinguishing?: string[]` — landmark features chip-list.
  Considered but rejected; rare evolution of features is
  better captured as happenings (the tower fell — happening)
  - description edits (user updates description after major
    change). Adds drift risk between description prose and
    distinguishing chips otherwise.

### 4. ItemState — 2 typed fields

```ts
type ItemState = {
  at_location_id: EntityId | null // location of item if loose;
  // null when held by a character
  // (look up via character.equipped_items / inventory)
  condition?: string // dynamic state ("intact", "broken",
  //                "cursed", "activated")
}
```

**Position convention.** `at_location_id = null` means
"held by a character — find via character arrays." Single source
of truth in the held direction (character arrays are canonical
for held items); no back-pointer on item to drift against. Cost:
"who holds the silver coin?" requires scanning characters'
equipped + inventory arrays. Acceptable for v1 scale; FTS5
upgrade applies if it bites.

**Rationale.** Items are mostly inanimate. What an item _is_
(type, material, properties, magical traits, history, value)
fits cleanly in description prose. The two things that genuinely
need typed slots:

- **`at_location_id`** — positional reference for unheld items.
  Needed for prompt rendering ("on the table in the Iron
  Tavern") and for query.
- **`condition`** — dynamic state delta from description
  baseline. Symmetric with LocationState.

**Considered and rejected:**

- `held_by_id: EntityId | null` (back-ref on item) — duplicates
  character arrays, classifier-drift risk, no real query benefit
  at v1 scale.
- `is_stackable: boolean` — earlier draft had this for
  fungibility tagging; pivoted away when we moved fungibles out
  of item entities entirely (see decision 6).
- `magical_charges: number` — quantified RPG-state. Out of scope
  per the "no quantified state in v1" framing.
- `parent_item_id: EntityId | null` (item-in-item — dagger in
  boot in locker) — rare; defer to "if testing surfaces real
  demand."

### 5. FactionState — 2 typed fields

```ts
type FactionState = {
  standing?: string // dynamic power/situation
  // ("ascendant after the coup",
  //  "embattled, holding territory only in the south")
  agenda?: string[] // current goals/objectives
  // soft cap 4
}
```

**Rationale.** Identity (ideology, history, structure, founding
circumstances, signature reputation) lives in description prose.
What evolves:

- **`standing`** — power/situation status. Dynamic state slot,
  parallel to LocationState.condition.
- **`agenda`** — current goals; parallel to character `drives`,
  tighter cap (faction-level goals are coarser-grained than
  individual motivations).

**Considered and rejected:**

- `headquarters_location_id` — usually static, fits in
  description.
- `rival_factions[]` / `allied_factions[]` — same deferred
  relationships-graph followup.
- `member_count` / `roster` — derivable from inverse query on
  `character.faction_id`.
- `traits[]` / `reputation[]` — folds into description; faction
  reputation is downstream of cumulative happenings rather than
  needing its own typed slot.

### 6. Stackable items — holder-side `Record<string, number>`, not entities

**Decided:** fungible items (currencies, ammunition, generic
supplies) are NOT modeled as entities. They're string-keyed
quantities held on the character.

```ts
CharacterState.stackables?: Record<string, number>
// { "gold": 200, "silver": 30, "arrows": 15, "rations": 7 }
```

**Why not item entities + count.** An earlier draft proposed
`ItemState.is_stackable: boolean` + `inventory: Array<{
item_id, count }>`. The classifier-prompt cost was prohibitive:
to dedup stackables on creation, the classifier would need to
inspect "all stackable items in the branch" (or accept duplicate
entities for chapter-close compaction to merge). Either route
adds real prompt-token cost or adds intermediate-state noise.
The shape is also over-modeled — gold pieces don't need
descriptions, conditions, or any entity machinery; they're just
quantities.

**Convention:**

- Lowercase canonical keys: `"gold"` not `"Gold"` or `"Gold
pieces"`.
- Cross-character consistency is classifier-prompt discipline +
  lore-mgmt compaction (key normalization at chapter close).
- Transfer ("Aria gives Kael 50 gold") writes one delta with
  matching `action_id`: decrement on Aria's `stackables.gold`,
  increment-or-create on Kael's.
- Depletion: decrement; if count → 0, remove the key from the
  Record.

**v1 limitations:**

- **Stackables can't carry entity-level rich data.** "Magical
  arrows blessed by Vael" need a description but stackables-as-
  strings have nowhere for one. Two routes for the rare named-
  fungibles case: model as a unique item entity covering the
  whole batch (one entity per blessed-arrow set, classifier
  manages) or narrate in prose. Real demand → followup-driven
  v1.5 design.
- **Locations don't get stackables.** `LocationState.stackables`
  is deferred. "The chest contains 200 gold" stays in prose;
  when a character takes the gold, classifier creates the stack
  reference at that moment.

### 7. Containers — descriptive-only in v1

**Decided:** items don't structurally contain other items in
v1. Container items (satchel, quiver, purse, chest) exist as
ordinary item entities; their _contents_ live on whoever holds
the container (character.inventory + character.stackables).
The "in the satchel" relationship is narrative texture, not
structural.

**Why not structural one-level containers** (Approach B —
`is_container` + `contained_stackables` + `contained_items` on
ItemState):

- Cycle prevention is app-layer work (item A can't contain
  item B that contains item A).
- Transfer cascade — handing Kael's satchel to Aria has to
  cascade contents. Classifier complexity grows.
- UI tree rendering: holder-of-holders. Power-user surface.
- Narrative reality: most stories don't structurally need
  containers. The "Kael reaches into his satchel" beat is
  prose flavor; the gold lives on Kael either way.
- Additive future: `is_container` + `contained_*` can land in
  v1.5 without breaking v1 data. Containers existing as
  ordinary items in v1 just gain those fields when filled in.

**v1 UX consequence (acknowledged):** users expecting D&D-grade
"drag gold into purse" will find that gold lives on the
character, not in the purse. UI must teach this clearly:
labels say "Carried items" / "Carried quantities" at the
character level, not "Satchel contents." Container items get a
flagged display in the form ("Container — its contents are
tracked on the holder") with a tooltip. Onboarding mentions
the rule.

**When v1.5 escalates to structural containers:**

- Real signal that prose-driven satchel-handoff is unreliable
  (classifier consistently loses contents on character-to-
  character transfer).
- Strong RPG-style demand for inventory-management UX.
- Story testing surfaces "the AI keeps forgetting the gold was
  in the chest, not on the floor."

### 8. Soft caps + compaction — bloat mitigation

**Decided:** schema does NOT enforce field count caps via Zod
`.max()` (that creates production write-rejection drama on
classifier overflow). Bloat is mitigated structurally via:

- **Soft caps in classifier prompt.** `traits` ≤ 8, `drives` ≤
  6, `agenda` ≤ 4. Classifier prompt explicitly directs
  "replace, don't append" when at cap.
- **No per-turn classifier write to traits/drives/agenda.**
  These slow-evolving identity fields update only at
  chapter-close lore-mgmt agent. Per-turn pipeline handles scene
  metadata, lastSeenAt, current_location_id, attire changes,
  equipped_items / inventory / stackables transfers. Personality
  / behavioral / motivational fields lag scene-by-scene
  observations by up to one chapter — the right cadence for
  these specifically.
- **Chapter-close compaction (lore-mgmt agent).** Dedupes
  synonyms ("brave" + "courageous" → one), prunes outdated
  ("former alcoholic" 10 chapters past sobriety → drop),
  consolidates overly-specific entries. This is the long-term
  bloat fix; soft caps are the per-turn discipline.

**Zod degradation bounds** (separate from soft caps — these are
"don't crash on pathological values" caps, much higher than the
prompt-discipline caps):

- `voice.max(2000)` characters
- `traits.max(50)`, `drives.max(50)`, `agenda.max(50)` array
  length
- `distinguishing.max(20)` array length
- Visual sub-fields `.max(500)` characters each
- `condition.max(500)` characters
- `standing.max(500)` characters
- `stackables` keys: non-empty, `.max(40)` characters; values
  non-negative integers

### 9. Translation targets

State fields' translation targets (referenced via dotted paths
through the existing `translations` table):

**Translatable** (text content the user faces in different
languages):

- All `visual.*` sub-fields (string and per-element of
  `distinguishing[]`).
- `traits[]`, `drives[]`, `voice` per element / single string.
- `condition` (Location, Item).
- `standing` (Faction).
- `agenda[]` per element.

**Not translatable** (structural / numeric):

- All `EntityId` references (`current_location_id`,
  `equipped_items`, `inventory`, `parent_location_id`,
  `at_location_id`, `faction_id`).
- `lastSeenAt` (numeric snapshot).
- `stackables` keys — translatable in principle, but key
  normalization across characters is structurally complex; v1
  treats keys as canonical lowercase English, untranslated. The
  _concept_ (gold) is still rendered translated in prose; the
  key is a structural identifier.
- `stackables` values (numeric counts).

### 10. Authorship contract — who writes what

| Field group                                 | First write                                                 | Subsequent writes                                                 |
| ------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `description` (top-level)                   | Whoever spawns the entity (user or classifier-on-discovery) | User-only in v1                                                   |
| `visual.*`                                  | Classifier from prose, or user via form                     | Both — classifier evolves on observed prose change; user can edit |
| `traits`, `drives`                          | Classifier from prose                                       | Classifier (chapter-close lore-mgmt only) + user via form         |
| `voice`                                     | Classifier from prose, or user via form                     | Both                                                              |
| `current_location_id`                       | Classifier per-turn                                         | Classifier per-turn primary; user can edit (rare)                 |
| `equipped_items`, `inventory`, `stackables` | Classifier per-turn                                         | Classifier per-turn primary; user can edit                        |
| `faction_id`                                | Classifier or user                                          | Both                                                              |
| `lastSeenAt`                                | Classifier-only                                             | Classifier-only                                                   |
| `parent_location_id`                        | User at creation, or classifier on discovery                | Both — rare changes                                               |
| `condition` (Location/Item)                 | Classifier or user                                          | Both                                                              |
| `standing`, `agenda` (Faction)              | Classifier or user                                          | Classifier (chapter-close) + user                                 |
| `at_location_id` (Item)                     | Classifier per-turn                                         | Classifier per-turn primary; user can edit                        |

**Manual user edit vs classifier overwrite policy** is parked.
v1 lean: classifier writes from prose-evidenced changes; user
edits "stick" only until classifier reads contradicting prose.
Per-field provenance metadata (deferred to v1.5) is the proper
fix; v1 accepts this floor. Tracked in followups.

## Adversarial pass — assumptions named

Three load-bearing assumptions, all about future classifier /
agent prompting quality, all addressable post-testing:

1. **The classifier can reliably maintain 14 typed character
   fields with prompting discipline.** No empirical evidence
   yet. Mitigation paths exist (per-field provenance metadata
   v1.5; lore-mgmt compaction); v1 ships on assumption.
2. **Description user-only-after-establishment is workable in
   v1 without the lore-mgmt suggestion-queue UI.** Long stories
   accumulate description drift. v1 collapse: user manually
   edits or it goes stale. Deferred suggestion queue is the
   proper fix.
3. **Soft caps in classifier prompt enforce traits/drives
   bounds.** Past app showed soft caps fail without explicit
   replace-on-overflow discipline. Lore-mgmt compaction at
   chapter close is the structural backstop.

Edge cases that need spec clarity (all addressed above):

- Manual user edit vs classifier overwrite — parked as
  architecture concern.
- Zod degradation bounds — specified in decision 8.
- Translation targets — enumerated in decision 9.
- Delta payload format for stackables — references existing
  delta semantics; new-key creation case is `{ stackables: {
gold: undefined } }` in undo_payload (omit-key on revert).

## Followups generated / updated

**Resolved by this design:**

- `entities.state` kind-specific shape — fully resolves; entry
  removed from `followups.md`.

**New (added to `followups.md`):**

- **Per-field provenance metadata** — `{ value,
last_observed_entry, source }` per typed slot. Mitigation for
  stale values + user-vs-classifier authorship policy. v1.5
  escalation.
- **Structural one-level containers** — `is_container` +
  `contained_*` on ItemState. Cycle prevention, transfer
  cascade, UI tree depth. Defer until real signal.
- **Location-side stackables** —
  `LocationState.stackables: Record<string, number>` for
  loose-fungibles-at-locations. Currently narrated in prose.
- **Named fungibles** — magical-arrows-with-description case
  where stackable-with-description is needed. Possibly via
  `entity_stacks` table, possibly via unique-item-as-batch.
- **State-field write contract architecture** — per-field "who
  writes / when" rule, including manual-edit vs classifier-
  overwrite policy. `architecture.md` territory.
- **Search scope on state fields** — should `traits`, `drives`,
  `voice` be searchable in World panel category-search? Lean:
  yes for traits + drives, no for voice.

**Updates to existing followups:**

- **Per-kind Overview composition in World panel** — schema
  lands here; Overview drawing for Location/Item/Faction still
  pending but no longer schema-blocked.
- **Lore-management agent shape** — gains explicit
  responsibilities: (a) compaction of `traits` and `drives` per
  character; (b) stackable-key normalization; (c) chapter-close
  compaction is the only write-cadence for traits / drives /
  agenda fields; (d) suggestion-queue UI for description
  revisions when that lands.
- **Next-turn suggestions design pass** — touches the
  consolidation question (fold classifier into narrative call),
  which is also relevant to state-write cadence stratification.
  Cross-reference between the two.
