# 2026-05-06 — StoryCard compound

Design pass for the Story List grid card. Resolves the
[`component-inventory.md → Compounds — needs design`](../ui/component-inventory.md#compounds--needs-design)
row. Small scope: the wireframe and per-screen prose almost fully
spec the visual shape; the compound design lifts that into a typed
contract and resolves three small open points (favorite-star
visibility deviation, status-badge primitive choice, Chip's
density-awareness boundary).

## Outcome

StoryCard is a thin compound rendering one story row in the
library grid. Single consumer (Story List). Visual shape pinned in
[story-list.md → Story card](../ui/screens/story-list/story-list.md#story-card--text-first)
and [the wireframe](../ui/screens/story-list/story-list.html);
this design contributes the typed API, three small clarifications,
and a Chip-primitive density-boundary clarification that surfaced
during the pass.

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

  onOpen: () => void // card body click — opens in Reader
  onToggleFavorite: () => void
  onArchiveToggle: () => void
  onEditInfo: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void // host wires the destructive-confirm modal

  className?: string
}
```

Two design choices baked in:

1. **Pre-formatted strings.** `chapterLabel` and
   `lastOpenedRelative` arrive opaque from the host; same contract
   EntryCard and the top-bar time chip use. Compound stays
   date-library agnostic.
2. **No render-prop slots.** All variation is data-driven —
   per-state behavior (archived dim, draft chapter omission)
   computes from the boolean flags. Card structure is fixed.

## Per-state rendering

| State                       | Visual                                                                  | Behavioral effect                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Default                     | full opacity, mode-accented strip plus overline                         | all actions enabled                                                                                                                |
| Archived (`archived: true`) | `opacity-55` on the entire card; `Archived` Chip after title            | card body click still opens story; overflow menu's Archive becomes Unarchive                                                       |
| Draft (`isDraft: true`)     | `Draft` Chip after title; meta row drops chapter (`Adventure · 1d ago`) | card body click resumes the wizard or opens the draft; overflow menu's Edit info points to wizard or Story Settings (host concern) |

Both flags can co-exist (an archived draft) — both Chips render,
opacity applies. Edge case but valid.

## Favorite star — deviation from icon-actions

The favorite star does NOT follow the
[icon-actions visibility rule](../ui/patterns/icon-actions.md#visibility--always-rendered-color-tiered-brighten-on-hover).
Deliberate visual-hierarchy management:

| State                 | Opacity at rest       | On hover/focus                        |
| --------------------- | --------------------- | ------------------------------------- |
| Favorited             | 100% (gold filled)    | unchanged                             |
| Not favorited (web)   | ~25% (outline, muted) | 100% (outline, full color)            |
| Not favorited (touch) | ~25% (outline, muted) | tap fires the toggle (no hover state) |

**Why:** the star sits inline in the title row, not in a separate
action cluster. Always-visible-muted (the icon-actions default)
would compete with the title's bold weight. 25% rest opacity keeps
the title clean; hover/focus reveals it for action discovery on
desktop. Touch users tap a visible-but-muted star directly — no
hover state required because the star is always at least partially
visible.

This deviation is documented in story-card.md as an explicit
exception, and icon-actions.md gains a one-liner pointing at it.

## Status badges — Chip primitive

`Draft` and `Archived` badges render as **non-interactive** `<Chip>`
primitives. Chip is the right primitive (over Tag) because:

- Square shape matches state-indicator semantics; Tag's pill shape
  reads as labeled-content.
- Non-interactive: no `onPress`, no `selected` toggle. Static
  state display.

This pass also clarifies the Chip primitive's density-awareness
boundary — see _Chip density boundary_ below.

## Chip density boundary (side-task)

Surfaced during this design: Chip's density-awareness should gate
on interactivity. Adding to
[`chips.md`](../ui/patterns/chips.md#chip--square-toggleable):

> **Density-awareness gates on interactivity.** Interactive Chip
> (with `onPress`) follows the active density tokens for tap-target
> floor on phone (per
> [touch.md → Touch-target floor](../ui/foundations/mobile/touch.md#touch-target-floor-on-phone)).
> Non-interactive Chip (no `onPress`) is density-agnostic —
> display-only sizing, no touch-floor inflation. A `Draft` badge on
> a Story Card doesn't need a 44 px tap target.

Small scope creep; resolves a real concern; lands here.

## Grid composition (host-side)

The grid is a Story List screen concern; StoryCard renders one
bubble. Documenting the expected envelope:

- Web grid: `grid-cols-[repeat(auto-fill,minmax(280px,1fr))]
gap-4` (container query if the screen uses one).
- Native grid: equivalent `FlatList` `numColumns` calc against
  measured width over the 280 px floor.
- Card stretches via `1fr` (web) / equal-width column (native) —
  no fixed-width clamping. Phone single-column fills viewport;
  tablet typically 2-3 columns; desktop 4 or more.
- Card height is content-driven (3-line description ellipsis
  bounds it). Slight per-card height variance from genre overline
  or meta wrap is acceptable.

StoryCard itself: `w-full h-full` inside grid cell; content drives
intrinsic height.

## Click-event isolation

Three click surfaces overlap visually:

- Card body → `onOpen`
- Favorite star (top of title row) → `onToggleFavorite`
- Overflow menu (`⋯` top-right) → opens menu, then routes to
  individual actions

Implementation must isolate these — tap on the star or `⋯`
should NOT bubble to the card-body open handler. Web:
`e.stopPropagation()` on the inner pressables. Native: separate
Pressables don't bubble by default; the card-body Pressable wraps
ONLY the body region (overline + title row + meta + description),
not the absolute-positioned star or `⋯`.

## Adversarial summary

**Load-bearing assumption:** the wireframe and per-screen prose
fully spec the visual shape. If wrong, the compound API balloons.
Verified by reading both — no gaps surfaced.

**Edge cases:**

- **No description.** `(no description yet)` italic placeholder —
  already in per-screen prose.
- **No genre label.** Muted "Genre not set" placeholder — already
  in per-screen prose.
- **Very long title.** `numberOfLines={2}` with ellipsis. Wireframe
  doesn't specify; lean for v1.
- **Archived + draft + favorited co-existing.** All three signals
  render legally. No conflict.

**Verified:**

- `stories.accent_color` exists on the `stories` table (user
  confirmed via mermaid in data-model.md).
- Wireframe structure (story-list.html, story-card sections).
- Per-screen prose (story-list.md → Story card — text-first).

**Assumed:**

- Title 2-line truncation as the lean. Wireframe doesn't pin;
  best judgment.
