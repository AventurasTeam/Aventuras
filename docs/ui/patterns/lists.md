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
| Story list              | `title`, `description`, `genre`, `tags`, `author_notes`                                                                                                 |
| Reader Browse rail      | category-aware (entity: `name`/`description`/`tags`; lore: `title`/`body`/`category`/`tags`; thread/happening: `title`/`description`/`category`/`tags`) |
| World panel list        | category-aware (same as Browse rail equivalents)                                                                                                        |
| Plot panel — threads    | `title`, `description`, `category`, `tags`                                                                                                              |
| Plot panel — happenings | `title`, `description`, `category`, `tags`                                                                                                              |
| Vault calendars         | `name`                                                                                                                                                  |
| History tab (any panel) | structurally different — field-path strings, op (`create`/`update`/`delete`), rendered change-summary text                                              |

---

## Empty list-pane state

Every filterable list / table surfaces a **centered placeholder**
when the active kind has zero rows on the active branch. Common
shape across all such surfaces:

- **Title** — kind-specific, single sentence ("No threads on this
  branch yet.", "No characters on this branch yet.").
- **Sub-text** — names the typical author of these rows. For
  classifier-written kinds: "The classifier writes most rows
  automatically as the story progresses. You can also add them
  manually with **+ New** below." For purely user-authored kinds:
  "Add one with **+ New** below."
- **No CTA inside the placeholder.** The existing `+ New` footer
  affordance is the call-to-action; placeholder doesn't duplicate
  it. Keeps the empty state from competing with the toolbar.
- **Filter chips and search row stay visible.** The empty result
  is per-kind, not per-surface — the user may flip the kind
  selector or filter without leaving the screen. (Plot's threads
  empty doesn't mean Plot's happenings is empty.)
- **Search-with-no-matches is distinct.** Empty-no-rows uses this
  pattern; empty-no-matches uses a "No results" line below the
  search row without hiding the rest of the toolbar.

**Where applied:**

- [Plot panel — threads + happenings list pane](../screens/plot/plot.md)
- [World panel — entity / lore list pane](../screens/world/world.md)
- Vault tables (calendars list, future packs / templates lists)
- Future master-detail and table surfaces inherit by default.
