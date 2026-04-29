# Entity row patterns

Row-shaped UI patterns shared across the reader's Browse rail, the
World panel's list pane, and (for the recently-classified accent
specifically) the Plot panel's list panes. Sister patterns to
[`save-sessions.md`](./save-sessions.md) (the edit-commit pattern
entity forms ride), [`forms.md`](./forms.md),
[`lists.md`](./lists.md), and [`data.md`](./data.md).

Anchors here are the canonical URL for these patterns — per-screen
docs link in.

---

## Entity surfacing — three levels, same data

Same entity, three depths of UI:

1. **Browse rail** (reader right rail, ~300px) — list only, filter
   chips, scene indicator. Fast glance + row click.
2. **Peek drawer** (reader overlay, ~440px) — summary + quick edits
   (pencil icons on text fields). Opens on row click; Esc or × closes.
3. **World panel** (dedicated full-screen surface) — master-detail
   workshop. Left pane = filterable list. Right pane = single-entity
   detail with **five tabs**: Overview / Relationships / Assets /
   Involvements / History.

Peek drawer's footer link "Open in World panel →" routes to the panel.

---

## Entity kind indicators — icons, not text

Entity kind renders as a **square glyph icon** (22×22 box), not text.
Saves horizontal room in narrow rails; still categorical at a glance.

Wireframe placeholder glyphs (real icons land with visual identity):

| Kind      | Glyph |
| --------- | ----- |
| character | ☺     |
| location  | ⌂     |
| item      | ◆     |
| faction   | ⚑     |

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

## Entity form UI is generated from the typed schema

`entities.state` is a typed discriminated union (CharacterState /
LocationState / ItemState / FactionState) — not a dynamic bag. This
has a direct UI consequence:

- **No generic key/value editor.** Form fields are generated from the
  Zod schema (already in the stack). One schema drives form controls,
  validation, types — all from the same source.
- **No "+ add field" UI.** You can't add fields to a typed shape.
- **Fields distribute deterministically by shape:**
  - **Scalar / primitive fields** → **Overview tab** as typed
    controls (text inputs, chip-list editors, prose textareas). For
    character, this means the `visual.*` sub-fields, `traits[]`,
    `drives[]`, and `voice` per the
    [`CharacterState` shape](../../data-model.md#characterstate-shape).
  - **Entity-to-entity ID fields** → **Relationships tab** as
    picker-backed inputs. Grouped by semantic label — for character,
    `current_location_id` (Positional), `equipped_items[]` +
    `inventory[]` (Possession), `faction_id` (Affiliation). Different
    groups for other kinds (locations have `parent_location_id` as
    Compositional; items have `at_location_id` as Positional).
  - **Holder-side quantity records** (`stackables: Record<string,
number>` on character) → **Overview tab** as a key-quantity panel,
    distinct from the `inventory[]` chip list. UI labels emphasize
    the holder-level framing ("Carried quantities — tracked on the
    character, not on container items").
- **Overview composition is per-kind.** Character / Location / Item /
  Faction each define their own Overview section driven by their
  typed state. Some shared fields (description, tags, retired_reason,
  portrait) anchor the pattern.
- **`retired_reason` is conditional** — disabled when
  `status !== 'retired'`, enabled when it is.
- **Raw JSON view** remains as a small power-user/debug affordance
  (overflow menu next to entity name), for export and troubleshooting.

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
a "Recently classified" badge in the same color (faded variant for
the older state). Self-documenting via visual repetition — open a
row, see the same signal echoed in text. No copy needed beyond the
badge label.

**Implementation.** Computed runtime from the delta log; no schema
change. Decay rule is hardcoded for v1 (1-2 turns); revisit if users
want configurability.
