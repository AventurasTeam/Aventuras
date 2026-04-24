# World panel

**Wireframe:** [`world.html`](./world.html) — interactive

Dedicated full-screen surface for entities + lore management.
Master-detail pattern: filterable list on the left, single-row
detail on the right with tabs. The deep-edit workshop level of
the three-level entity surfacing (rail → peek → panel).

Most of the panel's behavior is governed by cross-cutting
principles in [principles.md](../../principles.md). Relevant sections:

- World / Plot split
- Entity row indicators (three channels)
- Entity kind indicators (icons)
- Entity list sort order (four-layer, lead pinned)
- Browse filter chips + accordion grouping
- Entity form UI generated from typed schema
- Entity editing — explicit save, session-based
- World panel — detail head structure
- World panel — History tab
- Bulk operations (deferred)
- Injection / retrieval rules (`injection_mode` field surfacing)

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
- **History** — delta log filtered to this entity. Search, op
  filter, sort, load-older.

## Open for per-kind composition

Location / item / faction Overview compositions are not drawn —
pending kind-specific state schema design (see [followups.md](../../../followups.md)).
Lore's composition is separate again (different table, different
fields — simpler than entities, more text-heavy).
