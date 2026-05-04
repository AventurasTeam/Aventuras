# Chip + Tag primitives

Design record for two sibling primitives split along the visual
fundamental of corner radius:

- **Chip** — square (small radius), used for toggleable filters /
  state indicators / multi-toggle selectors.
- **Tag** — pill (full radius), used for labeled content (tags,
  entity refs, add-affordance).

Context: [`component-inventory.md → Primitives — needs design`](../ui/component-inventory.md#primitives--needs-design).
Both reshape from the rn-reusables `badge` baseline at
[`components/ui/badge.tsx`](../../components/ui/badge.tsx).

## Why two primitives, not one

A single `Chip` primitive with a `variant` enum was considered and
rejected. The variant enum mixed visual fundamentals (radius,
border style) with purpose (filter, tag, entity-ref) — exactly the
kind of conflation the `forms.md → Select primitive` cascade
explicitly avoids.

At the visual-fundamental level the wireframes contain **two
distinct shapes**:

- **Square** — `border-radius: 3-4px`. Consistently used for
  toggleable filters and state-indicator UI (world panel state
  filter, plot list-toggles, reader Browse rail filters).
- **Pill** — `border-radius: 9999px`. Consistently used for
  labeled content (tags, entity refs, add-affordance).

The shapes carry different a11y semantics (filter / toggle ↔ static
content) and different prop sets (selected toggle ↔ removable +
dashed). Two primitives match the existing surface split cleanly.

Three surfaces in the wireframes use **pill** for what should
visually be Chip (story-list filter chips, vault calendars filter
chips, reader Browse rail mobile sheet filters). Those are
wireframe drift; consolidation fixes them.

## Chip

Square-shaped toggleable selector.

```tsx
<Chip>label</Chip>                                  // static, read-only
<Chip selected={true} onPress={...}>Active</Chip>   // selected state
<Chip selected={false} onPress={...}>Staged</Chip>  // unselected
```

API:

- `selected?: boolean` — when true, inverts to filled (`bg-fg-primary` + `text-bg-base`); when false, outline + muted text. Default false.
- `onPress?: () => void` — optional. Without it the chip renders as a static visual indicator (no `role`, no hover styling).
- When `onPress` is present, sets `role="button"` and `aria-pressed={selected}` (signals toggle semantics).
- `disabled?: boolean` — `opacity-50`, no hover, no press.

Visual contract:

- `border-radius: var(--radius-sm)` (4px).
- Padding `px-3 py-1` (proportional to text-xs line-height).
- Text `text-xs font-medium`.
- Default (unselected): `border border-border-strong text-fg-muted bg-bg-base`.
- Selected: `bg-fg-primary text-bg-base border-fg-primary`.
- Hover (web, when `onPress` set): `text-fg-primary` on unselected.
- Focus-visible (web): standard `--focus-ring` slot.

Consumers (v1):

- World panel state filter (All / In-scene / Active / Staged / Retired).
- Plot panel threads-only filter (All / Active / Pending / Resolved / Failed).
- Plot panel happenings-only filter (All / This chapter / Common knowledge / Out-of-narrative).
- Reader Browse rail filters (desktop).
- Reader Browse rail mobile sheet filters (after wireframe reframe pill → square).
- Story List filters (after wireframe reframe).
- Vault calendars filters (after wireframe reframe).

World panel's **kind selector** (Characters / Locations / Items /
Factions / Lore) uses the Select primitive's dropdown / segment
mode — not Chip — per [`forms.md → Select primitive`](../ui/patterns/forms.md#select-primitive).

## Tag

Pill-shaped labeled content.

```tsx
<Tag>tag-name</Tag>                                  // static label
<Tag removable onRemove={...}>removable-tag</Tag>    // with × button
<Tag tone="soft">@kael</Tag>                         // entity-ref soft fill
<Tag dashed onPress={addTag}>+ tag</Tag>             // add affordance
<Tag onPress={...}>clickable</Tag>                   // clickable label
```

API (all orthogonal):

- `removable?: boolean` + `onRemove?: () => void` — renders inline × button after the label. The × is its own touch target (44px floor on phone per [`touch.md`](../ui/foundations/mobile/touch.md)).
- `tone?: 'default' | 'soft'` — `soft` adds `bg-region` background tint (entity-ref usage). Default `default` (border only).
- `dashed?: boolean` — solid border → dashed border. Used for add-affordance ("+ tag", "+ relationship"). Mutually-exclusive use case with `removable` (you don't add and remove the same chip).
- `onPress?: () => void` — optional. Sets `role="button"` when present.
- `disabled?: boolean` — `opacity-50`.

Visual contract:

- `border-radius: var(--radius-full)` (9999px).
- Padding `px-2.5 py-0.5` (slightly tighter than Chip — pill shape reads more compact).
- Text `text-xs` (no `font-medium`; tags are content, not chrome).
- Default tone: `border border-border-strong text-fg-muted bg-bg-base`.
- Soft tone: `border border-border-strong text-fg-muted bg-bg-region`.
- Dashed: `border-dashed`.
- Removable × button: small `text-fg-faint`, hover `text-fg-primary`, separate Pressable for dedicated touch target.

Consumers (v1):

- Story tags ([`story-settings.md`](../ui/screens/story-settings/story-settings.md)).
- Entity tags ([`world.md`](../ui/screens/world/world.md), [`plot.md`](../ui/screens/plot/plot.md)).
- Inline entity references on detail panes (`@kael` style — soft tone).
- Add-affordance buttons ("+ tag", "+ relationship" — dashed).

## Baseline reshape

The `Badge` baseline ships variants (`default / secondary / destructive / outline`) that mix purpose with visuals. Drop the variant enum entirely; replace with the two purpose-shaped primitives above.

The shared substrate:

- Base styling reads from the same Tailwind tokens (`text-xs`, color slots).
- Both wrap a `Pressable` (when interactive) or `View` (static), with optional asChild via `@rn-primitives/slot` per the baseline.
- Both honor `disabled` uniformly.

Each primitive lives in its own file (`components/ui/chip.tsx`, `components/ui/tag.tsx`). Badge baseline file gets repurposed into Chip; Tag is a fresh sibling. No shared base component — duplication of the small visual contract is cheaper than abstracting the divergent prop shapes.

## Adversarial pass

- **Load-bearing assumption — visual fundamental is radius.** Verified across 7 wireframe consumer surfaces; the radius split lines up cleanly with the toggleable-vs-content purpose split.
- **Edge — Chip without `onPress`.** Static square indicator (e.g. read-only state badge). Allowed. Renders muted, no hover affordance.
- **Edge — Tag with both `removable` and `dashed`.** Mutually-exclusive use cases (add vs remove). Documented; no runtime guard. If a future site needs both, revisit.
- **Edge — Tag with `tone="soft"` AND `dashed`.** Composable (a soft-toned add-affordance). Allowed.
- **Cascade — wireframe reframe.** Three surfaces (story-list, vault calendars, reader Browse rail mobile sheet) need pill → square pass on their filter chips. Tracked as a wireframe-consolidation followup; not a v1 blocker for the primitive itself.
- **Doc cascade — pattern doc structure.** One combined doc (`patterns/chips.md`) covers both primitives, since they're sibling visuals sharing a token vocabulary. Tag's section anchored separately for inbound links.
- **Naming.** "Chip" and "Tag" are common UI vocabulary; readers familiar with Material / shadcn / Bootstrap recognize both. The radius-shape distinction is consistent with how Material splits Chip (square-ish) vs Tag (pill).

## Integration plan

### New canonical doc

- **`docs/ui/patterns/chips.md`** — covers both Chip and Tag, with separate sections for each primitive's contract.

### Updates to existing canonical docs

- **`docs/ui/component-inventory.md`** — replace single Chip row in needs-design with Chip + Tag in build-ready, citing `patterns/chips.md`.
- **`docs/ui/patterns/README.md`** — add `chips.md` to the index.

### Followups

- **Wireframe reframe — pill → square on filter chips** (parked-until-signal). Three surfaces: story-list, vault calendars, reader Browse rail mobile sheet. Cosmetic consistency pass; not a v1 blocker.

### Wireframes

The consolidation fixes existing wireframe drift; the followup tracks the cleanup. Primitive ships independent of wireframe state.

### Storybook story shape

- `Patterns/Chip` — basic / selected toggle / disabled / static / 5-option filter row / ThemeMatrix.
- `Patterns/Tag` — basic / removable / soft tone / dashed (add) / disabled / clickable / mixed-row (multiple tags wrapping).
