# Accordion pattern

Collapsible content sections. Used for status-tier grouping in
entity lists, profile / provider lists in App Settings, and section
grouping in Story Settings.

Sister patterns: [`entity.md → Accordion grouping on "All" view`](./entity.md#accordion-grouping-on-all-view)
(per-surface keys + which tiers default expanded).

Used by:

- [Reader Browse rail](../screens/reader-composer/reader-composer.md) — status-tier grouping (Active / Staged / Retired) on entity lists, via [`entity.md → Accordion grouping on "All" view`](./entity.md#accordion-grouping-on-all-view).
- [World panel](../screens/world/world.md) — same status-tier grouping in the list pane.
- [App Settings](../screens/app-settings/app-settings.md) — provider list (each provider expandable to reveal config) and profile list (each profile expandable to reveal model + parameters).

## Card vs strip — composition

Two visual flavors land via composition, not a primitive variant:

- **Strip (default)** — items joined by `border-b`, no margin between. Ships from the rn-reusables baseline as-is.
- **Card** — each item is its own bordered card with bg-region. Used by App Settings provider / profile lists where each item is a substantive editable entity.

Card chrome is purely visual — adding a variant would mix presentation with behavior. Consumers wanting card style pass:

```tsx
<AccordionItem className="bg-bg-region mb-3.5 rounded-md border border-border" value={profile.id}>
  ...
</AccordionItem>
```

The explicit `border` + `rounded-md` + `bg-bg-region` make each item card-shaped; the baseline's `border-b border-border` doubles up with consumer-side `border` to produce a uniform 1px outline on all four sides. `mb-3.5` provides the gap between cards.

## Single vs multi-open

`@rn-primitives/accordion` supports both `type="single"` and `type="multiple"`. v1 use cases are all multi-open (Browse rail status groups, App Settings provider / profile lists — user may expand multiple to compare).

**Default: `type="multiple"`.** Consumers opt into `type="single"` for FAQ-style mutually-exclusive sections.

## Chevron direction

`ChevronDown` icon rotates **0° when expanded, -90° when collapsed** (i.e., reads as ChevronRight when collapsed, transitions to ChevronDown when expanded). Wireframe convention; reads as "expand → reveal content below."

This inverts the rn-reusables baseline's 0° collapsed → 180° expanded rotation. Reshape applied during component scaffolding.

## Web animation

`animate-accordion-down` / `animate-accordion-up` Tailwind utilities are wired against radix's `--radix-accordion-content-height` CSS variable in [`tailwind.config.js`](../../../tailwind.config.js):

```css
@keyframes accordion-down {
  from {
    height: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
  }
}
@keyframes accordion-up {
  from {
    height: var(--radix-accordion-content-height);
  }
  to {
    height: 0;
  }
}
```

200ms duration, `var(--easing-standard)`. Native side handles expand/collapse via reanimated `LinearTransition.duration(200)` on the wrapper plus `FadeOutUp` on content exit — already wired in the baseline.

## API

Four parts, scaffolded from the baseline at [`components/ui/accordion.tsx`](../../../components/ui/accordion.tsx):

- `Accordion` — root, `value` / `onValueChange`, `type` (multiple by default in this project).
- `AccordionItem` — wraps each section. Accepts className for card-style composition (above).
- `AccordionTrigger` — header row, renders the rotating chevron and label.
- `AccordionContent` — collapsible body.

`@rn-primitives/accordion` handles the radix-on-web + native dispatch; no additional substrate needed.

## Storybook

`Primitives/Accordion` — basic strip, multiple-open default, single-open toggle (`type="single"`), card-style composition example, disabled item, ThemeMatrix.
