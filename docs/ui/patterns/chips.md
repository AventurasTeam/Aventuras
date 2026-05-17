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
  (after wireframe reframe — see Followups below); status badges on
  story cards (`Draft`, `Archived`) via the
  [StoryCard pattern](./story-card.md#status-badges-chip-primitives).
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
- `h-control-xs px-row-x-sm`, `text-xs font-medium` (height contract — see [Height](#height) below).
- Default (unselected): `border border-border-strong text-fg-muted bg-bg-base`.
- Selected: `bg-fg-primary text-bg-base border-fg-primary`.
- Hover (web, when interactive): `text-fg-primary` on unselected.
- Focus-visible (web): standard `--focus-ring` slot.

**Density-awareness gates on interactivity.** Interactive Chip
(with `onPress`) follows the active density tokens for tap-target
floor on phone (per
[touch.md → Touch-target floor](../foundations/mobile/touch.md#touch-target-floor-on-phone)).
Non-interactive Chip (no `onPress`) is density-agnostic —
display-only sizing, no touch-floor inflation. A `Draft` badge on
a [Story Card](./story-card.md#status-badges-chip-primitives)
doesn't need a 44 px tap target.

## Height

Chip is fixed at `h-control-xs`. The "dense chrome control" tier in
[`spacing.md → Component-internal sizing tokens`](../foundations/spacing.md#component-internal-sizing-tokens--density-aware)
was written for this role. No `size` prop; the height is invariant
across consumers.

**Why fixed, not a size variant.** Consumers wanting a larger
interactive pill reach for Button (which carries `sm` / `md` / `lg`
size variants — see the
[primitive height inventory](../foundations/spacing.md#primitive-height-inventory));
consumers wanting a smaller labeled pill reach for
[Tag](#tag--pill-labeled-content) (content-sized, not part of the
control-h system). Chip occupies one slot in the taxonomy and that
slot is dense-chrome at xs.

**Applies to interactive and static Chip alike.** Both
`<Chip>label</Chip>` (static badge — Story Card status badges,
Calendar Picker type labels) and `<Chip selected onPress={…}>`
(interactive filter affordance — Toolbar filter chips,
CollisionResolveDialog selection chips) render at the same fixed
height. The invariant doesn't depend on interactivity.

**Tag is excluded by design.** Tag's height is content-driven (text,
horizontal padding, border); the control-h system doesn't apply.
Chip is a chrome control with fixed height; Tag is a labeled
content shape with emergent height. Picking between them is a
shape decision, not a sizing one.

**Chrome-row composition.** When a Chip cluster sits in a Toolbar
secondary chrome row alongside Sort or other height-uniform
controls, the cluster mutually aligns at xs per the
[Toolbar height contract](./toolbar.md#height-contract--primary-input-vs-secondary-chrome-cluster).

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
- `tone?: 'default' | 'soft' | 'success' | 'warning' | 'danger' | 'accent'` — see [tone vocabulary](#tag--tone-vocabulary) below.
- `leading?: React.ReactNode` — optional element rendered before the label, separated by the existing `gap-1`. Stays inside the `TextClassContext` so child text colors continue to cascade. Used by [`GenerationStatusPill`](./generation-status-pill.md) to inject a Spinner during active phases.
- `dashed?: boolean` — solid border → dashed border. Used for **standalone add-affordance** in pre-existing chip rows ("+ relationship" on entity panes, quick-add UI in chip-only contexts). **Not** the right shape for tag-field entry — that pattern lives in [`forms.md → TagInput pattern`](./forms.md#taginput-pattern), which composes Tag + Input into a single tokenized-input surface. Mutually-exclusive with `removable` in practice (add vs. remove are different use cases).
- `onPress?: () => void` — optional. Sets `role="button"` when present.
- `disabled?: boolean` — `opacity-50`.

Visual contract:

- `border-radius: var(--radius-full)` (9999px).
- `px-2.5 py-0.5`, `text-xs` (no `font-medium`; tags are content, not chrome).
- All tones use the same geometry — only color tokens differ. No tone changes padding or radius.
- Dashed: `border-dashed`.
- Removable × button: small `text-fg-faint`, hover `text-fg-primary`, separate Pressable for dedicated touch target.

### Tag — tone vocabulary

| Tone      | Tokens                                                             | Row + chrome uses                                     |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `default` | `border-border-strong text-fg-muted bg-bg-base`                    | active entity row, Active thread, neutral             |
| `soft`    | `border-border-strong text-fg-muted bg-bg-region`                  | inline entity refs, tag chips                         |
| `success` | translucent success tint + colored text and border                 | staged entity, Resolved thread                        |
| `warning` | `bg-warning` (12% opacity overlay) + `border-warning text-warning` | retired entity, Pending thread, **status-pill error** |
| `danger`  | translucent danger tint + colored text and border                  | Failed thread                                         |
| `accent`  | translucent accent tint + colored text and border                  | status-pill **active phase** (paired with `leading`)  |

The semantic tones (`success` / `warning` / `danger` / `accent`) mirror the project's overlay-tint pattern established in [`save-bar`](../../../components/compounds/save-bar.tsx). The active gen pill pairs `tone="accent"` with `leading={<Spinner size="sm" />}`; the error pill uses `tone="warning"` with no leading.

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
