# Per-kind detail-pane composition + character-data reorganization

Specs the World-panel detail-pane tab architecture for all four
entity kinds (character / location / item / faction), the
peek-drawer state-field layout (paired surface), and the move
from schema-driven form generation to hand-written per-kind
components. Resolves the "Per-kind Overview composition in World
panel" followup (removed from `followups.md` in the integration
commit).

## Background

Today's character Overview tab carries 11 fields at a flat nesting:
`status`, `injection_mode`, `description`, the 6 `Visual` sub-fields,
`traits`, `drives`, `voice`, `stackables`, `retired_reason`, `tags`,
`portrait`. Only `Visual` has a sub-section header. Other tabs
(Relationships, Assets, Involvements, History) work fine.

Three problems:

- **Overview isn't an overview.** It's the full character form,
  flat. There's no glanceable summary of who this character is.
  Reading anything requires scanning a long form.
- **Mixed concerns at one nesting level.** Lifecycle metadata
  (status, injection_mode, retired_reason), identity prose, visual,
  personality (traits/drives/voice), inventory metric (stackables),
  and chrome (tags, portrait) all sit at the same flat level.
- **Carry split.** Equipped items + inventory (entity refs) live
  on Relationships; stackables (key→count) lives on Overview.
  "What does this character carry?" splits across two tabs by JS
  shape rather than by semantic purpose.

The schema unblock for Location / Item / Faction landed in
[`data-model.md → World-state storage`](../data-model.md#world-state-storage).
Their UI compositions were never drawn. The same problem extends:
those kinds also need a tab architecture, not just a list of fields.

The peek-drawer state-field layout (per
[`reader-composer.md → Peek drawer`](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters))
is paired: peek is the lightweight surface that shows a per-kind
state subset, deep edit routes to World. Current peek body has a
placeholder `[peek-drawer state-field layout pending its own
design pass]`. Same design pass closes both surfaces.

A fourth problem surfaces on inspection: **the schema-driven form
generation pattern** (the rule documented in
[`entity.md → Entity detail-pane composition`](../ui/patterns/entity.md#entity-detail-pane-composition)
prior to this design — the heading was renamed in this commit;
the rule it carried said "fields distribute deterministically by
JS shape: scalars → Overview, entity-refs → Relationships,
holder-side records → Overview")
is the structural cause of the genericness. The current Overview
IS the generator's output: every field rendered identically as
a `field-row` with type-hint label, distributed by JS shape rather
than semantic purpose. Generic input → generic UI.

## Decisions

### 1. Hand-written per-kind components, not schema-driven generation

Schema-driven form generation made sense when (a) the data shape
was uncertain and (b) the kind count might grow. Both no longer
hold: v1 schema is locked across four kinds (CharacterState,
LocationState, ItemState, FactionState), and each shape's body is
small enough to compose explicitly.

The new contract:

- **Per-kind detail-pane components are hand-written.**
  `CharacterDetailPane`, `LocationDetailPane`, `ItemDetailPane`,
  `FactionDetailPane`. Each owns its tab structure and field
  layout explicitly. Lore lives in a separate table and gets its
  own pane (out of scope for this design).
- **The Zod schema is the validation contract** — single source
  of truth for the data shape. UI components reference fields by
  name; runtime validation uses the schema. Schema does not carry
  layout hints.
- **Common chrome lives as shared sub-components.** Status pill,
  description textarea, tags chip row, portrait slot, save bar,
  sub-section header — extracted as primitives reused across the
  four panes. Code reuse, not auto-generation.
- **Tab architecture (next decision) is a structural convention.**
  Documented in `entity.md`; per-kind components conform to it.
- **Translation routes via JSON paths** per
  [`data-model.md → Translation targets`](../data-model.md#translation-targets),
  independent of UI composition.

What we lose: drift risk between schema and UI when fields are
added. With four kinds + a locked v1 schema, that risk is small,
and it's arguably healthy — schema changes deserve a UI design
pass anyway.

What we gain: per-kind layouts can be thoughtful. Overview can
be a glance card. Identity can group sub-sections naturally.
The pattern doc tells the truth about how the code is built.

### 2. New tab architecture — semantic, not JS-shape

Tabs distribute fields by **semantic purpose**, not by whether a
field is a scalar or an entity reference. New tab list (character
shown; other kinds derive):

`Overview | Identity | Carrying | Connections | Assets | Involvements | History`

| Tab              | Content                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Overview**     | Glance summary card. Read-mostly. Click any region → routes to relevant edit tab. Doubles as the peek-drawer body.  |
| **Identity**     | Editable body of "who they are": `description`, Visual sub-section, Personality sub-section, Lifecycle sub-section. |
| **Carrying**     | Holder-shaped contents together: `stackables`, `equipped_items`, `inventory`. Resolves the carry split.             |
| **Connections**  | Positional, compositional, and affiliation links to other entities. (Renamed from Relationships — see §3.)          |
| **Assets**       | Unchanged.                                                                                                          |
| **Involvements** | Unchanged.                                                                                                          |
| **History**      | Unchanged.                                                                                                          |

Carrying is hidden on kinds that don't have carry semantics
(location, faction). Other kinds get the same
`Overview | Identity | Connections | ...` skeleton with
kind-specific Identity / Overview content.

#### Why this overturns the existing entity-pattern rule

The pre-existing rule (now retired in
[`entity.md → Entity detail-pane composition`](../ui/patterns/entity.md#entity-detail-pane-composition))
distributed fields by JS shape — "scalar / primitive → Overview,
entity-to-entity ID → Relationships, holder-side quantity record
→ Overview." The new design overturns it twice:

- **Routing changes from JS-shape to semantic purpose.** Fields
  go where they belong by meaning, not by type. Carrying mixes
  scalar `stackables` with entity-ref `equipped_items[]` /
  `inventory[]` because the user thinks of them together.
- **Generation changes from auto to hand-written.** The pattern
  retires the form-generator concept entirely.

`entity.md` updates to record both changes. The heading itself
renames from "Entity form UI generated from typed schema" to
"Entity detail-pane composition" — the old title is actively
misleading once generation is gone. Inbound anchor references
in `world.md` and `reader-composer.md` get swept in the same
commit.

### 3. Connections — renamed from Relationships

The existing tab name "Relationships" is DB-thinking — it
captures that the underlying fields are entity-to-entity refs.
From a user's reading, "Relationships" on a character detail
pane suggests friendships / enemies / romantic ties — social
bonds, not "where the character physically is and which faction
they belong to."

Rename to **Connections**. Broader umbrella that covers
positional + compositional + affiliation without misleading
into the social-relationships reading. Forward-compatible: the
deferred social-relationships graph (per
[`data-model.md → FactionState`](../data-model.md#factionstate-shape)
note on inter-faction relationships folding into a deferred
graph) can later claim the word "Relationships" for itself
when it lands as a feature.

Per-kind sub-labels inside Connections stay specific:

| Kind          | Sub-labels                                                                                |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Character** | `Positional` (current_location_id) · `Affiliation` (faction_id) · `Last seen` (read-only) |
| **Location**  | `Compositional` (parent_location_id) · `Characters here` · `Items here` (inverse)         |
| **Item**      | `Positional` (at_location_id) · `Held by` (inverse from char.equipped/inventory)          |
| **Faction**   | `Members` (inverse from char.faction_id) · inter-faction (deferred)                       |

`lastSeenAt` is classifier-only per the
[authorship contract](../data-model.md#authorship-contract);
read-only on the UI.

### 4. Overview tab — glance summary, not the form

Overview becomes a read-mostly summary card. No form fields, no
save bar interaction. Tapping any region routes to the relevant
edit tab.

**Character Overview composition** (top-down):

- **Status pill** + **kind icon** at the top (high-prominence —
  status is identity-state, not just chrome).
- **Description excerpt** — first ~2–3 lines of `description`
  with a subtle `more →` if truncated, routing to Identity.
- **Visual identity strip** — short descriptor row pulled from
  `visual.physique` + `visual.face` (or fallbacks). One line.
  Click → Identity / Visual.
- **Top traits + drives chips** — show ~3 of each (the first
  array elements, since the lore-mgmt agent compacts toward
  most-relevant-first). Overflow indicator (`+ N more`). Click
  any → Identity / Personality.
- **Current location** + **faction** — linked entity refs,
  navigable. `last seen N days ago in <Place>` underneath if
  `lastSeenAt` populated.
- **Carrying summary** — line like
  `200 gold · 30 silver · 7 rations · 3 items equipped, 4 carried`.
  Click → Carrying.
- **Portrait slot** — upper right of the card if populated;
  placeholder otherwise.
- **Tags** — chip row at the bottom, read-only.

Status is the only field that **also lives on Identity / Lifecycle**
(it's edited there). Overview just displays it.

This composition doubles as the **peek-drawer body** at narrower
width — same content, no duplication of design work. Peek's foot
keeps the existing `Open in World panel →` link.

### 5. Identity tab — the editable body of "who they are"

Identity gets the longest tab — accepted price for an actual
overview. Composition (top-down):

- **Description** — single textarea.
- **Visual** sub-section — 6 fields (physique, face, hair, eyes,
  attire, distinguishing[]).
- **Personality** sub-section — traits, drives, voice. (New
  sub-section header parallel to Visual.)
- **Lifecycle / Settings** sub-section — `status`,
  `injection_mode`, `retired_reason` (conditional), `tags`. Bottom
  of the tab. Smaller visual weight (collapsed-by-default
  accordion or just a quieter divider — visual identity decision).
  Lifecycle is intentionally not promoted to detail-head chrome:
  these fields aren't important enough to deserve permanent
  prominence.

Density: ~12 fields. Longer than today's Overview, but the content
is now coherent ("everything intrinsic to this character") rather
than mixed-purpose. The Identity tab IS the form; users coming
here have intent to edit.

### 6. Carrying tab — when applicable

For character kind only. Composition:

- **Stackables** (`Record<string, number>`) — chip row,
  `<key> × <count>` with `+ add`. Footnote retained from current
  design ("Carried quantities — tracked on the character").
- **Equipped** (`equipped_items[]`) — entity-ref list (picker-
  backed), label `Equipped`.
- **Inventory** (`inventory[]`) — entity-ref list, label
  `Carried`.

Tab is **hidden entirely** for non-character kinds. World panel's
tab strip renders only applicable tabs per kind.

### 7. Connections tab — slimmed to non-carry refs

After Carrying claims equipped / inventory, Connections holds:

**Character:**

- `current_location_id` (Positional)
- `faction_id` (Affiliation)
- `lastSeenAt` (cached snapshot — read-only display, classifier-
  only per the
  [authorship contract](../data-model.md#authorship-contract))

**Location:** `parent_location_id` (Compositional), member-character
inverse-derived list ("Characters here"), member-item inverse-derived
list ("Items here").

**Item:** `at_location_id` (Positional), holder inverse-derived
("Held by", from any character's equipped_items / inventory).

**Faction:** members inverse-derived (from character.faction_id).
Inter-faction relationships remain deferred per
[`data-model.md → FactionState`](../data-model.md#factionstate-shape).

### 8. Per-kind Identity composition

Other kinds have less-typed state but the same tab skeleton.
Identity is sparser but consistent:

**Location Identity:**

- Description
- `condition` (single-string, optional — dynamic state delta from
  description baseline)
- Lifecycle (status, injection_mode, retired_reason, tags)

**Item Identity:**

- Description
- `condition` (single-string, optional)
- Lifecycle (status, injection_mode, retired_reason, tags)

**Faction Identity:**

- Description
- `standing` (single-string, optional — dynamic power/situation)
- `agenda` chip-list (soft cap 4)
- Lifecycle (status, injection_mode, retired_reason, tags)

Faction's Identity is the closest in shape to character's, since
`standing` + `agenda` parallel `voice` + `drives`. Location and
Item are sparser (one dynamic field plus lifecycle); the tab still
beats stuffing them inline elsewhere.

### 9. Per-kind Overview composition

Overview is a glance summary for every kind. Per-kind shapes:

**Location Overview:**

- Status pill + location icon
- Description excerpt
- **Parent chain** — breadcrumb walk (`Shop in Town Square in
City`) per
  [`LocationState.parent_location_id`](../data-model.md#locationstate-shape)
- `condition` — single line if populated
- "Characters here" count + first 3 portraits (links)
- "Items here" count + first few names
- Portrait slot
- Tags

**Item Overview:**

- Status pill + item icon
- Description excerpt
- `condition` — single line if populated
- **Position** — `at_location_id` link OR "Held by <character>"
  if someone's equipped/inventory references it
- Portrait slot
- Tags

**Faction Overview:**

- Status pill + faction icon
- Description excerpt
- `standing` — single line if populated
- **Top agenda** — top ~3 chips with overflow indicator
- Member count + first few member portraits (links)
- Portrait slot
- Tags

### 10. Peek-drawer derivation

Peek body = Overview tab's content, scaled to 440px width.
Single design, two surfaces.

Peek's existing `Open in World panel →` foot link routes to the
World panel for deep edits. Peek itself stays read-mostly; the
inline lead-character mutation already documented in
[`reader-composer.md → Peek drawer`](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)
remains the only mutation surface on peek.

### 11. Lore (separate kind)

Lore lives in the `lore` table, not `entities`. Different schema,
out of scope for this design — lore's detail-pane composition is
a separate followup. The same philosophy (glance Overview + body
editing tabs by semantic group) applies; details land when lore
detail-pane gets focused attention.

## Adversarial pass

### Load-bearing assumption

That hand-written per-kind components stay maintained and don't
drift from the schema. Mitigations:

- TypeScript inference from the Zod schema gives compile-time
  catch when a field is renamed or removed.
- The lifecycle of "schema field added" is now: design pass →
  schema update → component update. Three deliberate steps; not
  free, but explicit. With v1 schema locked, the path is rarely
  walked.
- Common chrome (status pill, description textarea, tags row,
  portrait slot, sub-section header, save bar) is shared sub-
  components. New kinds reuse them rather than recreating them.

### Edge cases

- **Empty Carrying tab on character.** Character has no items
  equipped / carried, no stackables. Tab still renders (always
  present for character kind); inner panes show empty-state
  placeholders per
  [`patterns/lists.md → Empty list / table state`](../ui/patterns/lists.md#empty-list--table-state).
- **Identity tab is long.** ~12 fields plus 3 sub-section headers.
  Acknowledged price; coherence beats brevity. If real density
  bites, the Lifecycle sub-section is the natural collapse target.
- **Description excerpt on Overview.** Truncating prose at the
  wrong point produces awkward fragments. Mitigation: truncate at
  sentence boundary if possible, otherwise word-boundary with
  ellipsis. Implementation detail.
- **Overview routing on click.** Each region routes to a different
  edit tab (`description excerpt → Identity`, `top chips → Identity`,
  `carrying summary → Carrying`, `tags → Identity / Lifecycle`).
  Discoverability: a subtle arrow or hover indicator confirms
  clickability. Reuses existing chevron / underline treatments.
- **Status edited on Identity / Lifecycle, displayed on Overview.**
  Overview re-renders on save. Standard derived display.
- **Schema migration cost.** None. Existing `state` JSON is
  unchanged; the design only changes UI composition and the
  pattern that documents it.
- **Per-kind component duplication.** Four panes share chrome
  (status pill, description, tags, portrait, save bar) but differ
  in body. Risk: copy-paste duplication. Mitigation: extract
  shared sub-components; per-kind pane composes them with kind-
  specific body content.
- **Inverse-derived lists in Connections.** "Characters here" /
  "Held by" / "Members" require running an inverse query per
  detail-pane render. With v1 scale (single user, local SQLite,
  hundreds of entities), this is fine. If real density bites,
  caching or a derived table is the upgrade path.

### Read-site impact

- **`entity.md` pattern** — heading rename (`Entity form UI
generated from typed schema` → `Entity detail-pane composition`)
  - body rewrite. New rule: hand-written per-kind. Old shape-
    based routing rule retired. Inbound anchor references in
    `world.md` (line 19) and `reader-composer.md` sweep to the new
    anchor in the same commit.
- **`world.md`** — Tabs section rebuilt for the new architecture;
  per-kind Identity + Overview compositions documented; Connections
  rename folded in; Carrying tab visibility per kind documented.
- **`world.html`** — Wireframe rebuild for the four-kind detail
  pane. See Doc integration below.
- **`reader-composer.md → Peek drawer`** — peek body composition
  named: "same content as Overview, scaled to 440px." Removes
  TBD reference.
- **`reader-composer.html`** — peek body wireframe rebuilt to
  mirror the Overview composition.
- **`data-model.md`** — Authorship-contract table is unaffected
  (write contracts haven't changed). Schema is unchanged. No
  edits required.

### Doc-integration cascades

- Pattern-level rule change — `entity.md` is the canonical source
  and updates in the same commit as the per-screen changes.
- **Heading rename** in `entity.md` — old anchor
  `entity-form-ui-is-generated-from-the-typed-schema`, new anchor
  `entity-detail-pane-composition`. Two inbound references to
  sweep:
  - `world.md` line 19: cites the old anchor
  - `reader-composer.md` (verify): may cite via the rail-section
    cross-references to entity surfacing
- "Relationships" → "Connections" rename in canonical docs:
  - `world.md` Tabs section + Layout box (line 50: `Overview |
Rel | Assets | ...`)
  - `world.html` tab strip + tab panel + review-controls
- New peek-drawer state composition: anchor
  `peek-drawer--state-fields` or similar. Not yet present, no
  inbound refs to break.

### Missing perspective

- **Implementation cost.** Four hand-written panes + extracted
  shared chrome. Larger than retrofitting a generator, but the
  shared-chrome extraction gives reusable primitives the rest
  of the project benefits from.
- **Cross-platform.** No platform-specific concerns — World
  panel is desktop-primary, hand-written panes are no harder
  to build for RN-Web than generated ones.
- **Translation.** Translation routes by JSON path per
  [`data-model.md → Translation targets`](../data-model.md#translation-targets),
  unchanged by UI composition.
- **Undo / rollback.** Save sessions still own field-level edit
  granularity. Tabbing is presentation; deltas are unchanged.
- **Settings UI.** No App Settings exposure needed. Tab visibility
  is per-kind, not per-user-preference.

## Followups generated

- **Lore detail-pane composition.** Same philosophical shape
  (glance Overview + body tabs by semantic group); lore's table
  and fields differ. Lands when lore detail-pane gets focused
  attention.
- **Lifecycle sub-section visual treatment.** Whether the
  Lifecycle sub-section in Identity is visually-receded (smaller
  heading, lighter divider, default-collapsed accordion) is a
  visual identity decision.

## Doc integration

- **`docs/ui/patterns/entity.md`** —
  - **Heading rename:** `Entity form UI is generated from the
typed schema` → `Entity detail-pane composition`. Old anchor
    `entity-form-ui-is-generated-from-the-typed-schema` →
    new anchor `entity-detail-pane-composition`.
  - **Body rewrite:** retire the form-generator concept; document
    the hand-written per-kind contract; document the new tab
    architecture (`Overview | Identity | Carrying | Connections | Assets | Involvements | History`)
    and the per-kind tab visibility rule.
  - Update the `Used by:` section if needed (no new entries; the
    pattern is referenced by the same surfaces).
- **`docs/ui/screens/world/world.md`** —
  - Replace "Tabs (character kind)" with the new tab architecture.
    Add per-kind Identity + Overview compositions for location /
    item / faction.
  - Rename "Relationships" references to "Connections" in the
    Layout box and the principles cross-reference list.
  - Update the inbound `entity.md` anchor reference (line 19).
  - Update "Open for per-kind composition" closing note (now
    resolved).
- **`docs/ui/screens/world/world.html`** — wireframe rebuild:
  - Overview tab: glance card composition (per §4 / §9)
  - Identity tab: description + Visual + Personality + Lifecycle
    sub-sections (per §5 / §8)
  - Carrying tab: stackables + equipped + inventory; hidden on
    non-character kinds (per §6)
  - Connections tab: per-kind sub-labels (per §7); rename from
    Relationships
  - Per-kind tab visibility (Carrying hidden on non-character)
  - Per-kind Overview body shapes (per §9)
- **`docs/ui/screens/reader-composer/reader-composer.md`** —
  - Peek drawer section gains a "State-field composition"
    subsection naming the Overview-derivation rule.
  - Sweep any inbound `entity.md` anchor refs if present.
- **`docs/ui/screens/reader-composer/reader-composer.html`** —
  peek body wireframe updates to mirror Overview composition
  (no more `[peek-drawer state-field layout pending]` placeholder
  or `[free-form description ... data-model TBD]` placeholder).
- **`docs/followups.md`** — remove the "Per-kind Overview
  composition in World panel" entry (resolved by this integration).
