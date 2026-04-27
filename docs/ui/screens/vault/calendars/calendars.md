# Vault calendar editor

**Wireframe:** [`calendars.html`](./calendars.html) — interactive

The calendar editor is the first sub-wireframe of
[Vault](../../../README.md), the in-app library for non-story user
content (calendars, future packs / scenarios / character templates).
The broader Vault parent is deferred per
[`ui/README.md`](../../../README.md); this surface lands as a standalone
screen rendered inside a placeholder Vault frame.

Calendar definitions are spec'd in
[`calendar-systems/spec.md`](../../../../calendar-systems/spec.md);
storage in [`vault_calendars`](../../../../data-model.md#vault-content-storage).
This doc covers the editor's UI: list view, detail view, **L2 label
editing**, clone-from-built-in, JSON import, and delete safety. L3
from-scratch authoring is deferred.

**Vault is unreachable from inside an open story.** Reaching the
editor requires leaving the story, which cancels in-flight generation
and unloads story state from memory. Calendar edits committed here
are observed by stories on next load — no live propagation, no
mid-generation interaction.

## Cross-cutting principles

- [Settings architecture — split by location](../../../principles.md#settings-architecture--split-by-location)
  (Vault is neither App nor Story Settings — it's library content)
- [Save-session pattern](../../../patterns/save-sessions.md)
- [Icon-actions pattern](../../../patterns/icon-actions.md)
- [Form controls — Select primitive](../../../patterns/forms.md#select-primitive)
- [Raw JSON viewer](../../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
- [Aventuras file format (.avts)](../../../../data-model.md#aventuras-file-format-avts)
  (envelope spec for import/export)
- [Top-bar design rule — essentials vs discretionary](../../../principles.md#top-bar-design-rule--essentials-vs-discretionary)
- [Search bar scope](../../../patterns/lists.md#search-bar-scope)

## Layout — Vault home (Layer 0+1)

Two-pane layout combining Vault category list (Layer 0) with the
selected category's content (Layer 1). Selecting a different category
swaps the right pane.

```
┌─────────────────────────────────────────────────────────────────┐
│ [logo] Vault                                  [actions][⚙][←]   │
├─────────────────────────────────────────────────────────────────┤
│ Vault / Calendars                       [+ Add calendar ▾]      │
├─────────────────┬───────────────────────────────────────────────┤
│ CATEGORIES      │ Calendars                                     │
│ • Calendars (3) │  search                  [All][Built-in][Cus.]│
│ ○ Packs (defrd) │                                               │
│ ○ Scenarios     │  ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│ ○ Templates     │  │ ★ │ deflt│ │  ☆      │ │  ★      │          │
│                 │  │ Earth   │ │ Imp.Jpn │ │ Shire   │          │
│                 │  │ [b-in]  │ │ [custom]│ │ [custom]│          │
│                 │  │ y→m→d…  │ │ y→m→d…  │ │ y→m→d   │          │
│                 │  └─────────┘ └─────────┘ └─────────┘          │
└─────────────────┴───────────────────────────────────────────────┘
```

### Category list (left rail)

Narrow rail (~200px). Lists Vault content types with active-marker +
item count. Future content types (Packs / Scenarios / Templates)
render as **disabled placeholders** with a `deferred` annotation —
affordance for their future existence without committing to their
design. v1 ships only Calendars active.

### Content pane (right)

Card grid, 3-up at desktop width, responsive (wraps on narrower
viewports). Mirrors story-list's card pattern rather than a
single-column list — wide screens render denser.

**Toolbar** (top of content pane):

- **Search** — scopes to `name` only. Tooltip + ⓘ help icon per
  [search-bar-scope](../../../patterns/lists.md#search-bar-scope).
- **Filter chips** — single-select `All | Built-in | Custom`,
  mutually exclusive. `All` is default.

**Primary action** `+ Add calendar ▾` lives in the sub-header next
to the breadcrumb (full-canvas affords this; not a list-footer).
Three menu options:

- `Clone built-in…` — opens picker modal.
- `From JSON file…` — opens import modal (per
  [Aventuras file format](../../../../data-model.md#aventuras-file-format-avts)).
- `From scratch (deferred · L3)` — disabled placeholder.

### Calendar card

Text-first, monochrome until visual identity. Click body → drill to
Layer 2.

- **★ favorite star** — top-left. Clickable toggle (`★` filled /
  `☆` empty). Persists in `app_settings.favorite_calendar_ids`.
  Click doesn't drill.
- **`⭐ default` badge** — top-right, **only on the calendar matching
  `app_settings.default_calendar_id`**. **Read-only on this surface**
  (the source-of-truth lives in App Settings → Story Defaults).
  Tooltip: "Current default for new stories — change in App Settings
  → Story Defaults". Click deep-links to App Settings → Story
  Defaults with the calendar-default control scrolled into view.
- **Name** — calendar display name. No `(custom)` suffix; the
  type chip below is the sole type indicator. Two clones of the
  same built-in default to the same name and are distinguished by
  UUID; users can rename for clarity.
- **Type chip** — `built-in` / `custom`. The single source of
  type identification — never duplicated inline in the name.
- **Tier-shape line** — compact glyph chain (`y→m→d→h→m→s`), gives
  structural at-a-glance.
- **Era support** — `era: yes` / `era: no`.
- **Usage count** — `used by N stories` (count of stories whose
  `settings.calendarSystemId` references this calendar).

### Card sort order

Three tiers, in order:

1. **Default calendar** — pinned to the top-left of the grid
   regardless of favorite status.
2. **Favorited calendars** — alphabetical within tier.
3. **Non-favorited calendars** — alphabetical within tier.

Search and filter chips narrow the set; sort tiers still apply
within the filtered subset.

### Empty / sparse states

- **Single calendar** (just Earth built-in, no clones) — grid shows
  one card; `+ Add calendar ▾` is the discoverable affordance, no
  special copy.
- **Filter narrows to zero** — empty-state copy: "No custom
  calendars yet. Clone a built-in to start customizing."

## Layout — calendar detail (Layer 2)

Single full canvas, breadcrumb-driven back navigation. Drilling in
replaces the Vault home view; clicking a breadcrumb segment goes
back. No persistent rail at this level.

```
┌─────────────────────────────────────────────────────────────────┐
│ [logo] Vault                                  [actions][⚙][←]   │
├─────────────────────────────────────────────────────────────────┤
│ Vault / Calendars / Earth (Gregorian)                           │
├─────────────────────────────────────────────────────────────────┤
│ ┌── DETAIL HEAD ─────────────────────────────────────────────┐ │
│ ├── DEFINITION (read-only) ─────────────────────────────────┤ │
│ ├── LABELS (editable on custom; read-only on built-in) ────┤ │
│ ├── DISPLAY PREVIEW (live, interactive) ───────────────────┤ │
│ ├── SAVE BAR (when dirty) ─────────────────────────────────┤ │
│ └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Detail head

- **Kind strip** — `📅 Calendar` (small breadcrumb-strip element
  matching World panel's `☺ character` shape).
- **Name** — read-only on built-ins (no pencil); inline-editable
  with `✎` on custom.
- **Badge row** —
  - `built-in` / `custom` type chip.
  - `⭐ default` (read-only, only when this calendar is the app
    default; click deep-links to App Settings → Story Defaults).
  - `★ favorited` (clickable toggle — same data as the card star).
  - `Set as default →` text link, **only when calendar isn't the
    default**, deep-links to App Settings → Story Defaults with
    this calendar pre-picked. Convenience entry; does not fork the
    source-of-truth.
- **⋯ menu** — anchored to the head:
  - **View raw JSON** — opens shared raw-JSON drawer (read-only
    in v1).
  - **Export as JSON** — file save, produces `.avts` envelope per
    [Aventuras file format](../../../../data-model.md#aventuras-file-format-avts).
  - **Delete** (custom only; absent on built-ins).

### Built-in banner (built-ins only)

Renders below the detail head when viewing a built-in:

> ⓘ Built-in calendar. Clone to customize labels.
> `[Clone & edit]`

Clicking `[Clone & edit]` creates a new `vault_calendars` row
(fresh UUID, name = original preset name copied verbatim,
definition copied verbatim), navigates to the clone's detail, and
**auto-focuses the name input with text selected** — renaming is
the most-likely first edit since the chip already conveys the
type. No confirmation prompt; clone is non-destructive (deletable).

### Definition section (read-only)

Compact reference summary, **always read-only** even on custom
calendars in v1 — structural editing (tier shape, rollover rules,
`secondsPerBaseUnit`, `displayFormat`, era flipMode,
`leapDayPosition`) is L3 territory. The
`[Edit structure (deferred · L3)]` placeholder makes the L3 path
discoverable without enabling it.

Surfaces:

- Base unit + `secondsPerBaseUnit` (e.g., `second (1 second per
unit)`).
- Tier rollover chain (compact glyph chain).
- Sub-divisions list. Each entry names the sub-division and its
  parent tier — e.g., `weekday on day · 7-cycle, offset 4`. The
  parent tier disambiguates which tier owns the sub-division for
  calendars that attach sub-divisions to non-day tiers.
- Era support flags (`yes — display-label` / `no`).

### Labels section (the L2 editing surface)

The only editable surface in v1. Renders three blocks when
applicable:

- **Per-tier labels** — only tiers with `labels?: string[]` get a
  block. Earth: months. Shire: months. Mayan Long Count: none
  (block omitted; section renders an empty-state line if no labels
  exist anywhere).
- **Per-sub-division labels** — separate block per sub-division.
  Block heading names the sub-division and its parent tier
  (e.g., "Weekdays (7) · sub-division of day"). Weekday is the
  standard case.
- **Era preset names** — only renders when `eras !== null`.
  - **Presets** — dynamic list of `presetNames[]` with
    `[+ Add preset]` and `[×]` per row. Edit-rename of an existing
    name + add/remove for the canonical sequence.
  - **Default start** — dropdown sourced from `presetNames`
    (Select primitive in dropdown render mode at ≥4 entries; segment
    at ≤3, per the [Select-primitive cardinality rule](../../../patterns/forms.md#select-primitive)).
    The selected value writes to `defaultStartName`. Constrains
    `defaultStartName` to be one of `presetNames`; if a preset is
    removed and was the default, the default falls back to the
    first remaining preset. Empty `presetNames` blocks default
    selection — UI prompts "Add at least one preset to set the
    default start."

Label inputs are plain text fields, validated:

- Empty values rejected on save.
- Length cap at a reasonable max (~60 chars).

**Read-only on built-ins** — same layout, inputs render as plain
text without focus affordance.

### Display preview

Live and interactive — updates as the user edits labels in the
Labels section (so renaming "January" → "Janu" shows immediately in
the rendered string and tier breakdown).

- **Preview origin** — sourced from the calendar's `defaultOrigin`
  if present (PoC extension); otherwise tier `startValue` defaults.
  **Not user-editable in L2** — origin authoring is L3 territory.
  This is distinct from `stories.settings.worldTimeOrigin` (the
  per-story origin set in the wizard / Story Settings).
- **worldTime input** — direct numeric input (seconds) with four
  quick-walk buttons:
  - `+1d` = +86400
  - `+1w` = +604800
  - `+1mo` = +30·86400 (sentinel month)
  - `+1y` = +365·86400 (sentinel year)
- **Rendered output** — the calendar's `displayFormat` Liquid
  template applied to the derived tier-tuple. Reflects current
  (potentially dirty) form state, not saved state.
- **Tier breakdown** — derived tier-tuple values + sub-divisions
  (weekday). Useful for debugging template behavior.

### Save bar

Established visual per
[save-sessions.md → Save bar visual](../../../patterns/save-sessions.md#visual)
— warm yellow background, dirty-dot, `<b>N unsaved changes</b> —
<dirty fields list>` text. No surface-specific layout variants.

Calendar-specific addition: when `usage_count > 0`, a small `⚠`
icon appears at the end of the dirty-fields line with a tooltip:
"Saving propagates labels to N stories using this calendar."
Tooltip-only — keeps the established single-row layout. Per spec
the integer `worldTime` is preserved across edits, only display
reinterprets; saving is non-destructive, the icon is informational.

Navigate-away guard intercepts dirty navigation per the standard
pattern. No surface-specific exception (calendar edits don't qualify
for peek-style quick-edit).

## `+ Add calendar` flows

### Clone built-in

Click `+ Add calendar ▾ → Clone built-in…` opens a modal listing
the registered built-ins (merged from code + repo JSON):

```
┌── Clone built-in ──────────────────────────────────┐
│  📅 Earth (Gregorian)                               │
│     y→m→d→h→m→s · era support: yes (display-label) │
│                                                     │
│  (more built-ins as data commits — see              │
│   calendar-systems/spec.md → Presets to ship)       │
│                                                     │
│                                          [Cancel]   │
└─────────────────────────────────────────────────────┘
```

Click a row → creates the clone, closes modal, navigates to Layer
2 detail with name input auto-focused (text selected).

### From JSON file

Click `+ Add calendar ▾ → From JSON file…` opens an import modal:

```
┌── Import calendar ─────────────────────────────────┐
│  [📁 Choose .avts file…]                            │
│  — or —                                              │
│  [paste JSON envelope here ...]                     │
│  ⚠ <validation errors render here on failure>       │
│                                                     │
│                       [Cancel]   [Import]           │
└─────────────────────────────────────────────────────┘
```

**Validation** per
[Aventuras file format](../../../../data-model.md#aventuras-file-format-avts):

- `format` field must equal `"aventuras-calendar"`.
- `formatVersion` checked against import-supported versions.
- `calendar` object validates against `CalendarSystem` zod schema —
  failures surface field-level errors inline.

**ID handling** — the JSON's `id` is informational; on import, a
fresh UUID is always generated for the `vault_calendars` row.
Avoids collisions; round-trip exports get new local IDs (acceptable —
favorites and `default_calendar_id` are local preferences, not
portable content).

**Name collisions** — allowed. Two "Earth (Gregorian)" customs
differentiate by UUID; user can rename either.

**Success** — closes modal, navigates to Layer 2 detail of the
imported calendar (no auto-focus — the name's already what the
importer chose).

**Failure** — modal stays open, errors render inline. `[Import]`
disabled until input is provided.

### From scratch (deferred · L3)

Menu item rendered disabled with `(deferred · L3)` annotation.
Tooltip: "From-scratch authoring lands when L3 design pass ships."

## Delete safety

Available only on custom calendars (no `Delete` in the built-in ⋯
menu). Three paths:

**`usage_count > 0` — blocked.**

> "Imperial Japan (custom)" is in use by **2 stories**. Re-assign or
> remove those stories before deleting the calendar.

No "Open story list" deep-link in v1 — story-list filtering by
calendar is its own followup if real demand surfaces.

**Calendar is the current default — blocked.**

> "Imperial Japan (custom)" is the current default for new stories.
> Set a different default in _App Settings → Story Defaults_ before
> deleting.

**`usage_count == 0` and not default — confirmation, then delete.**

> This will permanently delete **"Imperial Japan (custom)"**. This
> action can't be undone.
>
> `[Cancel]` `[Delete]`

On confirm:

- `vault_calendars` row deleted.
- Calendar's id removed from `app_settings.favorite_calendar_ids`
  if present (cleanup).
- Navigation returns to Layer 0+1 with Calendars active.

## Favorite + default behavior

**Favorite** is user-managed library affordance. Toggle from the
card star OR the detail head badge — same data
(`app_settings.favorite_calendar_ids: string[]`). Doesn't open a
save-session (favorites aren't calendar-definition state). Sort
tiers (above) reflect favorite status.

**Default** is a single-id pointer in
`app_settings.default_calendar_id`. **Source-of-truth lives at App
Settings → Story Defaults**, not Vault. Vault surfaces a read-only
`⭐ default` badge for orientation + a `Set as default →` deep-link
on non-default calendars for convenience. Vault never mutates
`default_calendar_id` directly.

## Save session

Standard pattern per
[save-sessions.md](../../../patterns/save-sessions.md). One session per
detail row; navigating away while dirty triggers the global guard.

Edits propagate to every story referencing the calendar by id (per
[where calendar definitions live](../../../../calendar-systems/spec.md#where-calendar-definitions-live)).
Save bar's usage warning surfaces this contract.

## Vault entry point

**Deferred** — covered by the existing followup
[Vault parent shell](../../../../followups.md#vault-parent-shell). For
the wireframe, the back arrow returns to "wherever you came from"
without committing to a specific entry-point UI. The back-from-Vault
flow does not need to support returning to an open story (Vault is
unreachable from inside an open story; reaching Vault requires
leaving the story first).

## Screen-specific open questions

- **Display preview origin authoring on custom calendars** —
  currently L3 (alongside structural tier authoring). Could promote
  to L2 if real demand surfaces (a calendar author wants to set a
  sensible preview origin without picking up the full L3 surface).
  Defer until L3 design lands.
- **`Set as default →` deep-link entry route** — the App Settings →
  Story Defaults section needs an entry route accepting a calendar
  id to pre-pick. Folds into the
  [calendar picker followup](../../../../followups.md#calendar-picker--app-settings--story-settings--wizard).
- **Story-list filtering by calendar** — would let the
  "Cannot delete (in use)" copy include an actionable deep-link.
  Deferred until real demand surfaces.
