# StoryCard pattern

The Story List grid card. Single consumer; visual shape pinned in
[story-list.md → Story card](../screens/story-list/story-list.md#story-card--text-first)
and [the wireframe](../screens/story-list/story-list.html). This
pattern doc carries the typed compound contract plus the
favorite-star visibility deviation from icon-actions.

Sister patterns:

- [`chips.md`](./chips.md) — `Draft` and `Archived` badges render
  as non-interactive Chip primitives.
- [`icon-actions.md`](./icon-actions.md) — the `⋯` overflow trigger
  follows this pattern; the favorite star is a documented
  exception (see _Favorite star — visibility exception_ below).

Used by:

- [Story List](../screens/story-list/story-list.md#story-card--text-first) —
  sole v1 consumer.

## Compound API

```ts
type StoryCardProps = {
  story: {
    id: string
    title: string
    description: string | null
    genreLabel: string | null // definition.genre.label
    mode: 'adventure' | 'creative'
    accentColor: string | null // stories.accent_color override; falls back to mode-derived
    favorited: boolean
    archived: boolean
    isDraft: boolean // unfinished wizard session or explicit save-as-draft
    chapterLabel: string | null // pre-formatted "Chapter 3"; null on drafts
    lastOpenedRelative: string // pre-formatted "2h ago"
  }

  onOpen: () => void
  onToggleFavorite: () => void
  onArchiveToggle: () => void
  onEditInfo: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void

  className?: string
}
```

`chapterLabel` and `lastOpenedRelative` are **pre-formatted
strings** — same opaque-render contract EntryCard's
`worldTimeLabel` and the top-bar time chip use. Compound stays
date-library agnostic.

## Per-state rendering

| State                       | Visual                                                       | Behavioral effect                                                                                                                  |
| --------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Default                     | full opacity, mode-accented strip plus overline              | all actions enabled                                                                                                                |
| Archived (`archived: true`) | `opacity-55` on the entire card; `Archived` Chip after title | card body click still opens story; overflow menu's Archive becomes Unarchive                                                       |
| Draft (`isDraft: true`)     | `Draft` Chip after title; meta row drops chapter             | card body click resumes the wizard or opens the draft; overflow menu's Edit info points to wizard or Story Settings (host concern) |

Both flags can co-exist (archived draft) — both Chips render,
opacity applies.

## Structure

```
┌────────────────────────────────────────┐
│┃ DARK FANTASY                       ⋯  │   ← left-edge accent strip + overline + overflow
│┃                                       │
│┃ ★ Aria's Descent  [Draft]             │   ← title row: favorite star + title + status Chip
│┃ Adventure · Chapter 3 · 2h ago        │   ← meta row
│┃ A former royal guard hunts the Warden │   ← description (3-line ellipsis)
│┃ through the undercities of Ironshore… │
└────────────────────────────────────────┘
```

- **Left-edge accent strip (4 px).** Color: `accent_color`
  override on the story row; falls back to mode-derived
  (Adventure blue, Creative purple).
- **Overflow menu (`⋯`).** Absolute top-right. Opens a Popover
  (desktop, tablet) or Sheet (phone) per
  [layout.md → Surface bindings](../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
  Actions: Archive/Unarchive, Edit info, Duplicate, Export, Delete
  (destructive last).
- **Genre overline.** Uppercase label above the title,
  newspaper-section style. Accent-colored (matches the strip).
  Sourced from `definition.genre.label`. Muted "Genre not set"
  placeholder when null.
- **Title row.** Favorite star (inline-before-title) + title +
  conditional status Chip (`Draft` or `Archived`). Title
  truncates with `numberOfLines={2}` if it overflows.
- **Meta row.** Mode (written out: "Adventure" / "Creative"),
  chapter label (`Chapter 3` — null for drafts), last-opened
  relative (`2h ago`). Middle-dot separators.
- **Description.** 3-line ellipsis. `(no description yet)`
  italic placeholder when null.

## Favorite star — visibility exception

The favorite star does NOT follow the
[icon-actions visibility rule](./icon-actions.md#visibility--always-rendered-color-tiered-brighten-on-hover).
Deliberate visual-hierarchy management:

| State                 | Opacity at rest       | On hover/focus                    |
| --------------------- | --------------------- | --------------------------------- |
| Favorited             | 100% (gold filled)    | unchanged                         |
| Not favorited (web)   | ~25% (outline, muted) | 100% (outline, full color)        |
| Not favorited (touch) | ~25% (outline, muted) | tap fires toggle (no hover state) |

**Why:** the star sits inline in the title row, not in a separate
action cluster. Always-visible-muted (the icon-actions default)
would compete with the title's bold weight. 25% rest opacity
keeps the title clean; hover/focus reveals it for action discovery
on desktop. Touch users tap a visible-but-muted star directly.

This is the canonical exception to icon-actions; new inline
single-icon affordances inside content (not action clusters)
should consider the same exception.

## Status badges (Chip primitives)

`Draft` and `Archived` render as **non-interactive**
[`<Chip>`](./chips.md#chip--square-toggleable) primitives —
`<Chip>{label}</Chip>` with no `onPress`. Static state indicators.

Per the chips.md
[density-awareness boundary](./chips.md#chip--square-toggleable),
non-interactive Chip is density-agnostic — no 44 px touch-floor
inflation on phone.

## Click-event isolation

Three click surfaces overlap visually inside the card:

- Card body → `onOpen` (open in Reader).
- Favorite star → `onToggleFavorite`.
- Overflow `⋯` → opens menu, routes to individual actions.

Implementation must isolate these — tap on the star or `⋯`
should NOT bubble to the card-body open handler. Web:
`e.stopPropagation()` on the inner pressables. Native: separate
Pressables don't bubble by default; the card-body Pressable wraps
ONLY the body region (overline + title row + meta + description),
not the absolute-positioned star or `⋯`.

## Grid composition (host-side)

The grid lives at the Story List screen layer; StoryCard renders
one bubble. Expected envelope:

- Web grid:
  `grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4`.
- Native grid: equivalent `FlatList` `numColumns` calc against
  measured width over the 280 px floor.
- Card stretches via `1fr` (web) / equal-width column (native).
  Phone single-column fills viewport; tablet 2-3; desktop 4 or
  more. No fixed-width clamping.
- Card height is content-driven; 3-line description ellipsis
  bounds it.

StoryCard itself: `w-full h-full` inside the grid cell.

## Storybook (StoryCard)

Live demos: default, favorited, archived, draft, archived+draft,
no description, no genre, very long title (truncation), grid of
mixed cards (responsive). Belongs in `Patterns/Story list/Story
Card` when component implementation begins.

## What this design defers

- **Cover image surfacing.** Wireframe explicitly defers to the
  visual identity session. Compound doesn't render covers in v1.
- **Per-card hover preview** (e.g., next-chapter teaser on hover)
  — not in v1 wireframe; not designed.
- **Grid sort/filter integration** — host-side; the Toolbar
  pattern owns the chrome above the grid.
