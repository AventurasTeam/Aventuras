# World panel

**Wireframe:** [`world.html`](./world.html) — interactive

Dedicated full-screen surface for entities + lore management.
Master-detail pattern: filterable list on the left, single-row detail
on the right with tabs. The deep-edit workshop level of the
three-level entity surfacing (rail → peek → panel).

Cross-cutting principles that govern this panel are in
[principles.md](../../principles.md). Relevant sections:

- [World / Plot split](../../principles.md#world--plot-split--unified-panels-by-purpose)
- [Entity row indicators — four channels](../../patterns/entity.md#entity-row-indicators--four-orthogonal-channels)
- [Entity kind indicators — icons](../../patterns/entity.md#entity-kind-indicators--icons-not-text)
- [Entity list sort order — four-layer, lead pinned](../../patterns/entity.md#entity-list-sort-order--static-four-layer)
- [Browse filter chips + accordion grouping](../../patterns/entity.md#browse-filter-chips)
- [Entity surfacing — three levels](../../patterns/entity.md#entity-surfacing--three-levels-same-data)
- [Entity detail-pane composition](../../patterns/entity.md#entity-detail-pane-composition)
- [Save-session pattern](../../patterns/save-sessions.md)
- [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  (entity / lore detail-pane edits and save bars disable while a
  generation pipeline is in flight)
- [Bulk operations — deferred](../../principles.md#bulk-operations--deferred)
- [Injection / retrieval rules](../../principles.md#injection--retrieval-rules-for-prompt-context)
  (`injection_mode` field surfacing)
- [Scene presence is runtime-derived, not status](../../principles.md#scene-presence-is-runtime-derived-not-status)
- [Recently-classified row accent](../../patterns/entity.md#recently-classified-row-accent)
  (entities and lore on this panel; classifier writes both)
- [Empty list / table state](../../patterns/lists.md#empty-list--table-state)
- [Actions menu (contextual zone)](../../patterns/actions-menu.md#contextual-zone)
  (World contributes per-entity / per-lore commands to the universal
  `⚲` directory)
  (centered placeholder when the active scope has zero rows;
  applies to the list pane AND the detail-pane Involvements +
  History tabs)
- [`memory/edge-cases.md → Name collision`](../../../memory/edge-cases.md#name-collision-and-disambiguation)
  (classifier flag origin — resolved here via
  [Collision review and entity merge](#collision-review-and-entity-merge))

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [logo] <title> / World          [status]   [actions][⛭][←]  │ ← top bar (app chrome)
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ ← chapter token-progress strip
├─────────────────────────────────────────────────────────────┤
│ Characters / Kael                                            │ ← sub-header (in-pane selection)
├─────────────────────┬───────────────────────────────────────┤
│ LIST PANE (~340px)  │ DETAIL PANE                           │
│                     │                                       │
│ [Characters ▾]  [+] │ Name: Kael ✎                    [⋯]  │ ← [+] tooltip tracks active kind
│ search              │ ─────                                 │
│ filter chips        │ tabs: Overview | Identity | Carrying  │
│                     │       | Connections | Settings |      │
│ list (accordion     │       Assets | Involvements | History │
│ on All filter)      │                                       │
│                     │ (selected tab content, scrolls)       │
│                     │                                       │
│                     │ ───                                   │
│                     │ save bar (when dirty)                 │
│                     │   N unsaved · [discard] [save ⌘S]     │
└─────────────────────┴───────────────────────────────────────┘
```

## Top-bar

Standard in-story chrome per
[principles → Top-bar design rule](../../principles.md#top-bar-design-rule).
Breadcrumb: `<story-title> / World`. The
[master-detail sub-header](../../principles.md#master-detail-sub-header)
below the top bar carries the in-pane selection
`[Characters|Locations|Items|Factions|Lore] / <selected name>`,
updating as the user clicks list rows.

## Detail head structure

Status is NOT chrome on the detail head: it is edited on the
[Settings](#settings--entity-management-chrome) tab and mirrored as
a pill on the Overview. The detail head carries only:

- The entity name (inline-editable with pencil)
- A `Recently classified` badge — per
  [patterns → Recently-classified row accent](../../patterns/entity.md#recently-classified-row-accent).
- An overflow menu (⋯) anchored to the name row

The overflow menu holds rare-but-important actions:

- **Set as lead** (sets `stories.definition.leadEntityId`;
  characters only, and enabled only for an active character that is
  not already the lead — a staged or retired character can't lead,
  per
  [wizard.md → Status field](../wizard/wizard.md#status-field--active--staged))
- **Export entity as JSON** (the row as an `aventuras-entity` `.avts`
  file: a download on desktop and web, the OS share sheet on native;
  the file carries no branch-local ids; a read of the committed row,
  like `View raw JSON`, so it stays live during generation, per
  [`principles.md → What's not gated`](../../principles.md#whats-not-gated);
  with unsaved edits in the pane, the file holds the saved row and a
  toast says so)
- **View raw JSON** (debug/dev affordance)
- **Delete entity** (destructive; confirms — see [Delete](#delete);
  disabled for the lead)

Raw JSON lives here (not as a prominent link) because it's
power-user/debug territory. One consistent pattern: ⋯ menus are where
"extra / rare" item-scoped actions live on any per-item surface.

## Tabs — per-kind composition

All four entity kinds share the same tab skeleton, rendered via the
[Tabs primitive](../../patterns/tabs.md) on tiers where the strip
fits and substituted to the Select primitive on narrower tiers.
Tabs distribute fields by **semantic purpose**, not by JS shape —
implemented as
[hand-written per-kind detail-pane components](../../patterns/entity.md#entity-detail-pane-composition):
`CharacterDetailPane`, `LocationDetailPane`, `ItemDetailPane`,
`FactionDetailPane`. Schema is the validation contract; UI owns
layout.

```
Overview | Identity | Carrying | Connections | Settings | Assets | Involvements | History
```

`Carrying` is **character-only** — hidden on location, item,
faction (no carry semantics). `Settings` applies to every kind
(every entity has status / injection_mode / retired_reason / keywords /
priority / tags).
Other tabs render for every kind with kind-specific content.

### Overview — glance summary, read-mostly

The Overview tab is a glance summary card, not the full form.
Click any region to route to the relevant edit tab. Entity names
inside a region are text, not links: each region is one target,
and moving to a related entity happens in
[Connections](#connections--positional--compositional--affiliation--relationships).
Doubles as
the [peek-drawer body](../reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)
at narrower (440px) width — same content, no duplicated design.

**Non-default injection-mode chip — applies to every kind.** A small
uppercase chip (`ALWAYS INJECTED` / `DISABLED`) sits inline next to
the status pill when `injection_mode` is non-default. Hidden for
the `auto` default to avoid noise on the common case;
surfaced for `always` and `disabled` because both diverge from
default in opposite directions and are operationally consequential.
Hover tooltip pulls from the same explanation as the Settings tab
select; click routes to Settings. Mirrors the conditional-surface
treatment used by `retired_reason` (visible only when
`status === 'retired'`).

**Character Overview** (top-down):

- Status pill (`active` / `staged` / `retired` + `retired_reason`
  inline when retired).
- Description prose — full text (typically 1-3 sentences). Click →
  Identity tab.
- Visual line — first 1-2 populated `visual.*` fields joined with
  `·`. Click → Identity / Visual.
- `TRAITS` and `DRIVES` chip rows — first ~3 of each with `+ N` overflow
  indicator. Click → Identity / Personality.
- `IN <location>` (current_location_id) `· last seen N days ago`
  (from `lastSeenAt`). Click → Connections. The span is in-world
  time since `lastSeenAt.worldTime`, counted in the largest
  fixed-length unit of the calendar that the span fills at least once
  (at most days on Gregorian, never months, so a same-day span reads in
  hours, minutes or seconds); a span running backwards is omitted.
- `WITH <faction>` (faction_id). Click → Connections.
- Carrying summary — top stackables by quantity + equipped/carried
  counts in one line. Click → Carrying tab.
- Tags chip row — read-only on Overview; edits live on the
  Settings tab.
- Portrait — floats upper-right when populated; placeholder
  otherwise.

**Location Overview**:

- Status pill + location icon
- Description prose
- Parent chain — breadcrumb (`Shop in Town Square in City`) per
  [`LocationState.parent_location_id`](../../../data-model.md#locationstate-shape)
- `condition` — single line if populated
- "Characters here" count + first 3 names (portraits once the
  asset gallery lands)
- "Items here" count + first few names
- Portrait slot
- Tags

**Item Overview**:

- Status pill + item icon
- Description prose
- `condition` — single line if populated
- Position — `at_location_id` OR "Held by `<character>`"
  inverse-derived from any character's `equipped_items` /
  `inventory`
- Portrait slot
- Tags

**Faction Overview**:

- Status pill + faction icon
- Description prose
- `standing` — single line if populated
- Top agenda chips — top ~3 with overflow indicator
- Member count + first few member names (portraits once the asset
  gallery lands) from inverse-derived `character.faction_id`
- Portrait slot
- Tags

Empty regions show `— not yet described —` style placeholders with
`add →` links into Identity. The Overview stays read-mostly even
when sparse.

### Identity — editable body of "who this is"

Identity is pure identity content — no operational chrome. Composed
top-down:

**Character Identity**:

- Description (textarea)
- `Visual` sub-section: `visual.physique`, `visual.face`,
  `visual.hair`, `visual.eyes`, `visual.attire` (live current —
  classifier-updated), `visual.distinguishing` (single string)
- `Personality` sub-section: `traits[]`, `drives[]`, `voice`

**Location Identity**:

- Description
- `condition` (single-string, optional — dynamic state delta
  from description baseline)

**Item Identity**:

- Description
- `condition` (single-string, optional)

**Faction Identity**:

- Description
- `standing` (single-string, optional — dynamic power / situation)
- `agenda[]` (chip list, soft cap 4)

Faction's Identity is the closest in shape to character's, since
`standing` + `agenda` parallel `voice` + `drives`. Location and
Item are sparser (one dynamic field).

`status`, `injection_mode`, `retired_reason`, `keywords`, `priority`,
`tags`, and
`portrait` deliberately do not live here — see
[Settings](#settings--entity-management-chrome) and the Overview
portrait slot.

### Carrying — character-only

Composition (in order):

- `stackables` (`Record<string, number>`): editable rows of quantity
  name and count, with `Add quantity`. Keys are stored trimmed and
  lowercased, a duplicate key is a draft issue that disables Save,
  and a count of 0 removes the quantity; the Overview keeps the
  one-line glance. Footnote retained ("Carried quantities — tracked
  on the character, not on container items").
- `equipped_items[]`: entity-ref list (picker-backed), labeled
  `Equipped`.
- `inventory[]`: entity-ref list, labeled `Carried`.

Tab is hidden entirely for non-character kinds.

### Connections — positional / compositional / affiliation / relationships

Per-kind sub-labels:

| Kind          | Sub-labels                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Character** | `Positional` (current_location_id) · `Affiliation` (faction_id) · `Relationships` (char→char) · `Last seen` (read-only) |
| **Location**  | `Compositional` (parent_location_id) · `Characters here` · `Items here` (inverse)                                       |
| **Item**      | `Positional` (at_location_id) · `Held by` (inverse from `character.equipped_items` / `inventory`)                       |
| **Faction**   | `Members` (inverse from `character.faction_id`) · inter-faction (deferred)                                              |

Connections is where entity navigation lives. A picker holding an
entity (current location, faction, parent location, an item's
location) carries an open action — an external-link icon before
its clear `×`, spaced so their phone touch zones don't overlap —
that opens that entity's detail pane; it stays live while edits
are blocked, since navigating isn't editing. The inverse lists
link each name.

The tab name **Connections** is the umbrella for both structural
links (positional, affiliation) and social bonds. It was originally
slimmed from an older "Relationships" tab to be forward-compatible
when the char→char schema landed — see
[`patterns/entity.md`](../../patterns/entity.md#entity-detail-pane-composition).
The Relationships sub-section (below) is that landing.

`lastSeenAt` is classifier-only per the
[authorship contract](../../../data-model.md#authorship-contract);
read-only on the UI.

#### Relationships — character-to-character

Backed by the
[`character_relationships`](../../../data-model.md#character-to-character-relationships)
table. One row per other character the current character has a
recorded relationship with. Asymmetric perspectives render together
so the divergence — when present — is legible at a glance.

**Row composition** — uses the
[`ListRow`](../../patterns/lists.md) primitive:

- `leading` — [`EntityKindIcon`](../../patterns/entity.md#entity-kind-indicators--icons-not-text)
  for character.
- `label` — the other character's name.
- `description` — both perspectives, joined by `·`. The current
  character's view comes first; the other character's view second,
  prefixed for disambiguation. Null perspectives render as "not
  recorded" rather than blank — the gap is information.
- `trailing` — chevron (whole-row tap expands the inline edit card).

**Three perspective states** (mirrors the schema's `kind` /
`inverse_kind` nullability):

| State                 | `description` shape                             |
| --------------------- | ----------------------------------------------- |
| Both perspectives     | `sister · he sees you: brother`                 |
| Only self→other known | `mentor · their view: not recorded`             |
| Only other→self known | `your view: not recorded · they see you: rival` |

Pronouns default to "they / their" when the other character's
gender is unknown — the schema doesn't model gender, and pronoun
authoring is a downstream concern shared with any other place names
are referenced.

**Affordances:**

- **Add** — `+ Add relationship` row pinned at the bottom of the
  Relationships sub-section. Appends an inline edit card: the entity
  picker over branch-scoped characters (excluding the current one and
  those already related), plus two text fields for `kind` (your view)
  and `inverse_kind` (their view). At least one of the two must be
  non-empty per the DB `CHECK` constraint; an empty pair is a draft
  issue that disables Save. The card is inline rather than a sheet: the
  picker is itself a Sheet on phone, and
  [a Sheet may not open over a Sheet](../../foundations/mobile/layout.md#stacking).
- **Edit** — whole-row tap expands the same card, pre-filled.
- **Delete** — destructive action inside the card. Consistent with
  edit affordances elsewhere on World — destructive actions live in
  the editor, not on the row.
- **Save** — relationship edits join the pane's save session: one Save
  commits them with the rest of the pane under one `action_id`, each
  pair as a single write carrying both perspectives. Only the user's
  own changes relative to what the pane showed are written; a pair or
  view the classifier changed meanwhile, and the user left alone,
  keeps its stored value.

**Edits and memory updates.** A memory update never overwrites a
status, a removed alias or a relationship view the user saved after the
prose it processes, whether the save came before the pass started or
while it ran, and it does not re-create a pair the user deleted after
that prose
([`cadence.md → User edits and classifier writes`](../../../memory/cadence.md#user-edits-and-classifier-writes)).
Prose written after the user's edit can still revise it, per the
authoring contract below. A Save leaves a pass's writes alone the same
way: keywords, like relationships, merge three-way, so the Save applies
only the terms the user added or removed to the stored list, and an
alias a pass appended while the list was dirty stays. The generation
status pill reads
`updating memory…` while a pass runs
([`generation-status-pill.md → Non-blocking phases`](../../patterns/generation-status-pill.md#non-blocking-phases)).

**Empty state.** When the character has no recorded relationships,
render the Relationships sub-section heading + an empty-state hint
("No relationships recorded yet") + the `+ Add relationship` row.
Sub-section is never hidden — discoverability of the affordance
matters even with empty data.

**Authoring contract reminder.** Classifier writes follow the same
v1 lean as the rest of CharacterState: the classifier UPSERTs based
on prose evidence, user edits stick only until contradicting prose.
The asymmetric two-field shape means each perspective is independent
— the classifier may update `kind` without touching `inverse_kind`
if the new prose only surfaces one side. See
[`data-model.md → Character-to-character relationships`](../../../data-model.md#character-to-character-relationships)
for the full authoring + UPSERT contract.

### Settings — entity-management chrome

Same fields for every kind:

- `status` (enum select): `active` / `staged` / `retired`. Edits
  here propagate to the Overview status pill.
- `injection_mode` (enum select with explanation): `always` /
  `auto` (default) / `disabled`. Includes the standard
  in-line explanation about scene-presence override.
- `retired_reason` (text, conditional): only enabled when
  `status === 'retired'`.
- `keywords` (chip row with `+ add`): aliases, titles and relational
  references the entity is called by in prose beyond its canonical
  name — "the Grey Wolf", "your brother", "the innkeeper". Matched
  alongside `name` by the keyword retrieval pathway. Same TagInput
  shape as `tags`, but distinct in purpose: tags are user-meaningful
  labels, keywords are retrieval-targeted strings. The periodic
  classifier also appends here when it observes a new reference; it
  never removes, so user-authored entries survive.
- `priority` (integer input, narrow; range `0..100`). Default `0`.
  Orders which keyword-matched rows seat first when more match than
  the keyword budget admits. **Unlike lore's `priority`, it does not
  affect ranking** — entities carry no pin signal, so at any value
  this is inert until keyword injection is on and overfull. See
  [`memory/retrieval.md → Keyword injection budget`](../../../memory/retrieval.md#keyword-injection-budget).
- `tags` (chip row with `+ add`): edit destination for the tags
  surfaced read-only on Overview.

Rationale for separating these fields from Identity lives in
[`patterns/entity.md → Why Settings is a separate tab`](../../patterns/entity.md#why-settings-is-a-separate-tab).

### Assets, Involvements, History

Unchanged from prior design.

- **Assets** — attached images / audio / files via `entry_assets`.
  Drop upload, pick from gallery, remove.
- **Involvements** — `happening_involvements` table for this
  entity. Rows are read-only here and open the happening in Plot, on
  its Involvements tab.
- **History** — delta log filtered to this entity, and the deltas of
  the link rows naming it. See [History tab](#history-tab) section
  below.

## List pane — search scope

Search is **category-aware** — scope changes with the active
category dropdown:

- **Characters / locations / items / factions** (entity rows) —
  per [`patterns/entity.md → Search scope`](../../patterns/entity.md#search-scope).
- **Lore**: `title`, `body`, `category`, `tags`

Affordances (placeholder + tooltip + ⓘ help icon) follow the
[search-bar-scope pattern](../../patterns/lists.md#search-bar-scope).

## Detail pane — raw JSON viewer

The `⋯ → View raw JSON` action opens the shared
[Raw JSON viewer](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
drawer. No World-specific deviation.

## Delete

Shared spec for World (entity, lore) and Plot (thread, happening —
[`plot.md → Detail-head overflow menu`](../plot/plot.md#detail-head-overflow-menu)).
`⋯ → Delete entity` (or `Delete` on lore, `Delete thread` /
`Delete happening` on Plot) routes through the pane's Save / Discard /
Cancel guard first when the row is dirty, on both screens, then raises
a confirm built from the row re-read by id. A resolved Save can rename
or remove it. Its impact counts are a snapshot at that moment, not a
live read — the arm re-reads the cascade at apply time regardless. A
pending confirm is cancelled when the screen loses focus, on both
screens.

The confirm's description reads "You can undo this from the reader:
Undo last action in its menu, or Cmd/Ctrl-Z," naming the reader's own
undo label so the copy can't drift from the reader's menu — one shared
string (`common:deleteUndoHint`) across every kind. What else it lists
is per kind: an entity's awareness, involvement and relationship
counts, other entities losing their link to it, items left unplaced,
and "Removed from the current scene" when the tail scene names it; a
happening's involvement and awareness counts; nothing beyond the title
for lore or a thread. The CTA is per kind too — `Delete character`,
`Delete location`, `Delete item`, `Delete faction`, `Delete lore`,
`Delete thread`, `Delete happening`.

Confirming writes one delta group under one `action_id`, so CTRL-Z in
the reader restores the row (marked `embedding_stale`, so it
re-embeds at the next sync — vectors aren't delta-logged; see
[Reversibility](#reversibility)), its link rows whose other end still
exists (a separate reversal can have removed the far end first), and,
for an entity, the refs it cleared and the tail scene. What each kind's
cascade covers:

- **An entity.**
  - The row, its `happening_involvements`, `happening_awareness` and
    `character_relationships` rows, its translations and those of the
    relationships, and its vectors in every dim family.
  - Every other entity's reference to it — `current_location_id`,
    `parent_location_id`, `at_location_id`, `faction_id`,
    `equipped_items[]`, `inventory[]` — cleared in one `state` patch
    per entity. Items at a deleted location, or held by a deleted
    character, are left unplaced (no position is invented). A
    character's `lastSeenAt` is a snapshot, not a ref, and keeps a
    deleted location's id; the Last-seen line drops a location it
    can't resolve.
  - **The tail entry's scene.** The id leaves the tail's
    `sceneEntities`, and a deleted location stops being its
    `currentLocationId`, so the next turn doesn't inherit it. Earlier
    entries keep the id and render it as an Unknown-entity chip
    ([`entry-card.md → World-state panel`](../../patterns/entry-card.md#world-state-panel)).
  - **Orphaned collision flags.** A flagged row the delete leaves
    with no same-kind namesake has its flag cleared in the same
    action ([Surfacing](#surfacing)).
- **Lore.** The row, its translations and its vectors in every dim
  family.
- **A thread.** The row, its translations and its vectors in every
  dim family.
- **A happening.** The row, its `happening_involvements` and
  `happening_awareness` rows, its translations, and its vectors in
  every dim family.

**The lead can't be deleted.** The action refuses it (`lead-entity`)
and the overflow entry disables with a reason pointing at `Set as
lead`. The reason isn't the definitional lead requirement — a
creative third-person story, where a lead is optional, still can't
delete one once set — it's that the lead is story-level, not
per-branch or delta-logged
([`data-model.md → Story settings shape`](../../../data-model.md#story-settings-shape)),
and `setStoryLead` has no path to clear it back to null.

A regenerate or rollback that reaches a turn before the delete brings
the row back, like any World edit.

## Per-row import

The list-pane carries the EntityListPane affordance — minimalist
`[+]` icon-action right-anchored on the kind-selector row. Per-kind
tooltip resolves to `New character`, `New location`, `New item`,
`New faction`, or `New lore` per the active category; lore is not
an entity, so the generic "New entity" copy would mis-label the
lore creation path.

The button opens an `ImporterMenu` with the standard
[import-counterparts options](../../patterns/data.md#import-counterparts--file-based--vault)
(Blank / From JSON file…). `From JSON file…` opens
the shared [`ImportDialog`](../../patterns/import-dialog.md)
configured for the active kind:

- For entity kinds (character / location / item / faction):
  `format='aventuras-entity'`, `payloadKey='entity'`, and a
  **kind-narrowed** zod schema
  (e.g. `EntityImportSchema.refine(e => e.kind === activeKind, …)`)
  so a wrong-kind JSON imported via the wrong slot surfaces as a
  payload-error rather than emitting a wrong-kind payload. See
  [ImportDialog → World per-row entity import](../../patterns/import-dialog.md#world-per-row-entity-import).
- For lore: `format='aventuras-lore'`, `payloadKey='lore'`,
  `schema=LoreImportSchema`.

## History tab

History is the delta log filtered to this row: every delta keyed
to this row (`op=create / update / delete`), and the deltas of the
link rows that name it (see **Link rows** below). Never editable —
rollback happens in the reader. Row rendering follows the
[DeltaLogRow pattern](../../patterns/delta-log-row.md); host
resolves target display names and renders the diff summary
prose, then hands pre-formatted strings to the compound.

- **Search** — structured: `field-path strings`, `op`, and the
  rendered change-summary text. `op` matches its rendered label
  (word-start) or the raw enum; the field-path and free-text arms
  apply to `update` deltas only, since a delete's undo payload is the
  full row and would match every path. The free-text arm is a `LIKE`
  over each `undo_payload` member's JSON text, skipping `$`-prefixed
  meta members, with the term JSON-escaped the same way, so it
  matches the value from before the change, not the new one. A whole
  update summary typed as shown (`Modified Traits, Drives`) matches an
  update when every field it names resolves, through the label
  vocabulary or as a literal path, to a path in its undo payload —
  field values never match a summary. A field path is tested via
  `json_type(undo_payload, '$.<path>') IS NOT NULL`, not
  `json_extract` (which misses a `null` pre-change value); a search
  term also resolves against the field-path label vocabulary, so
  typing a rendered label (not just its raw path) matches the paths
  it names. A term resolves against the labels of the table each
  delta belongs to, so a link row's paths match its own labels, a
  relationship's by the tab's side of the pair: "Modified Your view"
  lists each side's edits against that side's labels, never across
  sides. A link row's target line is searchable too: a term starting
  a word of its link label (`Relationship`, `Involvement`,
  `Awareness`) or of its other end's name lists that link row's
  deltas and the other-end deletes that removed it. A removal also
  matches a term starting a word of its target label (`Links` when it
  held several kinds, else that kind's label) or of the label of any
  kind it held. Its summary is searchable too: a term that starts a
  word run of the named wording, typed whole or partway, matches
  every removal, and the wording plus a partial name matches the
  removals whose other end has a name word starting with it. The
  unknown-end wording, typed whole, matches only the removals that
  read it, those whose other end has no name. The row's own
  target line is constant within the tab, so it is never matched.
  SQLite filters server-side; lazy-loaded delta log doesn't need to
  be fully in memory.
- **Op filter** — all / create / update / delete. Link deltas count
  too: `Created` also lists the link rows made, and `Deleted` a
  link row removed on its own and an other end's delete.
- **Sort** — newest-first (default) or oldest-first
- **Load-older chunking** — log-shaped data, 50-row chunks; uses the
  [load-older pattern](../../patterns/lists.md#load-older--log-shaped-unbounded-lists)
  (`Load older` under newest-first sort, `Load newer` under
  oldest-first), not virtualization.
- **Failed load** — a failed first-chunk load shows a failed
  state with Retry; a failed load-more keeps the rows already
  shown, toasts, and leaves `Load older` to try again.
- **Before the first save** — an unsaved row's tab reads "History
  starts at the first save" instead of an empty log.
- **Resets on row change** — search, op filter and sort return to
  their defaults when the tab is keyed to a new row.
- **Link rows** — the tab also lists the edits of the link rows that
  name its row, in log order among its own deltas: a character's
  relationships and awareness rows, any entity's involvements, and a
  happening's involvements and awareness rows. A relationship edit
  lists on both characters' tabs, whichever view it changed. Three
  sources feed it: live link rows; link rows deleted on their own,
  whose delete delta's payload names both ends; and link rows removed
  with the other end's delete, which log no delta of their own and
  ride in that delete's payload under `relationships`, `involvements`
  or `awareness`
  ([Reverse-replay](../../../generation-pipeline.md#reverse-replay)).
  That delete lists once on the surviving tab, under `Deleted`; a
  reversal that takes a link row strips it out of a later delete's
  payload, so no removal lists for a row the reversal took.
  Retrieval-count bumps, awareness updates whose undo payload holds
  only `retrievalCount`, are left out; an update that also changed
  another column is listed. A merge re-creates the loser's link rows
  on the canonical under new ids, so their earlier edits stay with
  the originals and list on the other end's tab, not the canonical's
  ([Reversibility](#reversibility)).
- **Link-row wording** — a link delta's target line names the link and
  its other end, `Relationship · Kael` (or `Involvement`,
  `Awareness`). The other end's name is read live, the working set
  first, then its stored row, else from the other end's own latest
  delete payload, always within the tab's branch, else "Unknown row";
  a rename shows without a reload. Summaries read `Created`,
  `Modified <fields>` and `Deleted`. An other end's delete reads
  "Removed when Kael was deleted" under the link label alone, `Links`
  when it removed more than one kind; with no name to read, "Removed
  when its other end was deleted". A relationship's `kind` and
  `inverseKind` read "Your view" and "Their view" by the tab's side:
  `kind` is `a`'s view of `b`, with `a_id < b_id`, so the tab's
  character holds `kind` when it is `a`. An involvement's `role` reads
  "Role"; awareness columns read "Source", "Decay resistance",
  "Learned at" and "Retrieval count". The muted path stays the payload's raw key
  (`inverseKind`, not the column's snake case).
- **Refresh** — the tab refetches when its row changes in the working
  set, when a link row naming it is added, removed, or changes in a
  column whose edit it lists (a retrieval bump doesn't), when an other
  end it shows leaves the working set, so its name reads from its
  delete payload, when any other end is renamed while a search is set,
  shown or not, since the name match runs in SQLite, and when a run or
  reversal settles, which covers a reversal that only edits a delete's
  payload. Triggers that land close together, like the separate
  commits of one classifier pass, refetch once, shortly after the last.
  Between triggers, a search, filter or next chunk reuses the link rows
  found at the last one, since finding them reads every delete on the
  branch; other ends' names are read on every load.
  A `Load older` pressed while a refetch runs loads after it lands.
- **Rows aren't pressable.** `entry #n` is meta text; see
  [DeltaLogRow → Click behavior](../../patterns/delta-log-row.md#click-behavior).

Involvements table gets the same load-older pattern eventually; list
pane is fine unpaginated for normal stories (filter chips + search
handle it).

## Lore — separate kind

Lore lives in the `lore` table, not `entities`. Different schema,
different table, simpler than entities (more text-heavy, no
lifecycle, no scene presence, no actor semantics). The
detail-pane composition reflects the difference — fewer tabs,
simpler body shape, no Connections / Carrying / Assets /
Involvements analogs.

### Tab skeleton

```
Body | Settings | History
```

Three tabs. Settings + History parity with entity tabs preserves
the "this is a record-management surface, not just a content
editor" signal across kinds. Each absent tab is structurally
justified:

- No **Overview** — lore body is small enough to glance directly;
  no separate summary card needed.
- No **Carrying** — no holder semantics.
- No **Connections** — lore doesn't reference other entities;
  cross-lore via body text + tags + search.
- No **Assets** — parked until demand surfaces (per
  [`parked.md → Lore Assets`](../../../parked.md#lore-assets)).
- No **Involvements** — lore isn't an actor; doesn't participate in
  `happening_involvements`.

`Body` not `Identity`. `Identity` carries "who this is" framing
loaded for entities (description + visual + personality); lore has
subject matter, not identity. `Body` matches the schema field name
(`lore.body`) and reads as "the actual content of the lore entry."

### Detail head — lore

Mirrors the [entity detail head pattern](#detail-head-structure):

- **Title** (inline-editable with pencil) — equivalent of the entity
  name slot. Edits dirty the save session.
- **Recently-classified badge** — per
  [`patterns/entity.md → Recently-classified row accent`](../../patterns/entity.md#recently-classified-row-accent).
  Lore is classifier-touched at chapter close via the
  lore-management agent (per
  [`data-model.md → Chapters / memory system`](../../../data-model.md#chapters--memory-system));
  the same accent rule applies.
- **Overflow menu (⋯)**: `Export lore as JSON` (the row as an
  `aventuras-lore` `.avts` file: a download on desktop and web, the OS
  share sheet on native; no branch-local ids; like the entity export,
  live during generation, and with unsaved edits the file holds the
  saved row and a toast says so), `View raw JSON`,
  [`Delete`](#delete). **No `Set as lead`** — lead is a character-only concept
  per [`principles → Mode, lead, and narration`](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts).

### Body tab — lore

Two fields, no sub-sections.

- **Category** — single-row input at the top of the pane. Free-form
  text per the schema (`magic-system`, `religion`, `cosmology` are
  illustrative, not enumerated). On focus, a popover surfaces
  existing categories from this branch's lore as autocomplete
  suggestions, keeping casual taxonomy consistent without forcing
  an enum. A category saves exactly as typed or picked, casing
  included. Empty = `— uncategorized —` placeholder.
- **Body textarea** — grows with its content from 12 rows and
  scrolls internally past 40, per the
  [Textarea primitive](../../patterns/forms.md#textarea-primitive)'s
  content-driven height. Plain text per the schema; no markdown
  rendering or rich-text in v1. **Body is required**
  (see [Required body](#required-body--creation--edit-invariant) below).

Category lives on Body, not Settings, because category is
content-classification (answers "what kind of lore is this") and
pairs with the body it labels. Tags live on Settings — they
compose with the cross-cutting search and filter scaffolding
(per [`patterns/lists.md → search-bar-scope`](../../patterns/lists.md#search-bar-scope))
and pair with entity tags for cross-kind parity.

### Settings tab — lore

Four fields, top-down:

- **`injection_mode`** (enum select with explanation): `always` /
  `auto` (default) / `disabled`. Same select primitive entities
  use, with the same in-line explanation about how each mode
  interacts with retrieval.
  - `always` — force-injected into every prompt. Use sparingly
    (token cost).
  - `auto` — surfaced when retrieval (keyword + embedding +
    LLM-fallback) finds relevance with the current scene. Default.
  - `disabled` — never injected; lore is read-only reference
    material for the user.
- **`priority`** (integer input, narrow; range `0..100`). Default `0`.
  Inline `FormRow` hint text: "Higher priority makes this lore more
  likely to be picked when it's relevant. It won't surface lore the
  scene isn't about — use Always for that."
  That is the shipped semantic: priority feeds `pin_signal` as
  `priority/100`, which scales the row's score by
  `1 + k_pin × pin_signal` (`k_pin = 0.25` for lore). A no-op at the
  default `0`, and multiplicative, so it re-orders relevant lore rather
  than injecting irrelevant lore. See
  [`docs/memory/retrieval.md → Scoring function`](../../../memory/retrieval.md#scoring-function).
- **`keywords`** (chip row with `+ add`): the proper nouns and
  in-world terminology this lore should be retrieved by — "Vael",
  "the Aetherium", "blood-bound". This is the field the
  [load-bearing keyword pathway](../../../memory/retrieval.md#hybrid-retrieval-per-type)
  matches on: embedding models have no semantic prior for invented
  terms, so lore that is never keyworded is reachable only by
  thematic similarity. User-authored here; the lore-mgmt agent also
  emits keywords at chapter close. Distinct from `tags` — tags label,
  keywords retrieve.
- **`tags`** (chip row with `+ add`): edit destination for tags
  surfaced read-only on glance / search. Same shape as entity tags.

What's not on lore Settings:

- No `status` / `retired_reason` — lore has no lifecycle.
- No `category` — content classification, not operational chrome
  (lives on Body).

### List sort — lore (static, two-layer)

No user sort controls — rule-driven and stable, mirroring the
entity sort philosophy at
[`patterns/entity.md → Entity list sort order`](../../patterns/entity.md#entity-list-sort-order--static-four-layer).

1. **Layer 1:** `priority` descending. Higher priority first.
2. **Layer 2 (tiebreaker):** `title` alphabetical.

Applies to both Browse rail and World list pane.

Priority-as-sort-key needs no caveat now that retrieval semantics are
settled: the sort and the ranker say the same thing — higher priority
is more important to the user — so the list order previews the ranking
preference rather than competing with it.

### List filter — lore

**No filter chips.** Lore has no orthogonal categorical axes that
warrant chip-shaped filtering — no `status` lifecycle, no in-scene
concept, free-form `category` doesn't enumerate predictably. The
list-pane filter chip row is hidden when `Lore` is the active
list-pane category. Same applies to the Browse rail when its scope
filter targets lore.

A future "categories as dynamic chips" surface — distinct
`lore.category` values rendered as filter chips — is plausible at
high lore volume but premature now. No standalone followup unless
real volume signals demand.

### Required body — creation + edit invariant

A lore entry cannot exist with an empty `body` — whitespace-only
counts as empty. Validation lives at two places:

- **Body tab save** — Save and `Cmd/Ctrl-S` disable while the
  body is empty; Discard stays live, per
  [`save-sessions.md → Invalid draft`](../../patterns/save-sessions.md#invalid-draft).
  The reason shows in the save bar prefixed with its tab
  (`Body: Lore needs a body.`).
- **Creation paths** (per [Per-row import](#per-row-import) /
  [`patterns/data.md → import-counterparts`](../../patterns/data.md#import-counterparts--file-based--vault)):
  - **Blank** — the same Body-tab rule applies: Save stays
    disabled until the draft's body is non-empty.
  - **From JSON file** — Zod schema marks `body` required;
    mismatch fails the existing friendly-error path.

### History tab — lore

Same shape as the entity [History tab](#history-tab) — delta log
filtered to `target_table = lore` and this `lore_id`. Search +
op-filter + sort + load-older chunking all carry over. Lore
writes (user edits + lore-management agent at chapter close) all
flow through the delta log per the standard authorship contract,
so the History tab surface is uniform across the kinds with no
lore-specific deviation.

## Collision review and entity merge

The classifier writes `name_collision_flag = true` on a
freshly-created entity when the prose-extracted description
didn't match an existing same-name entity strongly enough to
promote the existing one. The flag means "this could be a
duplicate; the user should decide." Schema and classifier rules
live in
[`memory/edge-cases.md → Name collision`](../../../memory/edge-cases.md#name-collision-and-disambiguation).

The World panel is the only surface where the flag is resolved.
Three resolution paths are offered: **merge** the two rows into
one canonical entity, **rename** one to make them genuinely
distinct, or **keep as distinct** and accept both same-name rows.
Lore has no collision flag — only the four entity kinds
(character / location / item / faction) carry it.

### Surfacing

A collision flag is a "do something" signal, not a "narrow your
view" signal. Chrome appears wherever the flag exists; no extra
discovery step.

1. **Top-bar review pill** — when one or more entities on the
   current branch carry `name_collision_flag = true`, a
   `⚠ N need review` pill renders inline in the World top-bar,
   alongside the
   [generation status pill](../../principles.md#universal-in-story-chrome).
   Warn-tinted to distinguish. Hidden when N=0. Click → scrolls
   the list-pane to the first flagged row (and expands its
   accordion group if collapsed). On phone the label collapses
   to glyph + count (`⚠ N`) parallel to the gen pill.
2. **Per-row collision strip — always visible on flagged rows.**
   Each flagged row carries an inline strip below the standard
   row composition: `⚠ Collides with <other-name>` link plus a
   `Resolve →` button. Renders unconditionally — no filter
   activation, no extra tap to expose. Flagged rows show signal
   in-place wherever they live in the list (Active, Staged, or
   Retired group), warn-tinted so they read distinct from the
   surrounding rows. The strip is row-conditional (renders only
   on flagged rows), so unflagged rows stay decoration-clean and
   the
   [four-channel rule](../../patterns/entity.md#entity-row-indicators--four-orthogonal-channels)
   isn't violated for the common case.
3. **Collapsed-accordion badge** — when an accordion group
   (Active / Staged / Retired) is collapsed AND contains one or
   more flagged rows, the group header carries a small
   `⚠ N` count badge right of its chevron, outside the accordion
   trigger so pressing it never toggles the group. Keeps
   the signal visible without overriding the user's manual
   collapse intent. Click the badge → expands the group,
   scrolls to its first flagged row and moves focus to it.
   Hidden when the group is expanded (the strips themselves
   are visible) or when the group has no flagged rows.

The pill is the at-a-glance count and jump target. The strip is
the action surface. The badge is the bridge — keeps signal
visible when accordions hide rows. Every jump — pill, badge, or
the strip's `Collides with` link — moves focus to the row it
lands on: keyboard focus on web, the screen reader's on native.
On web, a surface that takes focus before the jump lands (a menu
opened in the meantime) keeps it.

A row's namesakes are the other rows of its kind whose names match
under the classifier's normalization (trimmed and case-folded),
staged and retired rows included. A flagged row with no namesake
left (an orphan) has nothing to pair with, so it gets no strip and
counts toward no pill or badge. Writes keep orphans from forming: a
rename (a detail-pane Save, or the dialog's [Rename](#rename)) or a
[delete](#delete) that leaves a flagged row without a namesake
clears that row's flag in the same action, delta-logged, so CTRL-Z
re-flags it. A reversal can still leave one, such as undoing a
namesake's create; it stays hidden until a later namesake pairs it
again, and resolving that pair clears it.

A "Needs review" filter chip was considered and rejected:
filter chips are for browsing modes, and a collision is an
attention signal. Filtering layered an extra tap between the
user and the action with no compensating browsing benefit.

### Resolve dialog

`Resolve →` opens a modal anchored to the World panel. Header
states the collision (`⚠ Two characters named "Kael"`) and
offers the three resolution paths as a primary action picker:

```
[ Merge into one ] [ Rename one ] [ Keep as distinct ]
```

Default is `Merge` — the most common intended resolution. Each
path collapses the dialog to a different body shape (below).
All paths are dismissible without writes (`Cancel` in the footer
or Esc).

When the open row has unsaved edits, `Resolve →` routes through
the pane's Save / Discard / Cancel guard first, as [Delete](#delete)
does. While open, the dialog reads both rows live: it closes on its
own once either row is gone or the two stop colliding (a rename on
another surface), and when the screen loses focus. A refusal shows
inline in the dialog, which stays open. A resolution that lands
closes it and toasts the result ("Merged into <name>.", "Names
saved.", "Kept as distinct."); a refusal that arrives after the
dialog has closed shows as an error toast instead, worded without
the dialog's advice (no row to pick any more). After a
resolution the list re-derives — the pill count drops and the strip
goes; with 3+ namesakes, another flagged row keeps its strip
([Authorship and 3+ collisions](#authorship-and-3-collisions)).

#### Merge

The body renders the two rows side-by-side with a **canonical
picker** at the top: a segment toggle picking which row's `id`
survives, each option naming its side (`Kael · Older · 3 days ago`)
since namesakes created close together read alike otherwise
(full-width radio rows on phone, where a half-width segment would
clip). The selection alone marks the surviving side, under the label
"Canonical (this row survives)"; an option's text stays the same
whichever side is picked. The non-canonical row is deleted at
end-of-merge.
Default selection is the older row by `created_at` — the older
row tends to have more accumulated state (relations, lore
links, history), so absorbing the newer one into it preserves
more by default.

Below the picker, a **per-field resolution table** lists fields
that diverge between the two:

| field        | Older · 3 days ago · Canonical                              | Newer · just now            |
| ------------ | ----------------------------------------------------------- | --------------------------- |
| description  | (•) wandering swordsman…                                    | ( ) guardsman at city gate… |
| status       | (•) active                                                  | ( ) active                  |
| `keywords[]` | union (default) — deselect per conflicting keyword          |                             |
| `tags[]`     | union (default) — deselect per conflicting tag              |                             |
| `state` JSON | follows the canonical row · edit on detail pane after merge |                             |

Field-level rules:

- **Divergent fields only.** Identical values on both sides
  don't render — there's no decision to make. The table lists
  only fields where side A and side B differ.
- **Top-level scalars** (`name`, `description`, `status`,
  `retired_reason`, `injection_mode`, `priority`) — radio per row
  when divergent.
- **`keywords[]`** — union by default with a per-keyword deselect,
  same shape as tags. Keywords compare by the classifier's term
  normalization, so a case variant is the same keyword, shown in the
  canonical's spelling when both rows hold it. Renders only when the
  two keyword sets differ under that rule; otherwise the merge keeps
  the canonical's own list as it is. Union rather than canonical-side
  because keywords drive retrieval matching, so dropping the losing
  side's aliases would narrow what the merged entity can be found by.
- **`tags[]`** — union by default with a per-tag deselect.
  Renders only when the two tag sets differ. The merged list, here
  and for keywords, keeps the canonical's entries in their order,
  with the other row's additions after them, the order the chips
  show. The merge builds it from the rows as they are when it
  writes, less the terms the user dropped, so a keyword the
  classifier adds while the merge waits is kept.
- **`state` JSON** — taken whole-side from canonical. Per-field
  diff inside `state` is out of scope for v1: schema shape
  varies per kind (character / location / item / faction),
  traversal/diff UI gets complex fast, and the canonical-picker
  default already encodes "older row's state wins." When the
  user wants the newer row's state, picking it as canonical and
  then editing top-level scalars from the loser is a clean
  two-step path. Surfaced as an inline note.
- **Long-text values.** Description and other prose-shaped
  fields wrap freely where the choices sit in columns (modal
  scrolls). On stacked tiers (phone, and every native tier), a
  3-line clamp applies with a "..." trailing truncation; tap
  the prose body to expand the row in place (prose that fits in
  three lines offers no tap). Radios stay tappable
  independently — the tap zone splits between the radio circle
  and the prose body. Keeps comparison glance-able when prose
  diverges in length.
- **Side identification.** On web above phone, a header row above
  the columns names each side (`Older · 3 days ago`,
  `Newer · just now`), the canonical's with a `· Canonical` suffix,
  since nothing else marks the surviving column there.
  Stacked tiers (phone, and every native tier) have no header row,
  so each radio's value carries an inline age caption underneath
  the prose, without the suffix — the wall-clock relative time the canonical picker
  shows, since an entity records when it was created, not the turn.
  Each stacked field is one radio group named by the field. Each
  radio is self-describing without relying on column position: its
  accessible name is the caption and the value
  (`Older · 3 days ago: active`).

A **relations summary** below the field table tells the user
what the merge carries over and what it drops (read-only —
relations always follow the canonical id). It shows the
non-canonical's counts:

- `Awareness rows: <N>` — the non-canonical's; re-created on the
  canonical except those the footnote counts as duplicates.
- `Involvements: <N>` — the non-canonical's; re-created on the
  canonical except those the footnote counts as duplicates.
- `Relationships: <N>` re-created on the canonical, one per other
  character. A relationship between the two rows is dropped; one
  the canonical already has with the same character keeps the
  canonical's views, taking the duplicate's only where its own is
  blank.
- `Inverse refs: <N>` other entities point at non-canonical via
  `inventory[]`, `equipped_items[]`, `current_location_id`,
  `parent_location_id`, `at_location_id`, or `faction_id` —
  rewritten to canonical. A ref between the two rows doesn't
  count: it collapses rather than moves, and when it is the
  canonical's (a location parented under the non-canonical) a
  footnote says the canonical loses it. A holder of a
  non-canonical item drops it instead when the canonical item
  already has a position ([Reversibility](#reversibility)), and
  still counts here.
- `Embeddings: <0|1>` vec0 row from non-canonical dropped (the
  canonical re-embeds if any of its embedded fields changed).
- `Items left unheld: <N>` items the non-canonical carries that
  nothing else holds or places. `state` follows the canonical, so
  they lose their holder.
- `Translation rows dropped: <N>` — the non-canonical's and its
  relationships'. The canonical keeps its own.

Duplicate handling is deterministic and not user-facing: when an
awareness row from non-canonical would collide on
`(branch_id, character_id, happening_id)` with an existing
canonical row, the canonical's row stays and the loser's row is
dropped. An involvement in a happening the canonical already takes
part in is dropped the same way: the table has no UNIQUE, but two
involvements of one entity in one happening say nothing one row
doesn't, and the canonical's `role` stays. For the same reason, of
the non-canonical's own involvements in one happening only the first
moves, with its `role`. A relationship the canonical already has
with the same character is the UNIQUE
`(branch_id, a_id, b_id)` case, handled as the list says. A
footnote under the relations summary counts each of these when the
case fires, and says when a holder loses an item because the
canonical item is already held or placed, that the relationship
between the two is dropped, or that the canonical's own ref to the
non-canonical is cleared.

A link row whose other end the branch no longer has (a happening or
character a reversed create removed) isn't counted or moved: a copy
would name a missing row, so the non-canonical's delete removes it
with the rest.

Footer:

```
[ Cancel ]        [ Merge into the <older|newer> <canonical-name> ]
```

The primary button echoes the canonical pick, its side as well as
its name, to keep the destructive direction obvious: the two names
match by construction.

The merge refuses, with the reason inline and nothing written, when
the non-canonical is the story's lead (`lead-entity`: the lead
can't be deleted, see [Delete](#delete) — pick it as the row that
survives), and when the canonical location descends from the
non-canonical through another location (`parent-cycle`: rewriting
that location's parent to the canonical would make the canonical its
own ancestor — picking the other row as canonical merges cleanly).
A parent chain the merge touches that already loops or runs past
the depth cap refuses as `parent-chain-broken`; fix that chain
first. The reason clears once the user changes a merge choice.

**The tail scene.** The tail entry's scene is the next turn's
retrieval floor, and the newer row a default merge deletes is the one
a later turn most likely put there. So when the non-canonical is in
the tail's scene or is its location, the merge points the tail at the
canonical: the id in `sceneEntities` becomes the canonical's (dropped
when the canonical is already there), and a `currentLocationId`
naming the non-canonical becomes the canonical's. The floor seats
only active rows, so the canonical is also promoted when its merged
status is `staged`, whatever its kind, even if the status choice was
left on staged; and a character canonical that takes the
non-canonical's place in the scene takes the tail's location when
that location is known. A canonical the scene already held beside
the non-canonical keeps its own location, which may be a manual
edit; it is still promoted. No other row is written: the scene isn't
re-folded and bystanders aren't re-anchored. A location merge tracks
no characters, since the ref rewrite already moves those at the
loser.

#### Rename

Body is a single inline rename form, two rows stacked:

```
Older · 3 days ago:   [ Kael                       ]
Newer · just now:     [ Kael (the guardsman)       ]
```

Editing either field dirties the form. Save commits under one
delta `action_id`: an `updateEntity` per row whose name changed,
and the flag cleared on each flagged row of the pair (folded into
that row's rename when it has one). Any other flagged row the
rename leaves with no namesake has its flag cleared too
([Surfacing](#surfacing)). No other writes — both rows continue to
exist. Names save trimmed.

Validation: both trimmed names must be non-empty and must stop
colliding under the namesake rule ([Surfacing](#surfacing)), so a
change of letter case alone still collides. Save disables until
that holds, and the help line says which rule fails (an untouched
form shows the plain prompt to change a name).

A name another row outside the pair already has, under the same
namesake rule, shows `Another row already has that name.` under its
field. It's a hint, not a block: the user may keep it, as Keep as
distinct allows, and the save writes no flag for the new pair. The
detail pane's name field shows the same hint for a typed name that
matches any other row of its kind, in create mode too.

#### Keep as distinct

Body is a confirmation panel:

> Both `Kael` entities will continue to exist with the same
> name. Retrieval treats them by id, but storyteller responses
> may conflate them in prose. Polymorphic naming is a
> documented v1 limitation
> ([`edge-cases.md → Polymorphic naming`](../../../memory/edge-cases.md#polymorphic-naming--v1-limitation))
> — the schema doesn't enforce unique names. The flag clears;
> no other writes.

Footer:

```
[ Cancel ]                              [ Keep as distinct ]
```

Confirming clears the flag on each flagged row of the pair, one
delta per row, without writing anything else. Clearing only the
newer row would leave an older flagged row, or a pair flagged on
both sides, with no way to resolve it. The user is opting into the
v1 limitation with eyes open.

### Reversibility

All three paths write deltas under a single `action_id` so
[CTRL-Z rollback](../../../data-model.md#entry-mutability--rollback)
unwinds the resolution as one step.

Merge writes, in order:

- `entities` op=`update` on canonical: the scalars taken from the
  non-canonical, the tag and keyword unions, `state` when it held a
  ref to the non-canonical (the ref collapses — a scalar nulls, an
  array drops it — since a location can't parent itself), the
  non-canonical's `at_location_id` when the canonical item has no
  position of its own (no holder, no placement), so the merged item
  keeps whichever position either side had, and the flag clear when
  the canonical is flagged.
- `entities` op=`update` on every other entity that held a ref to
  the non-canonical: its `state` paths rewritten to the canonical,
  one patch per entity, a character's `lastSeenAt` location among
  them. An item has at most one position
  ([`data-model.md → ItemState shape`](../../../data-model.md#itemstate-shape)),
  so when the canonical item is already held or placed by
  `at_location_id`, a character holding the non-canonical drops it
  instead of pointing at the canonical; otherwise its holders point
  at the canonical. Within one character, `equipped_items` and
  `inventory` count as one list for that de-duplication, equipped
  winning.
- `happening_awareness` op=`create` per moved row, on the
  canonical, carrying the row's `retrieval_count`. A row for a
  happening the canonical already knows, or one gone from the branch,
  isn't moved.
- `happening_involvements` op=`create` per moved row, on the
  canonical. One in a happening the canonical already takes part in
  or one gone from the branch isn't moved, nor one after the
  non-canonical's first in the same happening.
- `character_relationships` op=`create` (op=`update` when the
  canonical already has a row with that character) per character
  the non-canonical relates to, the views merged with the
  canonical's non-null view winning; no write when the canonical's
  row already holds them. The row keeps `a_id < b_id`, so a view
  changes column when the order flips. A relationship between the
  two rows, or with a character gone from the branch, isn't moved.
- `story_entries` metadata update on the tail entry when its scene
  names the non-canonical, or it is the tail's location
  ([Merge](#merge), the tail scene).
- `entities` op=`delete` on non-canonical, through the entity
  [delete](#delete) arm: its `undo_payload` carries the row and
  holds its original link rows and translations (its own and its
  relationships'), which the cascade removes. Translations are
  dropped, not moved: a translation belongs to a value the
  canonical may not take, and the canonical keeps its own.
- When the tail was rewritten, the canonical's scene effects: a
  promotion to `active` when its merged status is `staged` (folded
  into the canonical's update above when that already writes
  `status`, else its own `op=update`), and, for a character the
  merge brings into the scene, the tail's location as its
  `current_location_id` (folded into the
  canonical's `state` patch when it has one, else its own
  `op=update`).

Moved link rows are new rows with new ids, so their edits from
before the merge stay with the originals in the delete's payload.
They are user creates, though: a prose edit's sweep that reverses
the classifier pass which made the originals leaves the copies on
the canonical, unless a copy names a row that pass created
(rollback and regenerate sweep the merge group too and take them).
CTRL-Z restores the non-canonical as it was, with its original link
rows and translations, the refs and the tail scene; puts the
canonical's earlier columns back (scalars, tags, keywords, flag and
`state`, a tracked location included); and removes the rows the
merge created on the canonical.

Embeddings are not delta-logged
([`data-model.md → embeddings`](../../../data-model.md#diagram)) —
the loser's vec0 row drops when its entity row is deleted; on
rollback the restored entity row flags `embedding_stale` and
re-embeds at the next pre-retrieval sync stage, per the
[sync-before-read contract](../../../memory/retrieval.md#compute-lifecycle).
The user-visible behavior is "merge is reversible" — the
non-trivial wiring lives below the surface.

Rename writes an `entities` op=`update` per renamed row, and one
per flag it clears on a row it doesn't rename. Keep as distinct
writes one `entities` op=`update` per flagged row of the pair. Both
unwind as one step, like the merge.

### Edit restrictions during in-flight generation

The resolve dialog is a write surface; per
[`principles.md → Edit restrictions during in-flight generation`](../../principles.md#edit-restrictions-during-in-flight-generation),
the `Resolve →` button is disabled while narrative or
chapter-close generation is running, with the same disabled-
tooltip language as the entity save bar. A dialog already open
when generation starts stays open, with every submit disabled and
that reason under its footer; the write refuses while generation
is in flight regardless. The pill and strips stay visible —
discovery isn't gated, only the write.

### Authorship and 3+ collisions

Resolution writes deltas with `source = user_edit`. The classifier
sets the flag at create
([authorship contract](../../../data-model.md#authorship-contract));
clearing it is always a user write, delta-logged, so CTRL-Z
re-flags the row. Where
[user precedence](../../../memory/cadence.md#user-edits-and-classifier-writes)
applies (status, keywords, relationship views), what a resolution
writes counts as the user's: a classifier fact from prose older than
the resolution doesn't overwrite it. That includes a relationship
view the merge carries over from the non-canonical, though the
classifier first wrote it.
Only what the resolution changes counts — an unchanged column isn't
written.

The dialog handles two-side merges only. When 3+ entities
collide on the same name, the user iterates: resolve any pair,
and a flagged row outside it keeps its strip, now paired with a
remaining namesake. A strip names one partner per flagged row, an
unflagged namesake first, and keep or rename clears the flag on each
flagged row of the resolved pair even when that row has another
namesake the strip never named. So a remainder re-surfaces only
while it is itself flagged. N-way merge UI is not v1.

## Mobile expression

Phone forces master-detail collapse: list-first by default, detail
opens as a full-screen route within the World surface, back returns
to list. Tablet inherits the desktop 2-pane layout cramped at the
narrow end (~430 px detail pane on iPad portrait); detail-pane tab
nav reroutes to the Select primitive when the desktop tab strip
overflows.

- **Master-detail collapse on phone** per
  [`mobile/collapse.md → Two-pane navigation surfaces (World, Plot, Settings)`](../../foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
  List visible by default; row tap navigates to detail as a
  full-screen route (back-on-left returns to list state). The
  master-detail sub-header (`Characters / Kael Vex`) sits below
  the slim phone top bar at the route level.
- **Top-bar shape on phone** per
  [`mobile/navigation.md → Phone`](../../foundations/mobile/navigation.md#phone--640-px):
  slim single-row `[←] [<title> / World] [pill] [⛭] [⚲]`. The
  breadcrumb stays `<title> / World` on the detail route too — the
  sub-header already leads with the kind, per
  [`principles.md → Master-detail sub-header`](../../principles.md#master-detail-sub-header)
  (parent segments tappable per the breadcrumb-tappability
  amendment, current segment inert with tap-to-tooltip on truncation
  per
  [`mobile/touch.md`](../../foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text)).
- **Detail-pane tab navigation reroutes on narrow widths.** Tab
  strip is the desktop primitive; on tablet detail panes that
  can't fit the full strip (count > 3 — character at 8, location /
  item / faction at 7), and on phone always, the tab list hands
  off to the Select primitive's render-mode cascade per
  [`patterns/forms.md → Select primitive`](../../patterns/forms.md#select-primitive).
  The cascade picks segment mode for ≤ 2 options on phone, dropdown
  otherwise. Phone-tier dropdown opens via Sheet (short) per
  [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces);
  tablet-tier dropdown opens via anchored Popover. Same data,
  different primitive — analogous to the Reader rail's tier-aware
  swap. Lore (3 tabs): Tab strip on desktop and tablet, Select
  dropdown on phone (3 > 2, the mobile cardinality cutoff).
- **List-pane category dropdown** (`[Characters ▾]`) is already a
  custom Select component (not a native `<select>`); on phone the
  dropdown render mode opens via Sheet (short) per the same binding
  as the tab dropdown. Five flat categories — fits the short-Sheet
  threshold cleanly.
- **List-pane chrome** stacks vertically on phone — search input
  one row, filter chips wrapping below via the existing
  `flex-wrap` rule. No layout change.
- **Detail-head overflow menu (`⋯`)** binds to Popover on desktop /
  tablet, Sheet (short) on phone per
  [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
  Same content (`Set as lead` / `Export entity as JSON` /
  `View raw JSON` / `Delete entity`). Lore detail-head omits
  `Set as lead` (per the existing per-kind note); rule otherwise
  identical.
- **Per-row import affordance** — the EntityListPane `[+]`
  icon-action reads naturally on phone too (touch-tier hit area
  per the icon-actions touch-tier minimum). The import-counterparts
  dropdown (`Blank` / `From JSON file…`) opens
  as Sheet (short) on phone per the layout binding for
  popover-style menus.
- **Raw JSON viewer** inherits the binding-table mapping: Sheet
  (right ~440 px) on desktop, Sheet (bottom, tall ~95 %) on phone
  per [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
- **Overview portrait reflows on phone.** The detail-head portrait
  slot floats at 220 px upper-right on desktop and tablet; on
  phone that eats ~56 % of the 390 px viewport, squeezing
  description prose. Phone tier: portrait stacks below the prose
  at ~100 px, matching the peek body's compact portrait (glance
  content first, visual reference below). Tap the portrait to
  view it full-size per
  [`principles.md → Tap a thumbnail to see it full-size`](../../principles.md#tap-a-thumbnail-to-see-it-full-size).
- **Form-field rows** follow the
  [stacked-on-narrow-container rule](../../patterns/forms.md#form-rows--stacked-on-narrow-container)
  shared with story-settings, app-settings, plot, and vault
  calendars — 2-col grid (180 px label-left / 1fr input-right,
  uppercase monospace label) when the form container is
  `≥ 640 px`, stacked single-column block (sentence-case sans
  label above, full-width input below) when the form container
  is `< 640 px`. Phone and tablet portrait detail panes stack;
  tablet landscape and desktop stay 2-col. Type-hint applies
  `overflow-wrap: anywhere` so long monospace strings break
  cleanly when 2-col is active.
- **History tab controls are container-keyed, not tier-keyed.** The
  History tab's `Toolbar` follows the
  [Toolbar container-keyed overflow rule](../../patterns/toolbar.md#cross-tier-overflow-rule):
  a single horizontal row (search, op-filter chips, sort picker)
  when the tab's own container is `≥ 1024 px`, and stacked below
  that — search on its own full-width row first, filter and sort
  chips wrapping beneath — regardless of device tier. Prevents the
  search field from collapsing to a multi-line vertical block at
  narrow widths.
- **Save bar on phone** stays at the bottom edge of the detail
  route's scroll region per
  [`patterns/save-sessions.md`](../../patterns/save-sessions.md) and
  rides above the soft keyboard per
  [`mobile/touch.md → Save bar on phone`](../../foundations/mobile/touch.md#save-bar-on-phone):
  the route reserves the keyboard's height. Navigate-away guard stays
  active throughout, including while the keyboard is open.
- **Stack-aware Return** binds the chrome `←`, Android
  `BackHandler`, and iOS swipe-back to the existing pop-one-level
  semantics per
  [`mobile/navigation.md → Stack-aware Return`](../../foundations/mobile/navigation.md#stack-aware-return-on-mobile).
  List ↔ detail navigation is a sub-stack within the World
  surface; back from detail routes to list, not to the prior
  top-level surface. Dirty-state save-session guard fires before
  the back action per
  [`patterns/save-sessions.md`](../../patterns/save-sessions.md).
- **Phone landscape** (~700–900 px) lands in tablet tier per the
  [responsive contract](../../foundations/mobile/responsive.md).
  2-pane (list ~340 px, detail ~360–560 px); cramped but usable.
  Tab-strip overflow rule applies per the tablet column.
- **Resolve dialog stays a Modal** on phone, as a short Modal does
  per
  [`mobile/layout.md → Mapping — desktop to mobile`](../../foundations/mobile/layout.md#mapping--desktop-to-mobile);
  it has no Sheet expression. Its body scrolls and its footer stays
  put. The merge body's column grid ([Merge](#merge)) stacks: each
  divergent field is a section (field name as header, then a radio
  row per side), and with no column headers to read, each radio
  carries an inline age caption under its value. The canonical
  picker becomes full-width radio rows, and prose values clamp to 3
  lines with tap-to-expand, the tap zone split from the radio's.
  The relations summary stays single-column.
- **Top-bar review pill** collapses on phone parallel to the
  [generation pill](../../principles.md#universal-in-story-chrome).
  The `need review` label drops; the warn glyph and the count
  number stay (`⚠ N`) so the at-a-glance signal survives without
  competing with the breadcrumb and actions cluster for line
  space. Full label returns at tablet+. The collapsed pill stays
  click-targetable — same affordance as desktop.
- **Per-row collision strip** wraps cleanly on phone — the
  collide-with link and Resolve button drop to a second row
  inside the strip when the row width can't fit them.
- **Collapsed-accordion badge** stays inline with the group
  header on phone. Group headers reflow no differently from
  their unflagged counterparts; the badge sits after the count
  in the same row.
