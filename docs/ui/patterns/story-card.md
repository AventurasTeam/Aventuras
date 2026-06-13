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
  onEditInfo?: () => void
  onDuplicate?: () => void
  onExport?: () => void
  onDelete: () => void

  className?: string
}
```

`onEditInfo` / `onDuplicate` / `onExport` are optional; the overflow menu
hides each item when its callback is absent, so a consuming milestone wires
only the actions it backs (M2 wires Archive/Unarchive + Delete). `onArchiveToggle`,
`onDelete`, `onToggleFavorite`, and `onOpen` are required.

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
  (Adventure blue, Creative purple). The fallback is currently
  pinned in the compound as `#3b82f6` (adventure) / `#a855f7`
  (creative). When the visual identity session lands proper
  themed tokens, the compound swaps the inline hex for var()
  references.
- **Overflow menu (`⋯`).** Absolute top-right. Opens a Popover on
  every tier — matches the
  [`ImporterMenu`](./data.md#import-counterparts--file-based--vault)
  precedent and the
  [`Toolbar.Search` scope-help](./toolbar.md#toolbarsearch). Sheet
  was considered for phone but felt heavy for a 5-action menu and
  inconsistent with the project's other compound menus. Actions:
  Archive/Unarchive, Edit info, Duplicate, Export, Delete
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

The favorite star follows the
[icon-actions color-tier rule](./icon-actions.md#visibility--always-rendered-color-tiered-brighten-on-hover)
but with a darker rest tier than the default — deliberate
visual-hierarchy management:

| State                 | Color at rest                 | On hover/focus                             |
| --------------------- | ----------------------------- | ------------------------------------------ |
| Favorited             | `text-warning` (gold, filled) | unchanged                                  |
| Not favorited (web)   | `text-fg-muted` (outline)     | `text-fg-primary` (outline, full color)    |
| Not favorited (touch) | `text-fg-muted` (outline)     | tap fires toggle directly (no hover state) |

**Why:** the star sits inline in the title row, not in a separate
action cluster. Always-visible at `text-fg-secondary` (the
icon-actions default) would compete with the title's bold weight.
The deeper-muted rest tier keeps the title clean; hover/focus
brightens it for action discovery on desktop. Touch users tap the
muted star directly.

**Why color tiers, not opacity tiers** — an earlier draft used
`opacity-25 → opacity-100` on hover, but cssInterop strips
`opacity` to a style prop on RN-Web that doesn't compose with
`hover:` modifiers (the same trap icon-actions hit). Color tiers
deliver the same visual hierarchy through a property that does
compose.

This is the canonical exception to icon-actions; new inline
single-icon affordances inside content (not action clusters)
should consider the same darker-rest-tier treatment.

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
