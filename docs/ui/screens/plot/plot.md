# Plot panel

**Wireframe:** [`plot.html`](./plot.html) — interactive

Dedicated full-screen surface for threads + happenings management.
Same master-detail shell as the World panel, but rendering
predominantly classifier-written data the user audits rather than
authors. The "monitor / audit" half of the
[World / Plot split](../../principles.md#world--plot-split--unified-panels-by-purpose).

Cross-cutting principles that govern this panel are in
[principles.md](../../principles.md). Relevant sections:

- [World / Plot split](../../principles.md#world--plot-split--unified-panels-by-purpose)
- [Top-bar design rule](../../principles.md#top-bar-design-rule)
- [Entity detail-pane composition](../../patterns/entity.md#entity-detail-pane-composition)
- [Save-session pattern](../../patterns/save-sessions.md)
- [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  (thread / happening detail-pane edits and save bars disable while
  a generation pipeline is in flight)
- [Bulk operations — deferred](../../principles.md#bulk-operations--deferred)
- [Injection / retrieval rules](../../principles.md#injection--retrieval-rules-for-prompt-context)
  (`injection_mode` on threads)

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [logo] <title> / Plot           [status]   [actions][⛭][←]  │ ← top bar
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ ← chapter token-progress strip
├─────────────────────────────────────────────────────────────┤
│ Threads / Crown's bargain                                    │ ← sub-header (in-pane selection)
├─────────────────────┬───────────────────────────────────────┤
│ LIST PANE (~340px)  │ DETAIL PANE                           │
│                     │                                       │
│ [ Threads | Happ. ] │ breadcrumb: ◇ thread                  │
│ search              │ Name: Crown's bargain ✎         [⋯]  │
│ filter chips        │ ─────                                 │
│                     │ tabs: Overview | History              │
│ list (rows)         │                                       │
│                     │ (selected tab content, scrolls)       │
│                     │                                       │
│                     │ ───                                   │
│                     │ save bar (when dirty)                 │
│ + New thread        │   N unsaved · [discard] [save ⌘S]     │
└─────────────────────┴───────────────────────────────────────┘
```

Top-level segment toggle `[ Threads | Happenings ]` drives both the
list pane and the detail pane composition. Two ledgers under one
roof; the user is doing one task at a time, switching is a navigation
gesture.

## Implementation reuse

Plot reuses the master-detail components established by the World
panel:

- `MasterDetailShell` — top bar, list pane, detail pane, save bar
- `ListPane` — search, filter chips, scrollable rows (row rendering
  composable per kind)
- `DetailPane` — breadcrumb, name + ⋯ menu, tab strip, scrollable
  content
- `SaveBar` — dirty-only footer (Cmd/Ctrl-S)
- Form generation — zod-driven typed forms, same pattern as World

What changes per panel: the **kind selector control** (World uses a
dropdown for 5+ categories; Plot uses a segment toggle for 2), the
**row rendering** (different shapes per data type), the **detail tab
composition** (different fields surface), and the **filter / sort
rules** (different lifecycle states).

Captured here as architectural intent — the wireframe necessarily
shows the visual surface, but implementation should land as shared
shell + per-panel slot fills, not duplicated screens.

## Threads side

Narrative arcs and overarching plot pressures. Predominantly
classifier-tracked; user audits status, edits descriptions, manually
creates if needed.

**Row composition.** kind glyph + title + status badge + category
label.

**Sort.** Status tier (Active → Pending → Resolved → Failed), then
alphabetical within a tier.

**Filter chips** (single-select). All / Active / Pending / Resolved /
Failed.

**All view — accordion grouping by status tier.** Same pattern as
World's accordion (per
[patterns → Accordion grouping](../../patterns/entity.md#accordion-grouping-on-all-view)),
different grouping key. Groups: Active (default expanded), Pending,
Resolved, Failed (all collapsed by default). Picking a non-All filter
flattens to that single tier.

**Search.** Scope: `title`, `description`, `category`, `tags`.
Affordances per the
[search-bar-scope pattern](../../patterns/lists.md#search-bar-scope).

**Detail tabs:**

- **Overview** — status, category, icon, description,
  `injection_mode` dropdown, `triggered_at_entry` (read-only entry
  ref), `resolved_at_entry` (read-only entry ref, only when status is
  resolved/failed), tags.
- **History** — delta log filtered to this thread; structured search
  over field-path / op / change-summary text per
  [patterns → Search bar scope](../../patterns/lists.md#search-bar-scope).
  Same shape as World's History tab; uses the
  [load-older pattern](../../patterns/lists.md#load-older--log-shaped-unbounded-lists),
  not virtualization.

No Involvements tab — threads aren't directly entity-linked in the
schema.

## Happenings side

Atomic units of "what occurred / exists as a knowable fact." Includes
in-narrative events, pre-story history, scheduled futures, and
ambient backdrop. Awareness links connect to characters who know
about each happening.

**Row composition.** kind glyph + title + when-marker (entry chip OR
`temporal` string) + category label + common-knowledge icon (⊙ when
set; placeholder slot kept when unset so the row layout stays
identical).

**Sort.** Chronological — `occurred_at_entry` DESC first;
`temporal`-only rows pinned at the bottom in their own block.

**Filter chips** (single-select). All / This chapter / Common
knowledge / Out-of-narrative.

`This chapter` filters to happenings whose `occurred_at_entry` falls
within the currently-open chapter's range. `Out-of-narrative` filters
to rows with `temporal` set (and null `occurred_at_entry`).

**All view — accordion grouping by chapter bucket.** Same accordion
pattern as World, different grouping key. Buckets:
**Current chapter** (default expanded), **Earlier chapters**
(collapsed; chapter-numbered sub-grouping deferred — flat list
within for v1), **Out of narrative** (collapsed; rows with `temporal`
set). Picking a non-All filter flattens to just the matching subset.

**Search.** Scope: `title`, `description`, `category`, `tags`.
Affordances per the
[search-bar-scope pattern](../../patterns/lists.md#search-bar-scope).

**Detail tabs:**

- **Overview** — title, description, category, icon, common-knowledge
  toggle, time anchor (mutually exclusive form — entry-ref picker OR
  `temporal` string field; both the SQLite CHECK constraint and the
  Zod schema at the form/import boundary enforce that only one is
  set), tags.
- **Involvements** — `happening_involvements` rows: entity picker
  (kind-aware, character / location / item / faction) + role
  (free-form text). Add / remove rows.
- **Awareness** — `happening_awareness` rows: character picker (kind
  = character only) + `learned_at_entry` (entry-ref picker) +
  `salience` (0-1 numeric) + `source` (free-form text descriptor).
  Add / remove rows.
- **History** — delta log filtered to this happening.

**Common-knowledge interaction with Awareness tab.** When the
`common_knowledge` toggle on Overview is on, the Awareness tab body
becomes a notice ("Common knowledge — every character is aware of
this; per-character awareness rows are skipped") with no add
affordance. Matches the schema invariant that common-knowledge
happenings skip awareness rows.

Toggling common-knowledge off re-enables the Awareness tab as a
normal editor; existing awareness rows (if any survived) reappear.

## Row indicators

Three signals on each row, each with a dedicated channel:

- **Left-edge accent — recently classified.** Cross-cutting pattern;
  see [patterns → Recently-classified row accent](../../patterns/entity.md#recently-classified-row-accent).
  Applies to threads and happenings here, also to entities and lore on
  the World panel.
- **Right-side common-knowledge icon (happenings only) — ⊙.** Same
  glyph as the toggle in the detail Overview tab; on/off state
  mirrors the toggle. Placeholder slot kept on rows where CK is off
  so layout stays identical row-to-row.
- **Right-side status pill (threads only).** Lifecycle status with
  per-tier coloring — Active / Pending / Resolved / Failed.

### Self-documenting via the detail pane

Each indicator is mirrored in the detail pane so users learn the
mapping by clicking around, not by reading docs:

- **Recently-classified accent on the row → `Recently classified`
  badge in the detail head** — sits inline next to the breadcrumb
  /name row, per
  [patterns → Recently-classified row accent](../../patterns/entity.md#recently-classified-row-accent).
  Same shape as
  [World panel's detail-head badge](../world/world.md#detail-head-structure).
- **Common-knowledge ⊙ on the row → ⊙ icon next to the toggle on
  Overview**. Same glyph, same on/off behavior. Toggling the detail
  flips the row icon at the same time.
- **Status pill on the row → status field on Overview**. Already the
  same wording.

Gives the Plot panel an "audit" feel without adding a full debug
surface — at-a-glance the user sees what the classifier just wrote,
and clicking through teaches them what each marker means.

The deeper observability surface (global delta log browser, filters
by source / target_table / action_id) is its own panel; see
[`followups.md`](../../../followups.md).

## Manual creation + per-row import

`+ New thread` and `+ New happening` affordances live at the
list-pane footer, **visually de-emphasized** (smaller text, lower
contrast) — manual creation is uncommon since most rows are
classifier-authored, but it's a real use case (user authoring a
backstory thread, manually marking an off-screen happening).

Each follows the standard
[import-counterparts pattern](../../patterns/data.md#import-counterparts--file-based--vault)
(Blank / From JSON file… / From Vault…). Zod schema constraints
gate both manual entry and JSON imports — no happening with both
`occurred_at_entry` and `temporal` set, no thread without status,
etc. — surfaced as inline validation rather than partial-save.

## Detail pane — raw JSON viewer

The `⋯ → View raw JSON` action opens the shared
[Raw JSON viewer](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
drawer. Plot-specific deviation: for happenings the JSON includes
the row + its involvements + awareness summary inline; for threads
just the row.

## Save session

Standard [save-session pattern](../../patterns/save-sessions.md).
Session boundary: the entire detail pane (any tab, any field).

## Top-bar

Standard in-story chrome per
[principles → Top-bar design rule](../../principles.md#top-bar-design-rule).
Breadcrumb: `<story-title> / Plot`. The
[master-detail sub-header](../../principles.md#master-detail-sub-header)
below the top bar carries the in-pane selection
`[Threads|Happenings] / <selected name>`, updating as the user
clicks list rows.

## Mobile expression

Phone forces master-detail collapse: list-first, detail as a
full-screen route within the Plot surface, back returns to list.
Tablet inherits the desktop 2-pane layout. Detail-pane tab nav
reroutes through the Select primitive on phone (and on tablet for
kinds whose tab strip would overflow); the top-level Threads /
Happenings segment toggle and the kind-specific filter chips
inherit unchanged.

- **Master-detail collapse on phone** per
  [`mobile/collapse.md → Plot`](../../foundations/mobile/collapse.md#plot--thread--happening-list--detail).
  Same shape as World: list visible by default, row tap navigates
  to detail as a full-screen route, back-on-left returns to list.
  The master-detail sub-header (`Threads / Crown's bargain` or
  `Happenings / The summons`) sits below the phone top bar at the
  route level.
- **Top-bar shape on phone** per
  [`mobile/navigation.md → Phone`](../../foundations/mobile/navigation.md#phone--640-px):
  slim single-row `[←] [<title> / Plot] [pill] [⛭] [⚲]`. List
  state breadcrumb is `<title> / Plot`; detail-route extends to
  `<title> / Plot / <Threads|Happenings>`.
- **Threads / Happenings segment toggle** sits at the top of the
  list pane and uses the Select primitive's segment render mode at
  every tier — 2-cell stretch via `flex: 1 1 0` per the
  Group A wizard fix. Drives both list-pane content and detail-pane
  tab composition; switching with a dirty detail fires the
  navigate-away guard.
- **Detail-pane tab navigation reroutes on narrow widths.** Threads
  (2 tabs: Overview / History) → Tab strip on desktop and tablet,
  Select segment on phone (the cascade hits segment mode at 2 ≤ 2
  mobile cardinality cutoff per
  [`patterns/forms.md → Select primitive`](../../patterns/forms.md#select-primitive)).
  Happenings (4 tabs: Overview / Involvements / Awareness / History)
  → Tab strip on desktop, Select dropdown on tablet and phone (4 > 3,
  the tablet cardinality cutoff — wireframe review showed Involvements
  / Awareness count chips wrapping vertically at iPad portrait detail
  pane width). The
  consumer's decision is binary (Tab strip vs Select primitive);
  Select's cascade picks segment vs dropdown.
- **List-pane filter chips** (Threads: All / Active / Pending /
  Resolved / Failed; Happenings: All / This chapter / Common
  knowledge / Out-of-narrative) wrap as needed on phone via the
  existing `flex-wrap` rule.
- **Common-knowledge interaction.** Toggling `common_knowledge` on
  Overview makes the Awareness tab body a notice ("Common knowledge
  — every character is aware of this"); same content shape on every
  tier. On phone the tab switch goes through the Select dropdown,
  but the notice and add-affordance behavior is identical to
  desktop.
- **Per-row indicators** (recently-classified left-edge accent,
  common-knowledge ⊙ icon, status pill on threads) all stay
  always-visible per
  [`patterns/icon-actions.md`](../../patterns/icon-actions.md);
  unchanged on phone.
- **History tab controls reflow on narrow widths** identically to
  World — search input takes its own full-width row first;
  filter and sort chips wrap beneath. Same `flex-wrap` rule on
  `.history-controls` per
  [the World mobile expression](../world/world.md#mobile-expression).
- **Detail-head overflow menu (`⋯`)** binds to Popover on desktop /
  tablet, Sheet (short) on phone per
  [`mobile/layout.md → Surface bindings`](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
  Save bar, raw JSON viewer, and stack-aware Return inherit the
  same shape as the
  [World panel's mobile expression](../world/world.md#mobile-expression);
  no Plot-specific deviation.
- **Phone landscape** (~700–900 px) lands in tablet tier per the
  [responsive contract](../../foundations/mobile/responsive.md);
  2-pane cramped but usable, tab-strip overflow rule applies per
  the tablet column.

## Screen-specific open questions

- **Recently-classified decay rule** — currently "fades over 1-2
  turns." Worth making configurable (`stories.settings.recentlyClassifiedTurns`),
  or hardcode 2? Lean: hardcode 2 for v1, revisit if users want more.
- **Visual icon set for thread / happening categories** — placeholder
  glyphs only; finalize with the visual identity session.
- **Entry-ref picker UX** — picking a `triggered_at_entry`,
  `resolved_at_entry`, `occurred_at_entry`, or `learned_at_entry`
  needs a picker. Inline mini-list of recent entries? Searchable
  popover keyed on entry content? Deferred — same pattern likely
  reused across other entry-ref fields.
- **Awareness `salience` UI** — numeric 0-1 input, slider, or stepped
  preset (low / medium / high)? Defer to typed-state design pass.
- **Empty states** — list pane uses the cross-cutting
  [empty list-pane state pattern](../../patterns/lists.md#empty-list--table-state).
  Per-kind shape: "No threads on this branch yet." / "No
  happenings on this branch yet." plus the classifier-writes-rows
  explainer and a pointer at the existing `+ New` footer
  affordance.
