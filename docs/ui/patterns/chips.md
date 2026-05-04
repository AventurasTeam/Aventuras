# Chip + Tag patterns

Two sibling primitives split along the visual fundamental of corner
radius:

- **Chip** — square (small radius). Toggleable filters, state
  indicators, multi-toggle selectors.
- **Tag** — pill (full radius). Labeled content (tags, entity
  refs, add-affordance).

Both reshape from the rn-reusables `badge` baseline. The
baseline's `default / secondary / destructive / outline` variant
enum mixed visual fundamentals with purpose; this split drops it
in favor of two purpose-shaped primitives that each carry a tight
prop set.

Sister patterns: [`forms.md → Select primitive`](./forms.md#select-primitive)
(when picking one option from a small set rather than toggling
multiple filters — World panel's kind selector, Plot's mode toggle,
etc.). Chip is for filter toggles (multi-toggle, often with `All`
default); Select is for single-choice selectors.

Used by:

- [Story List](../screens/story-list/story-list.md) — filter chips
  (after wireframe reframe — see Followups below).
- [World panel](../screens/world/world.md) — state filter (Chip);
  entity tags (Tag); inline entity refs (Tag, soft tone).
- [Plot panel](../screens/plot/plot.md) — threads + happenings
  state filters (Chip); entity tags (Tag).
- [Reader Browse rail](../screens/reader-composer/reader-composer.md) — filters (Chip).
- [Story Settings](../screens/story-settings/story-settings.md) — story tags (Tag).
- [Vault calendars](../screens/vault/calendars/calendars.md) —
  filter chips (after wireframe reframe).

## Chip — square, toggleable

```tsx
<Chip>label</Chip>                                  // static, read-only
<Chip selected={true} onPress={...}>Active</Chip>   // selected
<Chip selected={false} onPress={...}>Staged</Chip>  // unselected
```

API:

- `selected?: boolean` — when true, inverts to filled (`bg-fg-primary` + `text-bg-base`); when false, outline + muted text. Default false.
- `onPress?: () => void` — optional. Without it, the chip renders as a static visual indicator (no `role`, no hover styling).
- When `onPress` is present, sets `role="button"` + `aria-pressed={selected}`.
- `disabled?: boolean` — `opacity-50`, no hover, no press.

Visual contract:

- `border-radius: var(--radius-sm)` (4px).
- `px-3 py-1`, `text-xs font-medium`.
- Default (unselected): `border border-border-strong text-fg-muted bg-bg-base`.
- Selected: `bg-fg-primary text-bg-base border-fg-primary`.
- Hover (web, when interactive): `text-fg-primary` on unselected.
- Focus-visible (web): standard `--focus-ring` slot.

## Tag — pill, labeled content

```tsx
<Tag>tag-name</Tag>                                  // static label
<Tag removable onRemove={...}>removable-tag</Tag>    // with × button
<Tag tone="soft">@kael</Tag>                         // entity-ref soft fill
<Tag dashed onPress={addTag}>+ tag</Tag>             // add affordance
<Tag onPress={...}>clickable</Tag>                   // clickable label
```

API (all orthogonal):

- `removable?: boolean` + `onRemove?: () => void` — renders inline × button after the label. The × is its own touch target (44px floor on phone per [`touch.md`](../foundations/mobile/touch.md)).
- `tone?: 'default' | 'soft'` — `soft` adds `bg-region` background tint (entity-ref usage). Default `default` (border only).
- `dashed?: boolean` — solid border → dashed border. Used for add-affordance ("+ tag", "+ relationship"). Mutually-exclusive with `removable` in practice (add vs. remove are different use cases).
- `onPress?: () => void` — optional. Sets `role="button"` when present.
- `disabled?: boolean` — `opacity-50`.

Visual contract:

- `border-radius: var(--radius-full)` (9999px).
- `px-2.5 py-0.5`, `text-xs` (no `font-medium`; tags are content, not chrome).
- Default tone: `border border-border-strong text-fg-muted bg-bg-base`.
- Soft tone: `border border-border-strong text-fg-muted bg-bg-region`.
- Dashed: `border-dashed`.
- Removable × button: small `text-fg-faint`, hover `text-fg-primary`, separate Pressable for dedicated touch target.

## Implementation

Each primitive lives in its own file (`components/ui/chip.tsx`,
`components/ui/tag.tsx`). The Badge baseline file gets repurposed
into Chip; Tag is a fresh sibling. No shared base component —
duplication of the small visual contract is cheaper than
abstracting the divergent prop shapes.

Both wrap a `Pressable` when interactive (`onPress` or
`onRemove` present), `View` when static. Both honor `disabled`
uniformly.

## Storybook

`Primitives/Chip` — basic / selected toggle / disabled / static
indicator / 5-option filter row / ThemeMatrix.

`Primitives/Tag` — basic / removable / soft tone / dashed (add) /
disabled / clickable / mixed-row (multiple tags wrapping with
flex-wrap).

## Followups

- **Wireframe reframe — pill → square on filter chips.** Three
  surfaces drifted to pill in their wireframes when they should
  match the Chip square shape: story-list, vault calendars, reader
  Browse rail mobile sheet. Cosmetic consistency pass; not a v1
  blocker. Tracked at
  [`parked.md → Filter chip pill→square wireframe consolidation`](../../parked.md#filter-chip-pillsquare-wireframe-consolidation).
