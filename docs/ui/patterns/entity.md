# Entity row patterns

Row-shaped UI patterns shared across the reader's Browse rail, the
World panel's list pane, and (for the recently-classified accent
specifically) the Plot panel's list panes. Sister patterns to
[`save-sessions.md`](./save-sessions.md) (the edit-commit pattern
entity forms ride), [`forms.md`](./forms.md),
[`lists.md`](./lists.md), and [`data.md`](./data.md).

Anchors here are the canonical URL for these patterns — per-screen
docs link in.

Used by:

- [Reader · Browse rail](../screens/reader-composer/reader-composer.md#browse-rail--collapse--expand)
  (entity surfacing levels, row indicators, kind icons, filter
  chips, accordion grouping)
- [Reader · Peek drawer](../screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)
  (entity surfacing — peek level; State-field composition projects
  from the World panel Overview tab)
- [World panel](../screens/world/world.md#tabs--per-kind-composition)
  (full row pattern, detail-pane composition, recently-classified
  accent — primary consumer)
- [Plot panel](../screens/plot/plot.md)
  (entity / happening row composition, recently-classified accent,
  accordion grouping)
- [Story list cards](../screens/story-list/story-list.md)
  (entity-list sort order rule)
- [Branch navigator](../screens/reader-composer/branch-navigator/branch-navigator.md)
  (pinned-to-top sort layer for current branch)
- [Wizard cast / lore lists](../screens/wizard/wizard.md#step-4--cast)
  (entity row composition + kind icons in step 3-4)

---

## Entity surfacing — three levels, same data

Same entity, three depths of UI:

1. **Browse rail** (reader right rail, ~300px) — list only, filter
   chips, scene indicator. Fast glance + row click.
2. **Peek drawer** (reader overlay, ~440px) — summary + quick edits
   (pencil icons on text fields). Opens on row click; Esc or × closes.
3. **World panel** (dedicated full-screen surface) — master-detail
   workshop. Left pane = filterable list. Right pane = single-entity
   detail with the standard tab skeleton (Overview / Identity /
   Carrying / Connections / Settings / Assets / Involvements /
   History; Carrying is character-only). See
   [Entity detail-pane composition](#entity-detail-pane-composition)
   below for the routing rules.

Peek drawer's footer link "Open in World panel →" routes to the panel.

---

## Entity kind indicators — icons, not text

Entity kind renders as a **square glyph icon** (22×22 box), not text.
Saves horizontal room in narrow rails; still categorical at a glance.

Wireframe placeholder glyphs:

| Kind      | Glyph |
| --------- | ----- |
| character | ☺     |
| location  | ⌂     |
| item      | ◆     |
| faction   | ⚑     |

Visual identity (session 5) picked the canonical Lucide names for
this scratch table — see
[`foundations/iconography.md → Entity kind glyphs`](../foundations/iconography.md#entity-kind-glyphs).
Wireframes continue to render the scratch glyphs above per the
[wireframe-authoring rule](../../conventions.md#wireframe-authoring);
the iconography table is the implementation reference.

---

## Entity row indicators — four orthogonal channels

An entity row carries four orthogonal signals that share no visual
primitives — each owns its own channel so any combination renders
correctly, and every row has identical structure (no value-dependent
absence that makes "nothing shown" ambiguous):

- **Lead badge** (gold pill, text mode-dependent): inline immediately
  after the name. Only present for the story's lead character. Label
  is `You` in adventure mode, `Protagonist` in creative mode.
- **Status pill** (always shown, muted when active): on the far
  right. Every row carries one of `active` / `staged` / `retired`.
  Active renders with muted styling (faint gray); staged = soft
  green; retired = soft amber.
- **Scene presence** (left-edge stripe): an in-scene row gets a
  3px green accent stripe along the left edge. Steady-state signal —
  "which rows matter right now."
- **Recently-classified** (background tint): rows whose source data
  the classifier wrote in the last 1-2 turns get a faint info-blue
  background tint that decays. Transient signal — see
  [Recently-classified row accent](#recently-classified-row-accent)
  for the full rule.

**Edge vs tint — load-bearing decoupling.** Scene-presence owns the
left-edge stripe; recently-classified owns the background tint. Both
can fire on the same row simultaneously (an in-scene character whose
state was just classifier-written) — `green left edge + info-blue
body tint` reads as both signals together with no contention. Future
row-level signals must claim a different primitive (right-edge,
inline badge, etc.) — these two are spoken for.

Applies to the reader's Browse rail AND the World panel's list pane.
CSS class convention: `.lead-badge`.

---

## Entity list sort order — static, four-layer

No user sort controls — list sort is rule-driven and stable:

1. **Layer 0 (lead pin, chars only):** when the current category is
   `characters`, the lead (if set) is pinned to the very top.
   Absolute override of all subsequent layers. Applies only to
   characters — other kinds have no lead concept.
2. **Layer 1 (status tier):** Active → Staged → Retired
   _(current → future → past, by narrative relevance)_
3. **Layer 2 (within Active only):** in-scene first, then
   not-in-scene
4. **Layer 3 (within each tier):** alphabetical by name

Applies to Browse rail and World panel list pane. Filter chips narrow
the set but sort still applies within the filtered subset. The lead
stays pinned unless the filter excludes them entirely.

---

## Browse filter chips

Mutually exclusive (single-select):
`All` / `In scene` / `Active` / `Staged` / `Retired`.

- `All` is the default and shows the full list with accordion
  grouping (see below).
- `In scene` is orthogonal to status.
- `Active` / `Staged` / `Retired` filter to one status tier.

Combining filters (e.g. "in-scene AND staged") is not supported in
v1; single-select keeps the UI simple.

### Accordion grouping on "All" view

When `All` is active, rows group under accordion headers keyed on a
**per-surface tier**, with click-to-collapse. Each header shows
name + count + chevron.

**Per-surface keys** (each per-screen doc names its own keys + which
tier defaults expanded):

- **World entities** → status tier (`Active` expanded /
  `Staged` collapsed / `Retired` collapsed). Working set first.
- **Plot threads** → status tier (`Active` / `Pending` /
  `Resolved` / `Failed`).
- **Plot happenings** → chapter bucket (`Current chapter` /
  `Earlier chapters` / `Out of narrative`).

The shared shape is "default-expand the working tier, collapse the
rest, session-scoped (not persisted), flatten to a single implicit
group when a non-All filter is active." Pattern lives here because
World entities adopted it first; Plot generalized to the keys above
without changing the rendering primitive.

---

## Entity detail-pane composition

`entities.state` is a typed discriminated union (CharacterState /
LocationState / ItemState / FactionState) — not a dynamic bag. With
the v1 schema locked across four kinds, detail-pane UI is
**hand-written per kind** rather than generated from the schema.
The Zod schema stays the validation contract; UI components own
layout.

### Hand-written per-kind components

- **One component per kind:** `CharacterDetailPane`,
  `LocationDetailPane`, `ItemDetailPane`, `FactionDetailPane`. Each
  knows its tab structure and field layout explicitly.
- **Schema = validation contract.** Zod parses + validates;
  components reference fields by name; TypeScript inference keeps
  field-name renames compile-time-safe.
- **No "+ add field" UI.** Schema is fixed; only per-kind fields
  exist.
- **Common chrome lives as shared sub-components** — status pill,
  description textarea, tags chip row, portrait slot, save bar,
  sub-section header. Reused across the four panes; not auto-
  generated.
- **Translation routes via JSON paths** per
  [`data-model.md → Translation targets`](../../data-model.md#translation-targets),
  independent of UI composition.
- **Raw JSON view** remains as a small power-user / debug
  affordance (overflow menu next to entity name), for export and
  troubleshooting.

### Tab architecture

All four kinds use the same tab skeleton, rendered via the
[Tabs primitive](./tabs.md) on tiers where the strip fits and
substituted to the Select primitive on narrower tiers per the
[Group C → Tab-strip overflow rule](../../explorations/2026-05-01-mobile-group-c-master-detail.md#tab-strip-overflow-rule):

```
Overview | Identity | Carrying | Connections | Settings | Assets | Involvements | History
```

| Tab              | Purpose                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| **Overview**     | Glance summary card. Read-mostly. Click any region routes to the relevant edit tab. Doubles as the peek body. |
| **Identity**     | Editable body of "who the entity is": description + kind-specific identity slots. Pure identity content.      |
| **Carrying**     | Holder-shaped contents (stackables + equipped + inventory). **Character-only** — hidden on other kinds.       |
| **Connections**  | Positional + compositional + affiliation links to other entities. Per-kind sub-labels.                        |
| **Settings**     | Entity-management chrome: status, injection_mode, retired_reason, tags. Same fields for all kinds.            |
| **Assets**       | Attached images / audio / files via `entry_assets`.                                                           |
| **Involvements** | `happening_involvements` table for this entity.                                                               |
| **History**      | Delta log filtered to this entity.                                                                            |

The tab name **Connections** is preferred over the older
"Relationships" — the latter reads as social bonds (friend / enemy /
romantic), which the deferred social-relationships graph
([`data-model.md → FactionState`](../../data-model.md#factionstate-shape)
notes inter-faction relationships folding into a deferred graph)
will eventually own. Connections is forward-compatible.

#### Why Settings is a separate tab

`status`, `injection_mode`, `retired_reason`, and `tags` are
entity-management chrome — operational configuration of the entity
record, not "who they are." Earlier drafts placed them as a
Lifecycle sub-section at the bottom of Identity; review found that
mixing them with description / visual / personality diluted the
Identity tab and pulled it back toward "the form" rather than
"who they are."

Settings stands alone. Same four fields for every kind. Sits
between Connections and Assets in the tab strip — close to the
entity-management concerns, before the content-attached tabs.

#### Why portrait lives only on Overview

Portrait is the entity's primary visual asset. Its canonical
display is the Overview glance card's top-right slot, with
drop-to-attach + click-to-pick-from-Assets affordances. Asset
management lives on the Assets tab. The Identity tab no longer
carries a `portrait` field-row — duplication served no one.

#### Routing fields to tabs

Tabs distribute fields by **semantic purpose**, not by JS shape.
The detail-pane component decides which fields render under which
tab; per-kind nuances are explicit.

For the character kind:

- **Overview** displays a glance composition derived from multiple
  fields (description prose, visual line, top traits / drives chips,
  current location, faction, carrying summary, tags, status pill,
  portrait). See per-kind composition in
  [`world.md → Tabs`](../screens/world/world.md#tabs--per-kind-composition).
- **Identity** edits `description` + Visual sub-section (`visual.*`)
  - Personality sub-section (`traits[]`, `drives[]`, `voice`).
    Pure identity content — no operational chrome.
- **Carrying** edits `stackables`, `equipped_items[]`,
  `inventory[]` together — the "what does this character carry"
  question lives in one place rather than splitting holder-side
  quantities (scalar) from item refs (entity-typed).
- **Connections** edits `current_location_id` (Positional),
  `faction_id` (Affiliation); displays `lastSeenAt` read-only
  (classifier-only per the
  [authorship contract](../../data-model.md#authorship-contract)).
- **Settings** edits `status`, `injection_mode`, `retired_reason`
  (conditional on status), `tags`. Same shape on every kind.

Per-kind Identity / Connections compositions for location, item,
faction live in
[`world.md`](../screens/world/world.md). Carrying is hidden on
those kinds; Settings applies to all.

### Why hand-written (not generated)

Schema-driven generation made sense when the data shape was
uncertain and the kind count might grow. Both no longer hold —
v1 schema is locked across exactly four kinds. The trade-off
flipped:

- **Generated UI is generic UI.** Auto-routing fields by JS shape
  (scalar → here, entity-ref → there, record → there) produces
  uniform `field-row` layouts that don't reflect how a user thinks
  about the content. Hand-written panes can compose the Visual
  sub-section as a rich card, render Personality side-by-side with
  Carrying inline, route operational chrome to its own Settings
  tab — none of which fights a generator.
- **Schema-side layout hints leak concerns.** Decorating the
  schema with UI-routing metadata mixes data definition and
  presentation. Hand-written panes keep the schema clean.
- **Drift risk is low at v1 scale.** Four kinds × locked schema =
  rare schema-vs-UI updates. TypeScript catches field-rename
  drift at compile time.

### `retired_reason` is conditional

Disabled when `status !== 'retired'`; enabled when it is. Lives
in the Settings tab.

---

## Entity editing — uses the save-session pattern

World-panel entity forms commit through the cross-cutting
[save-session pattern](./save-sessions.md). One session per detail
row; tab switching stays within session; Save commits all changes
as deltas under one `action_id`; Discard throws away; the
navigate-away guard intercepts dirty navigation. The peek drawer's
pencil edits are the documented quick-edit exception.

---

## Recently-classified row accent

Cross-cutting visual signal: rows whose underlying data was written
by the classifier (or any agent) in the last 1-2 turns get a faint
**info-blue background tint** that decays. Single signal with two
visual states:

- **Fresh** (full-color info-blue): touched in the last turn.
- **Fading** (faded info-blue): touched 1-2 turns ago.
- After that the tint is gone.

The two tiers are conceptual states — wireframe HTML happens to
encode them as `recent-1` / `recent-2` CSS classes, but that's a
rendering detail. Per-screen specs and prose refer to fresh /
fading by name.

**Where it applies:** any list-pane row whose source data the
classifier writes — entities and lore (World panel + Browse rail),
threads and happenings (Plot panel). Same tint, same color, same
decay rule across all panels.

**Channel separation.** Recently-classified owns the row background
tint; scene-presence owns the left-edge stripe (per
[Entity row indicators](#entity-row-indicators--four-orthogonal-channels)).
Both fire simultaneously on common cases (in-scene character just
classified) without contention — different primitives, different
signals. Color separation is also load-bearing: info-blue is
reserved for "recently written," other signals get their own
treatments.

**Detail-pane mirroring.** The tint is echoed in the detail head as
a "Recently classified" badge in the same color, visible while the
row is in the fresh or fading state and decaying alongside the row
tint. Self-documenting via visual repetition — open a row, see the
same signal echoed in text. No copy needed beyond the badge label.

**Implementation.** Computed runtime from the delta log; no schema
change. Decay rule is hardcoded for v1 (1-2 turns); revisit if users
want configurability.
