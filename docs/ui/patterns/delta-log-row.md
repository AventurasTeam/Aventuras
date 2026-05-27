# DeltaLogRow pattern

History-tab row across World, Plot, and the future global
delta-log surface. Renders one entry from the `deltas` table
(schema in
[data-model.md → Diagram](../../data-model.md#diagram); semantics
in
[Entry mutability & rollback](../../data-model.md#entry-mutability--rollback))
— op, target,
field path (when applicable), pre-rendered diff summary, source,
entry link, and timestamp. Read-only by design; rollback lives
in the reader's per-entry path.

Sister patterns:

- [`lists.md`](./lists.md) — the host's history-tab list uses
  the load-older pattern (explicit button, log-shaped data).
- [`toolbar.md`](./toolbar.md) — the history tab's chrome
  (search, op-filter chips, sort) follows this pattern.

Used by:

- [World — history tab](../screens/world/world.md#history-tab) —
  delta log filtered to one entity (or branch-scoped view).
- [Plot — history tab](../screens/plot/plot.md#mobile-expression) —
  delta log filtered to threads and happenings.
- [Diagnostics Hub · Delta log tab](../screens/diagnostics/diagnostics.md#tab-5--delta-log)
  — story-scoped (branch-scoped by default), unscoped across rows.
  First consumer adopting the table-type `targetDisplayName`
  prefixing variant (`Entity · Kael`, `Thread · Iron Pact`, etc.);
  host wires `onPress` to open the [Raw JSON viewer Sheet](./data.md#raw-json-viewer--shared-modal-pattern)
  with the row's `undo_payload`, diverging from World/Plot's
  open-in-detail-pane wiring.

## Compound API

```ts
type DeltaLogRowProps = {
  delta: {
    id: string
    op: 'create' | 'update' | 'delete'
    source: 'ai_classifier' | 'user_edit' | 'lore_agent' | 'chapter_close'
    targetTable: string // host's resolution call; compound uses it as fallback label only
    targetDisplayName: string // pre-resolved by host
    fieldPath: string | null // op=update: "state.traits[2]"; op=create/delete: null
    summary: string // pre-rendered diff prose, host-formatted
    entryId: string | null // null for non-entry-triggered events
    createdAtRelative: string // pre-formatted "2h ago" / "12 Apr 14:33"
    actionId: string // included for future grouping cue; v1 renders flat
  }
  onPress?: () => void // host wires navigation
  className?: string
}
```

The compound takes **pre-formatted display strings** opaque —
same contract as
[`EntryCard`'s `worldTimeLabel`](./entry-card.md#world-time-footer)
and
[`StoryCard`'s `chapterLabel` / `lastOpenedRelative`](./story-card.md#compound-api).
Per-target resolution (querying the target table for a display
name) and diff humanization (translating `undo_payload` JSON to
prose) live in the host where the domain knowledge already
lives.

## Visual shape

```
┌──────────────────────────────────────────────────┐
│ [● update]  Kael · state.traits                   │
│ Added "former soldier"; was ["brave", "loyal"]    │
│ classifier · entry #47 · 2h ago                   │
└──────────────────────────────────────────────────┘
```

### Op badge

Left-anchored, ~10-12 px dot or short pill. Color-keyed:

| op       | Color slot                   |
| -------- | ---------------------------- |
| `create` | `bg-success text-success-fg` |
| `update` | `bg-accent text-accent-fg`   |
| `delete` | `bg-danger text-danger-fg`   |

The op label renders inside the badge at `text-xs font-medium`.

### Target line

`<targetDisplayName>` in `font-medium`, with `·` separator and
`<fieldPath>` muted when present. Long target names or field
paths truncate inline with ellipsis.

The host encodes table type into `targetDisplayName` when needed
— e.g., "Kael" implies entity in a per-entity History tab; for
the cross-cutting global surface, the host can supply
"Entity · Kael" or "Thread · Iron Pact" prefixed strings.

### Summary

The host's pre-rendered diff prose. 2-line ellipsis bound.
Host owns rendering — for an entity update, this humanizes the
`undo_payload` JSON; for create / delete, this can be a one-liner
(`Created`, `Deleted`).

For `op=update` rows, the `(old, new)` pair needed to form the
diff prose comes from the in-memory
[delta diff cache](../../architecture.md#delta-history-diff-resolution).
On cache miss, the host falls back to a summary derived from
`undo_payload` keys alone (e.g., `Modified traits, drives`) and
upgrades to the rich prose on populate. The pattern's
`summary: string` contract stays unchanged in either state.
`op=create` and `op=delete` never go through the cache.

### Meta line

Muted foreground (`text-fg-muted text-xs`), middle-dot separators:

- **Source label** — compound owns the enum → label mapping:
  - `ai_classifier` → `classifier`
  - `user_edit` → `user`
  - `lore_agent` → `lore agent`
  - `chapter_close` → `chapter close`
- **Entry link** — `entry #<n>` when `entryId` non-null; omitted
  when null. Host supplies the pre-formatted "entry #47" via the
  entry's position.
- **Time** — `createdAtRelative` opaque.

## Click behavior

`onPress?: () => void` — host wires what tap does:

- Entity / lore / thread / happening target → open in respective
  detail pane.
- `entryId` set → optionally navigate to the entry in reader.
- Compound just emits the press; routing is host concern.

When `onPress` is undefined, the row is non-interactive (no
hover, no press affordance).

## Storybook (DeltaLogRow)

Live demos: each op color (create / update / delete), each
source label, with-and-without `entryId`, with-and-without
`fieldPath`, very long target name (truncation), very long
summary (2-line ellipsis), non-interactive variant
(`onPress` undefined). Belongs in
`Patterns/History/DeltaLogRow` when component implementation
begins.

## What this design defers

- **Action grouping (`action_id`).** v1 renders one row per
  delta; clustering deltas that share an action (e.g.,
  chapter-close producing many state mutations) is a future
  affordance. The data is present; the rendering is not.
- **Inline diff expansion.** v1 truncates summary to 2 lines;
  full-detail expansion via the
  [JSONViewer pattern](./data.md#raw-json-viewer--shared-modal-pattern)
  showing the raw `undo_payload` is a future enhancement.
- **Bulk rollback affordances** — history is read-only in v1;
  rollback lives in the reader's per-entry path.
