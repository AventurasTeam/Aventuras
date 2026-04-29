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
  (centered placeholder when the active scope has zero rows;
  applies to the list pane AND the detail-pane Involvements +
  History tabs)

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
│ [Characters ▾]      │ breadcrumb: ☺ character               │
│ search              │ Name: Kael ✎                    [⋯]  │
│ filter chips        │ ─────                                 │
│                     │ tabs: Overview | Identity | Carrying  │
│ list (accordion     │       | Connections | Assets |        │
│ on All filter)      │       Involvements | History          │
│                     │                                       │
│                     │ (selected tab content, scrolls)       │
│                     │                                       │
│                     │ ───                                   │
│                     │ save bar (when dirty)                 │
│                     │   N unsaved · [discard] [save ⌘S]     │
│ + New entity        │                                       │
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

Status selector is NOT chrome on the detail head; it's a typed form
field inside the Overview tab. The detail head carries only:

- A small breadcrumb strip: kind-icon + kind-name
- The entity name (inline-editable with pencil)
- A `Recently classified` badge — visible while the row is in the
  fresh or fading state (per
  [patterns → Recently-classified row accent](../../patterns/entity.md#recently-classified-row-accent)).
  Decays alongside the row tint.
- An overflow menu (⋯) anchored to the name row

The overflow menu holds rare-but-important actions:

- **Set as lead** (sets `stories.definition.leadEntityId`)
- **Export entity as JSON** (single-entity export)
- **View raw JSON** (debug/dev affordance)
- **Delete entity** (destructive; needs confirmation pass)

Raw JSON lives here (not as a prominent link) because it's
power-user/debug territory. One consistent pattern: ⋯ menus are where
"extra / rare" item-scoped actions live on any per-item surface.

## Tabs — per-kind composition

All four entity kinds share the same tab skeleton. Tabs distribute
fields by **semantic purpose**, not by JS shape — implemented as
[hand-written per-kind detail-pane components](../../patterns/entity.md#entity-detail-pane-composition):
`CharacterDetailPane`, `LocationDetailPane`, `ItemDetailPane`,
`FactionDetailPane`. Schema is the validation contract; UI owns
layout.

```
Overview | Identity | Carrying | Connections | Assets | Involvements | History
```

`Carrying` is **character-only** — hidden on location, item,
faction (no carry semantics). Other tabs render for every kind
with kind-specific content.

### Overview — glance summary, read-mostly

The Overview tab is a glance summary card, not the full form.
Click any region to route to the relevant edit tab. Doubles as
the [peek-drawer body](../reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)
at narrower (440px) width — same content, no duplicated design.

**Character Overview** (top-down):

- Status pill (`active` / `staged` / `retired` + `retired_reason`
  inline when retired).
- Description prose — full text (typically 1-3 sentences). Click →
  Identity tab.
- Visual line — first 1-2 populated `visual.*` fields joined with
  `·`. Click → Identity / Visual.
- `TRAITS` and `DRIVES` chip rows — first ~3 of each with `+ N` overflow
  indicator. Click → Identity / Personality.
- `IN <location>` (current_location_id link) `· last seen N days ago`
  (from `lastSeenAt`). Click location → that entity's detail pane.
- `WITH <faction>` (faction_id link). Click → that faction's detail
  pane.
- Carrying summary — top stackables by quantity + equipped/carried
  counts in one line. Click → Carrying tab.
- Tags chip row — read-only on Overview; edits live on Identity /
  Lifecycle.
- Portrait — floats upper-right when populated; placeholder
  otherwise.

**Location Overview**:

- Status pill + location icon
- Description prose
- Parent chain — breadcrumb (`Shop in Town Square in City`) per
  [`LocationState.parent_location_id`](../../../data-model.md#locationstate-shape)
- `condition` — single line if populated
- "Characters here" count + first 3 portraits (links)
- "Items here" count + first few names
- Portrait slot
- Tags

**Item Overview**:

- Status pill + item icon
- Description prose
- `condition` — single line if populated
- Position — `at_location_id` link OR "Held by `<character>`"
  inverse-derived from any character's `equipped_items` /
  `inventory`
- Portrait slot
- Tags

**Faction Overview**:

- Status pill + faction icon
- Description prose
- `standing` — single line if populated
- Top agenda chips — top ~3 with overflow indicator
- Member count + first few member portraits (links from
  inverse-derived `character.faction_id`)
- Portrait slot
- Tags

Empty regions show `— not yet described —` style placeholders with
`add →` links into Identity. The Overview stays read-mostly even
when sparse.

### Identity — editable body of "who this is"

Identity is the longest tab, intentionally — it carries the
intrinsic content of the entity. Composed top-down:

**Character Identity**:

- Description (textarea)
- `Visual` sub-section: `visual.physique`, `visual.face`,
  `visual.hair`, `visual.eyes`, `visual.attire` (live current —
  classifier-updated), `visual.distinguishing[]` (chip list)
- `Personality` sub-section: `traits[]`, `drives[]`, `voice`
- `Lifecycle` sub-section: `status`, `injection_mode`,
  `retired_reason` (conditional), `tags`. Smaller visual weight
  (collapsed-by-default accordion or quieter divider — visual
  identity decision). Lifecycle is intentionally not promoted to
  detail-head chrome.

**Location Identity**:

- Description
- `condition` (single-string, optional — dynamic state delta
  from description baseline)
- `Lifecycle` sub-section

**Item Identity**:

- Description
- `condition` (single-string, optional)
- `Lifecycle` sub-section

**Faction Identity**:

- Description
- `standing` (single-string, optional — dynamic power / situation)
- `agenda[]` (chip list, soft cap 4)
- `Lifecycle` sub-section

Faction's Identity is the closest in shape to character's, since
`standing` + `agenda` parallel `voice` + `drives`. Location and
Item are sparser (one dynamic field plus Lifecycle).

### Carrying — character-only

Composition (in order):

- `stackables` (`Record<string, number>`): chip row,
  `<key> × <count>` chips with `+ add`. Footnote retained
  ("Carried quantities — tracked on the character, not on
  container items").
- `equipped_items[]`: entity-ref list (picker-backed), labeled
  `Equipped`.
- `inventory[]`: entity-ref list, labeled `Carried`.

Tab is hidden entirely for non-character kinds.

### Connections — positional / compositional / affiliation

Slimmed from the older "Relationships" tab — the rename is
documented in
[`patterns/entity.md`](../../patterns/entity.md#entity-detail-pane-composition).
Per-kind sub-labels:

| Kind          | Sub-labels                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------- |
| **Character** | `Positional` (current_location_id) · `Affiliation` (faction_id) · `Last seen` (read-only)         |
| **Location**  | `Compositional` (parent_location_id) · `Characters here` · `Items here` (inverse)                 |
| **Item**      | `Positional` (at_location_id) · `Held by` (inverse from `character.equipped_items` / `inventory`) |
| **Faction**   | `Members` (inverse from `character.faction_id`) · inter-faction (deferred)                        |

`lastSeenAt` is classifier-only per the
[authorship contract](../../../data-model.md#authorship-contract);
read-only on the UI.

### Assets, Involvements, History

Unchanged from prior design.

- **Assets** — attached images / audio / files via `entry_assets`.
  Drop upload, pick from gallery, remove.
- **Involvements** — `happening_involvements` table for this
  entity. Rows link to happenings.
- **History** — delta log filtered to this entity. See
  [History tab](#history-tab) section below.

## List pane — search scope

Search is **category-aware** — scope changes with the active
category dropdown:

- **Characters / locations / items / factions** (entity rows):
  `name`, `description`, `tags`
- **Lore**: `title`, `body`, `category`, `tags`

Affordances (placeholder + tooltip + ⓘ help icon) follow the
[search-bar-scope pattern](../../patterns/lists.md#search-bar-scope);
SQLite-side, `LIKE` against typed columns + `json_each` over the
JSON `tags` array.

## Detail pane — raw JSON viewer

The `⋯ → View raw JSON` action opens the shared
[Raw JSON viewer](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
drawer. No World-specific deviation.

## Per-row import

`+ New entity` in the list-pane footer follows the standard
[import-counterparts pattern](../../patterns/data.md#import-counterparts--file-based--vault)
(Blank / From JSON file… / From Vault…). JSON imports validate
against the kind's zod schema; mismatch fails with a friendly
error rather than a partial save.

## History tab

History is the delta log filtered to this entity: every change
(`op=create / update / delete`) that touched this `entity_id`. Never
editable — rollback happens in the reader.

- **Search** — structured: `field-path strings`, `op`, and the
  rendered change-summary text. Backed by `LIKE` on
  `target_table` + `op` columns and `json_extract` over the
  `undo_payload` JSON. SQLite filters server-side; lazy-loaded
  delta log doesn't need to be fully in memory.
- **Op filter** — all / create / update / delete
- **Sort** — newest-first (default) or oldest-first
- **Load-older chunking** — log-shaped data; uses the
  [load-older pattern](../../patterns/lists.md#load-older--log-shaped-unbounded-lists)
  (explicit button), not virtualization.

Involvements table gets the same load-older pattern eventually; list
pane is fine unpaginated for normal stories (filter chips + search
handle it).

## Lore — separate kind

Lore lives in the `lore` table, not `entities`. Different schema,
different table, simpler than entities (more text-heavy). The same
philosophical shape applies — glance Overview + body editing tabs
by semantic group — but lore's detail-pane composition is its own
design pass.
