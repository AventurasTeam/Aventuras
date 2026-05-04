# Tabs pattern

Horizontal segmented navigation between sibling sections of the
same surface. Used for entity / lore / plot detail-pane navigation
(Overview / Identity / Connections / Settings / Assets / etc.) —
not for mode toggles.

Sister patterns: [`forms.md → Select primitive`](./forms.md#select-primitive)
(when tabs collapse to a Select dropdown / segment on narrow tiers,
or when a surface picks between modes rather than navigating
sibling sections).

Used by:

- [Entity detail panes](./entity.md#tab-architecture) — World panel
  - Plot panel + Browse rail entity peek.
- [Plot panel](../screens/plot/plot.md) — happenings + threads
  detail panes.
- [World panel](../screens/world/world.md#tabs--per-kind-composition).
- Anywhere else a surface needs sibling-section navigation.

## Scope

The Tabs primitive renders the **Tab strip case only**. Cross-tier
overflow / scroll / wrap is handled by substituting the Select
primitive at narrow widths per
[Group C → Tab-strip overflow rule](../../explorations/2026-05-01-mobile-group-c-master-detail.md#tab-strip-overflow-rule):

| Tier    | Count ≤ 2      | Count = 3       | Count > 3       |
| ------- | -------------- | --------------- | --------------- |
| Desktop | Tab strip      | Tab strip       | Tab strip       |
| Tablet  | Tab strip      | Tab strip       | Select dropdown |
| Phone   | Select segment | Select dropdown | Select dropdown |

Consumers route to either Tab strip OR Select based on tier × tab
count. The Tabs primitive never has to handle counts that don't fit
its tier.

## Style — underline

Tabs render with a **bottom-border underline** on the active tab,
not a pill background. Underline conveys "navigation between parts
of the same thing"; pill conveys "toggle between modes." This app
uses the Select primitive's segment branch for mode toggles, so
tabs stay underline-shaped for sibling-section navigation.

Visual contract:

- **Active** — `border-bottom: 2px` in `--fg-primary`, label
  `--fg-primary` weight `font-medium`.
- **Inactive** — `border-bottom: 2px transparent`, label
  `--fg-muted`.
- **Hover (web)** — label `--fg-primary` (matches active without
  the underline). `transition-colors` per existing motion tokens.
- **Disabled** — `opacity-50`, no hover response.
- **Focus-visible (web)** — ring per the project's `--focus-ring`
  slot.

The strip itself sits over a `border-b border-border` line so the
active-tab underline lands flush against a continuous baseline.

Sentence-case label text. Wireframes show uppercase + letter-spacing
but that's wireframe decoration, not load-bearing.

## Counts

Optional per-tab `count?: number` prop on `TabsTrigger`. Renders as
muted-small text after the label (4px gap). When absent, label
renders alone.

```tsx
<TabsTrigger value="connections" count={3}>Connections</TabsTrigger>
<TabsTrigger value="overview">Overview</TabsTrigger>
```

The primitive renders the number as-is — consumers format `99+`
themselves if they want clamping. Disabled-state `opacity-50`
applies uniformly to label + count.

**Cross-primitive parity.** When tab navigation substitutes to the
Select dropdown branch on narrow tiers, option labels in the open
Select sheet should preserve the same counts so the user sees
consistent information across primitives. Wire counts through to
the Select option list when building the substitution.

## API

Four parts, scaffolded from the rn-reusables baseline at
[`components/ui/tabs.tsx`](../../../components/ui/tabs.tsx):

- `Tabs` — root, `value` / `onValueChange`-controlled.
- `TabsList` — strip container. Reshape: drop the baseline's
  pill container; replace with a flex row + `border-b
border-border`.
- `TabsTrigger` — individual tab. Reshape: drop pill background;
  add the underline state contract above; add `count` prop.
- `TabsContent` — body container, renders only when matching tab
  is active. Leave as baseline.

`@rn-primitives/tabs` handles the radix-on-web / native dispatch
underneath; no additional substrate needed.

## Storybook

`Primitives/Tabs` with stories: basic 3-tab strip, with-counts (4
tabs, mixed presence), disabled tab, ThemeMatrix per-theme contrast,
KindKitchenSink (8-tab character detail-pane simulation to verify
strip handles realistic counts at desktop tier).
