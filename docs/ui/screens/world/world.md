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
│ list (accordion     │       | Connections | Settings |      │
│ on All filter)      │       Assets | Involvements | History │
│                     │                                       │
│                     │ (selected tab content, scrolls)       │
│                     │                                       │
│                     │ ───                                   │
│                     │ save bar (when dirty)                 │
│                     │   N unsaved · [discard] [save ⌘S]     │
│ + New <kind>        │                                       │ ← label tracks active filter
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
- A `Recently classified` badge — per
  [patterns → Recently-classified row accent](../../patterns/entity.md#recently-classified-row-accent).
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
Overview | Identity | Carrying | Connections | Settings | Assets | Involvements | History
```

`Carrying` is **character-only** — hidden on location, item,
faction (no carry semantics). `Settings` applies to every kind
(every entity has status / injection_mode / retired_reason / tags).
Other tabs render for every kind with kind-specific content.

### Overview — glance summary, read-mostly

The Overview tab is a glance summary card, not the full form.
Click any region to route to the relevant edit tab. Doubles as
the [peek-drawer body](../reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)
at narrower (440px) width — same content, no duplicated design.

**Non-default injection-mode chip — applies to every kind.** A small
uppercase chip (`ALWAYS INJECTED` / `DISABLED`) sits inline next to
the status pill when `injection_mode` is non-default. Hidden for
the `keyword_llm` default to avoid noise on the common case;
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
- `IN <location>` (current_location_id link) `· last seen N days ago`
  (from `lastSeenAt`). Click location → that entity's detail pane.
- `WITH <faction>` (faction_id link). Click → that faction's detail
  pane.
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

Identity is pure identity content — no operational chrome. Composed
top-down:

**Character Identity**:

- Description (textarea)
- `Visual` sub-section: `visual.physique`, `visual.face`,
  `visual.hair`, `visual.eyes`, `visual.attire` (live current —
  classifier-updated), `visual.distinguishing[]` (chip list)
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

`status`, `injection_mode`, `retired_reason`, `tags`, and
`portrait` deliberately do not live here — see
[Settings](#settings--entity-management-chrome) and the Overview
portrait slot.

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

### Settings — entity-management chrome

Same fields for every kind:

- `status` (enum select): `active` / `staged` / `retired`. Edits
  here propagate to the Overview status pill.
- `injection_mode` (enum select with explanation): `always` /
  `keyword_llm` (default) / `disabled`. Includes the standard
  in-line explanation about scene-presence override.
- `retired_reason` (text, conditional): only enabled when
  `status === 'retired'`.
- `tags` (chip row with `+ add`): edit destination for the tags
  surfaced read-only on Overview.

Rationale for separating these fields from Identity lives in
[`patterns/entity.md → Why Settings is a separate tab`](../../patterns/entity.md#why-settings-is-a-separate-tab).

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
[search-bar-scope pattern](../../patterns/lists.md#search-bar-scope).

## Detail pane — raw JSON viewer

The `⋯ → View raw JSON` action opens the shared
[Raw JSON viewer](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
drawer. No World-specific deviation.

## Per-row import

The list-pane footer carries a kind-aware `+ New <kind>` button
(`+ New character`, `+ New location`, `+ New item`, `+ New
faction`, `+ New lore`) — label tracks the active list-pane
category. Lore is not an entity; the generic "+ New entity" copy
would mis-label the lore creation path.

The button follows the standard
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

- Breadcrumb strip: kind-icon + "Lore"
- **Title** (inline-editable with pencil) — equivalent of the entity
  name slot. Edits dirty the save session.
- **Recently-classified badge** — per
  [`patterns/entity.md → Recently-classified row accent`](../../patterns/entity.md#recently-classified-row-accent).
  Lore is classifier-touched at chapter close via the
  lore-management agent (per
  [`data-model.md → Chapters / memory system`](../../../data-model.md#chapters--memory-system));
  the same accent rule applies.
- **Overflow menu (⋯)**: `Export lore as JSON`, `View raw JSON`,
  `Delete`. **No `Set as lead`** — lead is a character-only concept
  per [`principles → Mode, lead, and narration`](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts).

### Body tab — lore

Two fields, no sub-sections.

- **Category** — single-row input at the top of the pane. Free-form
  text per the schema (`magic-system`, `religion`, `cosmology` are
  illustrative, not enumerated). On focus, a popover surfaces
  existing categories from this branch's lore as autocomplete
  suggestions, keeping casual taxonomy consistent without forcing
  an enum. Empty = `— uncategorized —` placeholder.
- **Body textarea** — fills the remaining vertical space. Plain
  text per the schema; no markdown rendering or rich-text in v1.
  Standard textarea grow / scroll behavior. **Body is required**
  (see [Required body](#required-body--creation--edit-invariant) below).

Category lives on Body, not Settings, because category is
content-classification (answers "what kind of lore is this") and
pairs with the body it labels. Tags live on Settings — they
compose with the cross-cutting search and filter scaffolding
(per [`patterns/lists.md → search-bar-scope`](../../patterns/lists.md#search-bar-scope))
and pair with entity tags for cross-kind parity.

### Settings tab — lore

Three fields, top-down:

- **`injection_mode`** (enum select with explanation): `always` /
  `keyword_llm` (default) / `disabled`. Same select primitive
  entities use, with the same in-line explanation about how each
  mode interacts with retrieval.
  - `always` — force-injected into every prompt. Use sparingly
    (token cost).
  - `keyword_llm` — surfaced when retrieval finds keyword overlap
    with the current scene. Default.
  - `disabled` — never injected; lore is read-only reference
    material for the user.
- **`priority`** (integer input, narrow). Default `0`. Tooltip
  explains the working model: "Higher priority is preferred when
  retrieval is token-budget-constrained. Ties break by recency.
  Semantics will firm up alongside the retrieval-agent design
  pass." The tooltip is honest about the spec gap; the field is
  editable but its precise effect is gated. Open question folded
  into the
  [`Lore-management agent shape`](../../../followups.md#lore-management-agent-shape)
  followup.
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

Priority-as-sort-key inherits the working-model caveat from the
priority-semantics open question. Until retrieval pins what
priority _does_, it pins what priority _means visually_ — "this
lore surfaces first in lists." If retrieval semantics later land
orthogonal to ranking, the sort still makes intuitive sense
(higher priority = "more important to the user") and doesn't need
to change.

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

A lore entry cannot exist with an empty `body`. Validation lives
at two places:

- **Body tab save** — save bar disables until body is non-empty.
- **Creation paths** (per [Per-row import](#per-row-import) /
  [`patterns/data.md → import-counterparts`](../../patterns/data.md#import-counterparts--file-based--vault)):
  - **Blank** — form must enforce body-non-empty before save bar
    enables.
  - **From JSON file** — Zod schema marks `body` required;
    mismatch fails the existing friendly-error path.
  - **From Vault** — vault entries already carry populated bodies
    (vault flow mostly deferred; verify when vault lands).

### History tab — lore

Same shape as the entity [History tab](#history-tab) — delta log
filtered to `target_table = lore` and this `lore_id`. Search +
op-filter + sort + load-older chunking all carry over. Lore
writes (user edits + lore-management agent at chapter close) all
flow through the delta log per the standard authorship contract,
so the History tab surface is uniform across the kinds with no
lore-specific deviation.

## Mobile expression

Phone forces master-detail collapse: list-first by default, detail
opens as a full-screen route within the World surface, back returns
to list. Tablet inherits the desktop 2-pane layout cramped at the
narrow end (~430 px detail pane on iPad portrait); detail-pane tab
nav reroutes to the Select primitive when the desktop tab strip
overflows.

- **Master-detail collapse on phone** per
  [`mobile/collapse.md → World`](../../foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
  List visible by default; row tap navigates to detail as a
  full-screen route (back-on-left returns to list state). The
  master-detail sub-header (`Characters / Kael Vex`) sits below
  the slim phone top bar at the route level.
- **Top-bar shape on phone** per
  [`mobile/navigation.md → Phone`](../../foundations/mobile/navigation.md#phone--640-px):
  slim single-row `[←] [<title> / World] [pill] [⛭] [⚲]`. List
  state breadcrumb is `<title> / World`; detail-route extends to
  `<title> / World / <kind>` (parent segments tappable per the
  breadcrumb-tappability amendment, current segment inert with
  tap-to-tooltip on truncation per
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
- **Per-row import affordance** (`+ New <kind>` button) sits at
  list-pane foot, full-width on phone for tap-target clarity. The
  import-counterparts dropdown (`Blank` / `From JSON file…` /
  `From Vault…`) opens as Sheet (short) on phone per the layout
  binding for popover-style menus.
- **Raw JSON viewer** inherits the binding-table mapping: Sheet
  (right ~440 px) on desktop, Sheet (bottom, tall ~95 %) on phone
  per [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
- **Overview portrait reflows on phone.** The detail-head portrait
  slot floats at 220 px upper-right on desktop and tablet; on
  phone that eats ~56 % of the 390 px viewport, squeezing
  description prose. Phone tier: portrait stacks below the prose
  at ~100 px, matching the peek-drawer compact-head shape (glance
  content first, visual reference below). Tap the portrait to
  view it full-size per
  [`principles.md → Tap a thumbnail to see it full-size`](../../principles.md#tap-a-thumbnail-to-see-it-full-size).
- **Form-field labels compress on phone.** The detail-pane's
  `.field-row` uses a 180 px label column on desktop and tablet;
  on phone it drops to ~120 px (~30 % shrink) to give the input
  column more breathing room. Type-hint sub-text (under each
  label) wraps if necessary.
- **History tab controls reflow on narrow widths.** The
  `.history-controls` row (search input, op-filter chips, sort
  picker) is a single horizontal row at desktop tier; on tablet
  and phone it `flex-wrap`s, with the search input taking its own
  full-width row first and the filter and sort chips wrapping
  beneath. Prevents the search field from collapsing to a
  multi-line vertical block at narrow widths.
- **Save bar on phone** stays at the bottom edge of the
  detail-route's scroll region per
  [`patterns/save-sessions.md`](../../patterns/save-sessions.md);
  hides while the keyboard is open per
  [`mobile/touch.md → Save bar on phone`](../../foundations/mobile/touch.md#save-bar-on-phone),
  reappears on field blur. Navigate-away guard stays active
  throughout including during keyboard-open.
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
