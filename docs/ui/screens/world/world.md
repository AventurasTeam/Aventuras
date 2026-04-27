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
- [Entity form UI generated from typed schema](../../patterns/entity.md#entity-form-ui-is-generated-from-the-typed-schema)
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

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│ [logo] <title> · Chapter                   [actions][⚙][←]  │ ← top bar (app chrome)
├─────────────────────────────────────────────────────────────┤
│ World / Characters / Kael                                    │ ← sub-header
├─────────────────────┬───────────────────────────────────────┤
│ LIST PANE (~340px)  │ DETAIL PANE                           │
│                     │                                       │
│ [Characters ▾]      │ breadcrumb: ☺ character               │
│ search              │ Name: Kael ✎                    [⋯]  │
│ filter chips        │ ─────                                 │
│                     │ tabs: Overview | Rel | Assets |       │
│ list (accordion     │       Involvements | History          │
│ on All filter)      │                                       │
│                     │ (selected tab content, scrolls)       │
│                     │                                       │
│                     │ ───                                   │
│                     │ save bar (when dirty)                 │
│                     │   N unsaved · [discard] [save ⌘S]     │
│ + New entity        │                                       │
└─────────────────────┴───────────────────────────────────────┘
```

## Detail head structure

Status selector is NOT chrome on the detail head; it's a typed form
field inside the Overview tab. The detail head carries only:

- A small breadcrumb strip: kind-icon + kind-name
- The entity name (inline-editable with pencil)
- An overflow menu (⋯) anchored to the name row

The overflow menu holds rare-but-important actions:

- **Set as lead** (sets `stories.settings.leadEntityId`)
- **Export entity as JSON** (single-entity export)
- **View raw JSON** (debug/dev affordance)
- **Delete entity** (destructive; needs confirmation pass)

Raw JSON lives here (not as a prominent link) because it's
power-user/debug territory. One consistent pattern: ⋯ menus are where
"extra / rare" item-scoped actions live on any per-item surface.

## Tabs (character kind)

- **Overview** — scalar/enum fields from `entities` + `CharacterState`:
  status, injection_mode, description, disposition, condition,
  retired_reason (conditional), tags, portrait.
- **Relationships** — all entity-to-entity ID fields from
  `CharacterState`, grouped by semantic label (Positional /
  Possession / Affiliation).
- **Assets** — attached images / audio / files via `entry_assets`.
  Drop upload, pick from gallery, remove.
- **Involvements** — `happening_involvements` table for this entity.
  Rows link to happenings.
- **History** — delta log filtered to this entity. See History tab
  detail below.

## List pane — search scope

The list pane's search input is **category-aware** — scope changes
with the active category dropdown:

- **Characters / locations / items / factions** (entity rows):
  `name`, `description`, `tags`
- **Lore**: `title`, `body`, `category`, `tags`

SQLite-side: `LIKE` against typed columns + `json_each` over the
JSON `tags` array. Placeholder + tooltip + ⓘ help icon per
[principles → Search bar scope](../../patterns/lists.md#search-bar-scope).

## Detail pane — raw JSON viewer

The `⋯ → View raw JSON` action opens the shared right-anchored
drawer (read-only in v1, copy-button, edit-mode deferred). Same
pattern as Plot panel and story-list. Cross-cutting spec in
[principles → Raw JSON viewer](../../patterns/data.md#raw-json-viewer--shared-modal-pattern).

## Per-row import

The list-pane footer's `+ New entity` opens a small menu:

- **Blank** — empty form, create mode (current behavior).
- **From JSON file…** — file picker; pasted/picked JSON validated
  against the kind's zod schema before creating. Mismatch fails with
  a friendly error.
- **From Vault…** — disabled placeholder until Vault lands.

See [principles → Import counterparts](../../patterns/data.md#import-counterparts--file-based--vault).

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
- **Load-older chunking** — no page numbers, log-shaped data. Per
  [principles → Large lists](../../patterns/lists.md#large-lists--virtualization-rule),
  history uses the load-older pattern (explicit button) rather than
  virtualization, since the user's working context is "recent" and
  surprise auto-loads of older content would be jarring.

Involvements table gets the same load-older pattern eventually; list
pane is fine unpaginated for normal stories (filter chips + search
handle it).

## Open for per-kind composition

Location / item / faction Overview compositions are not drawn —
pending kind-specific state schema design (see
[followups.md](../../../followups.md)). Lore's composition is
separate again (different table, different fields — simpler than
entities, more text-heavy).
