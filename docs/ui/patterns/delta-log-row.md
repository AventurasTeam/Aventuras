# DeltaLogRow pattern

History-tab row across World, Plot, and the future global
delta-log surface. Renders one entry from the `deltas` table
(schema in
[data-model.md → Diagram](../../data-model.md#diagram); semantics
in
[Entry mutability & rollback](../../data-model.md#entry-mutability--rollback))
— op, target,
field path (when applicable), pre-rendered diff summary, source,
entry ref, and timestamp. Read-only by design.

Sister patterns:

- [`lists.md`](./lists.md) — the host's history-tab list uses
  the load-older pattern (explicit button, log-shaped data).
- [`toolbar.md`](./toolbar.md) — the history tab's chrome
  (search, op-filter chips, sort) follows this pattern.

Used by:

- [World — history tab](../screens/world/world.md#history-tab) —
  delta log filtered to one entity.
- [Plot — history tab](../screens/plot/plot.md#mobile-expression) —
  delta log filtered to threads and happenings.
- [Diagnostics Hub · Delta log tab](../screens/diagnostics/diagnostics.md#tab-5--delta-log)
  — story-scoped (branch-scoped by default), unscoped across rows.
  First consumer adopting the table-type `targetDisplayName`
  prefixing variant (`Entity · Kael`, `Thread · Iron Pact`, etc.);
  host wires `onPress` to open the [Raw JSON viewer Sheet](./data.md#raw-json-viewer--shared-modal-pattern)
  with the row's `undo_payload`, diverging from World's and Plot's
  History tabs, whose press opens the row's entry in the reader.
- [Diagnostics Hub · Per-turn inspector — Deltas section](../screens/diagnostics/diagnostics.md#deltas-per-turn-inspector)
  — the deltas emitted during a turn (pipeline emissions +
  user-edit deltas), turn- or run-scoped; `source`-labeled per row,
  `onPress` routes to the Delta log tab focused on the row.
- [Chapter Timeline · Review window](../screens/chapter-timeline/chapter-timeline.md#review-window)
  — the changes of one chapter close, grouped by area by the host. Each
  row carries the write's `why` and its entry link in a
  [footer](#footer), with the meta line off and the summary unclamped;
  `onPress` opens the row in World or Plot.

## Compound API

```ts
type DeltaLogRowProps = {
  delta: {
    id: string
    op: 'create' | 'update' | 'delete'
    source:
      | 'ai_classifier'
      | 'piggyback_tagged_block'
      | 'per_turn_classifier'
      | 'periodic_classifier'
      | 'user_edit'
      | 'lore_agent'
      | 'chapter_close'
    targetTable: string // host's resolution call; compound uses it as fallback label only
    targetDisplayName: string // pre-resolved by host
    fieldPath: string | null // op=update: "state.traits[2]"; op=create/delete: null
    summary: string // pre-rendered diff prose, host-formatted
    entryId: string | null // null for non-entry-triggered events
    createdAtRelative: string // pre-formatted "2h ago" / "12 Apr, 14:33"
    actionId: string // included for future grouping cue; v1 renders flat
  }
  onPress?: () => void // host wires navigation
  className?: string // the outermost element: the row, or the row and its footer
  footer?: ReactNode // under the row, outside its button, aligned to the summary
  showMeta?: boolean // default true; false drops the meta line
  summaryLines?: number | null // default 2; null for no clamp
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

Three optional props reshape the row for a host that shows more than a
log line, and leave the default row as it is. `footer` renders a line
of the host's under the row and outside its button (see
[Footer](#footer)). `showMeta={false}` drops the
[meta line](#meta-line) from view and from the row's description.
`summaryLines` sets the [summary](#summary)'s clamp, and null lifts it.
A host keeps a row's footer present or absent for the row's life:
adding one re-parents the row, which drops its focus.

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

A per-row History tab names a link row's delta by the link and its
other end, "Relationship · Kael", since the tab's own row is
implied; an other end's delete that removed link rows reads under
the link label alone ("Relationship"). See
[World → History tab](../screens/world/world.md#history-tab).

### Summary

The host's pre-rendered diff prose. 2-line ellipsis bound by default;
`summaryLines` sets another bound, or none at null. The review window
lifts it, since a clamp on `old → new` hides the new value.
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

- **Source label** — compound owns the enum → label mapping, through
  `t('history:source.<enum>')`:
  - `ai_classifier` → `classifier`
  - `piggyback_tagged_block` → `piggyback`
  - `per_turn_classifier` → `per-turn classifier`
  - `periodic_classifier` → `periodic classifier`
  - `user_edit` → `user`
  - `lore_agent` → `lore agent`
  - `chapter_close` → `chapter close`
- **Entry ref** — `entry #<n>` when `entryId` non-null; omitted
  when null. Plain meta text, not a link — see
  [Click behavior](#click-behavior). Host supplies the
  pre-formatted "entry #47" via the entry's position.
- **Time** — `createdAtRelative` opaque to the compound. The host
  renders it relative under a week (`just now`, `5m ago`, `2h ago`,
  `3d ago`), then as the date and time in the shape its locale string
  sets — English is day-month on a 24-hour clock, `12 Apr, 14:33` —
  adding the year outside the current year (`30 Dec 2025, 09:05`). A
  date-time format setting independent of the UI language is
  [routed to M7.1](../../implementation/roadmap.md#m7--app-settings--diagnostics--onboarding).
  It is the wall-clock time the delta was logged; the row's place in
  the story is its entry ref. The story card's last-opened
  time follows the same rule
  ([story-card.md → Compound API](./story-card.md#compound-api)).

`showMeta={false}` drops the line, and its text leaves the row's
description with it. The review window drops it: every row there comes
from one close, so the source and the time repeat, and the entry rides
in the footer's link.

### Footer

`footer` is the host's line under the row. It sits outside the row's
button and starts at the summary column, past the op badge and its gap.
An invisible, unannounced copy of the badge holds that width, so the
footer lines up in any locale. A control in it is a control of its own,
never nested in the row's. The review window puts the write's `why` and
its entry link there:

```
┌──────────────────────────────────────────────────┐
│ [● update]  Kael · voice                         │
│             wry, joking → short, flat sentences  │
│             He stops joking. entry #47 →         │
└──────────────────────────────────────────────────┘
```

## Click behavior

`onPress?: () => void` — host wires what tap does:

- Entity / lore / thread / happening target → open in respective
  detail pane.
- `entryId` set → optionally navigate to the entry in reader.
- Compound just emits the press; routing is host concern.

When `onPress` is undefined, the row is non-interactive (no
hover, no press affordance).

World's and Plot's History tabs pass `onPress` only for a row whose
entry anchor resolved to a label, and it opens that entry in the
reader, through the pane's unsaved-changes guard. The target row is
already open on the pane the tab lives in, so the entry is where a
press has to go. A row whose anchor is deleted or off the branch
passes none and stays non-interactive. The Diagnostics delta log's
link is an
[M7 carried deferral](../../implementation/roadmap.md#m7--app-settings--diagnostics--onboarding).

A pressable row is a button named `<op> <target>` (`update Kael`). A
row whose `entryId` is non-null adds the entry label after a comma
(`update Kael, entry #47`), because rows of one target read alike
while a press opens different entries. That holds for any host's
pressable row, whatever its press opens. A button's name stands for
its content, so the field path, summary and meta line are its
description, read after the name. A non-interactive row isn't a
control: it has no name and isn't announced as disabled, and its text
reads as it shows.

A link in a [footer](#footer) sits outside the row's button, so it is
announced and pressed as a control of its own and never fires the row's
`onPress`. A host whose footer carries the row's entry link passes
`entryId: null`: the link names the entry, so the row's name stays
`<op> <target>` rather than naming an entry its press doesn't open. The
review window's rows do this.

## Storybook (DeltaLogRow)

Live demos: each op color (create / update / delete), 5 of the 7
source labels, with-and-without `entryId`, with-and-without
`fieldPath`, very long target name (truncation), very long
summary (2-line ellipsis), non-interactive variant
(`onPress` undefined), a `footer` holding an entry link whose press
fires its own handler and not the row's, `showMeta={false}`, and
`summaryLines={null}` beside a clamped twin. Lives at
`Compounds/DeltaLogRow`.

## What this design defers

- **Action grouping (`action_id`).** v1 renders one row per
  delta; clustering deltas that share an action is a future
  affordance. The data is present; the rendering is not. The review
  window scopes its list to one close and groups it itself.
- **Inline diff expansion.** v1 truncates the summary to 2 lines by
  default; full-detail expansion via the
  [JSONViewer pattern](./data.md#raw-json-viewer--shared-modal-pattern)
  showing the raw `undo_payload` is a future enhancement.
- **Bulk rollback affordances** — history is read-only in v1;
  rollback lives in the reader's per-entry path.
