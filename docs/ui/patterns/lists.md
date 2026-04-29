# List patterns

Rendering rules for long lists and the search inputs that filter
them. Sister patterns to [`entity.md`](./entity.md) (entity-row
specifics that compose with these), [`forms.md`](./forms.md), and
[`data.md`](./data.md).

---

## Large lists — virtualization rule

Two patterns for rendering long lists, applied by shape. **No
traditional pagination** in either case — page-number navigation
doesn't fit interactive workspaces.

### Virtual list (windowing) — bounded-but-large catalogs

Render only visible rows + small overscan; swap rows in/out on
scroll. Smooth scrolling at any position; total count surfaces in
the footer.

Use when: total count is known, item shape is uniform (or per-row
height computable), user benefits from continuous scroll over the
full set, list size is the bottleneck.

Where it applies in v1:

- [App Settings · Profiles · "View all" model list](../screens/app-settings/app-settings.md#generation--providers)
  — OpenRouter 340+ entries
- Model picker dropdowns app-wide — popover-rendered, virtualized
  in flight
- Future Vault catalogs

### Load-older — log-shaped, unbounded lists

Append behavior. Recent items render first; **`Load older` button**
pulls the next chunk on explicit click. Never auto-loads on
scroll-to-bottom — looking at recent context shouldn't trigger
surprise loads of older content.

Use when: shape is log-like (event stream, history, deltas), no
meaningful total count, user reads recent and occasionally walks
back.

Where it applies in v1:

- [World panel · History tab](../screens/world/world.md#history-tab)
  — per-entity delta log
- Plot panel · History tab — per-thread / per-happening delta log
- Future global delta-log observability panel

### Threshold

Virtualization earns its weight at **>100 rows**. Below that, plain
rendering is simpler, accessibility-friendlier, and indistinguishable
to users. Lean toward not virtualizing until measurements warrant it.

### Library choice

Deferred to component implementation — `react-window` and
`@tanstack/react-virtual` are both mature options; React Native Web
compatibility needs verification. Tracked in
[`followups.md`](../../followups.md#virtual-list-library-choice).

---

## Search bar scope

Every search input in the app **must declare what it searches**.
"Search…" with no scope is ambiguous and quietly inconsistent across
surfaces. Per-screen docs name the scope inline; this section is the
cross-cutting summary plus the UX rule.

**UX rule:**

- **Placeholder text shows 1-2 most obvious fields**, truncation-safe
  under ~25 characters: `Search title, description…`. The full scope
  is rarely visible in placeholder real estate.
- **Tooltip on focus / hover** lists the full set of searched fields.
- **A small ⓘ help icon next to the input** opens the same scope
  list as a popover — discoverable on touch where hover doesn't fire.
  Belt + suspenders for cross-platform.

**SQLite mechanics.** SQLite ships JSON1 (built into expo-sqlite).
Search queries combine `LIKE` against typed text columns with
`json_extract` / `json_each` for JSON-stored fields (`tags`,
`entities.state` per-kind, `metadata`, `undo_payload`). For larger
stories, **FTS5** is the upgrade path (mirror searchable text into
an FTS virtual table, triggers keep it in sync). v1 stays on
LIKE + JSON-extract; revisit when a real story hits the wall.

**Per-surface scope** — each surface's per-screen doc carries the
authoritative version; this is the cross-cutting summary:

| Surface                 | Searches                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Story list              | `title`, `description`, `definition.genre.label`, `tags`, `author_notes`                                                                                |
| Reader Browse rail      | category-aware (entity: `name`/`description`/`tags`; lore: `title`/`body`/`category`/`tags`; thread/happening: `title`/`description`/`category`/`tags`) |
| World panel list        | category-aware (same as Browse rail equivalents)                                                                                                        |
| Plot panel — threads    | `title`, `description`, `category`, `tags`                                                                                                              |
| Plot panel — happenings | `title`, `description`, `category`, `tags`                                                                                                              |
| Vault calendars         | `name`                                                                                                                                                  |
| History tab (any panel) | structurally different — field-path strings, op (`create`/`update`/`delete`), rendered change-summary text                                              |

---

## Empty list / table state

Every filterable list pane and every detail-pane table surfaces a
**centered placeholder** when there are zero rows for the active
scope. Same contract across all shapes:

- **Title** — kind-specific, single sentence ("No threads on this
  branch yet.", "No characters on this branch yet.", "No
  involvements yet.").
- **Sub-text** — names the typical author of these rows. For
  classifier-written kinds: "The classifier writes most rows
  automatically as the story progresses. You can also add them
  manually with **+ New** below." For user-authored kinds:
  "Add one with **+ Add** below." For read-only tables (History):
  "Edits and rollbacks will appear here as they happen."
- **No CTA inside the placeholder.** The host surface already
  exposes the affordance (`+ New` footer, `+ Add involvement`
  button, etc.) — placeholder doesn't duplicate it. Keeps the
  empty state from competing with the toolbar.
- **Filter chips, search row, and table headers stay visible.**
  The empty result is per-scope, not per-surface — the user may
  flip the kind selector / filter / tab without leaving. Plot's
  threads empty doesn't mean Plot's happenings is empty; an
  entity's empty Involvements doesn't mean its History is empty.
- **Search-with-no-matches is distinct.** Empty-no-rows uses this
  pattern; empty-no-matches uses a "No results" line below the
  search row without hiding the rest of the toolbar.

**List-pane shape:** centered flex placeholder fills the list-pane
body when it would otherwise render zero rows. Toolbar above
stays. `+ New` footer below stays.

**Table shape (detail-pane tabs):** the placeholder lives inside
the table region — same title + sub-text — replacing the row
area while column headers and any toolbar above remain. Visually
this can be a single "empty" row spanning the table or a centered
block; pick whichever reads cleaner per surface.

**Where applied:**

- [Story list grid](../screens/story-list/story-list.md) —
  custom welcome variant (the screen IS the empty surface; gets
  its own onboarding-flavored copy + visual rather than the
  generic shape).
- [Reader · Browse rail](../screens/reader-composer/reader-composer.md#browse-rail--search-scope)
  — per-category list, same shape as a list pane.
- [World panel — list pane](../screens/world/world.md) +
  Involvements tab + History tab tables.
- [Plot panel — list pane](../screens/plot/plot.md) +
  Involvements / Awareness / History tab tables.
- [Vault calendars list](../screens/vault/calendars/calendars.md)
  - future Vault tables (packs, templates). Note: Vault calendars
    effectively can't reach this state in practice — built-in
    calendars are always present in the registry — but the surface
    documents the shape for symmetry with future Vault content
    types that have no built-ins.
- Future master-detail and table surfaces inherit by default.

### No-results state (search / filter narrowed to zero)

A separate state from "no rows exist." When the underlying scope
has rows but the active search query or filter chip excludes all
of them, render a **"No results" line** below the search/filter
controls **without hiding the toolbar**:

> No results. <small>Try clearing the search or another filter.</small>

Contract:

- **Toolbar stays visible.** Search input, filter chips, sort
  picker, ⓘ help, kind selector — all stay on screen so the user
  can edit the query that produced the empty result without
  leaving.
- **No CTA inside the placeholder.** Same rule as the empty
  state — the affordance to fix it (clear search / flip filter)
  is the toolbar itself.
- **Single-line copy by default.** Surfaces with bigger empty
  bodies (table tabs, list-pane bodies) can lift it to a centered
  paragraph if visual balance demands; surfaces where the input
  sits inline (Reader Browse rail) keep it tight.
- **Distinct from the empty state.** Empty = "no rows here yet"
  (typically with a "classifier writes most rows" sub-text);
  no-results = "your filter excluded everything." Don't conflate
  the two — the user response is different (wait vs. clear).

Applies anywhere the empty list/table pattern applies, plus all
search inputs across the app (App Settings model search, etc.).
