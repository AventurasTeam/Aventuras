# Accordion primitive

Design record for the Accordion primitive — collapsible content
sections, used for status-tier grouping in entity lists, profile /
provider lists in App Settings, and section grouping in Story
Settings.

Context: [`component-inventory.md → Primitives — needs design`](../ui/component-inventory.md#primitives--needs-design).
Baseline scaffolded from `react-native-reusables`'s `accordion`
component ([`components/ui/accordion.tsx`](../../components/ui/accordion.tsx)),
which wraps `@rn-primitives/accordion` (radix-on-web, native impl
on RN).

## Scope is mostly reshape

The baseline already covers the hard parts: rn-primitives
passthrough (`value` / `type` / `collapsible` / `defaultValue`),
native layout animations via reanimated `LinearTransition` +
`FadeOutUp`, focus management, ARIA. Five small decisions remain:

1. Card vs strip style.
2. Single vs multi-open default.
3. Chevron direction convention.
4. Web entry/exit animation completion.
5. Confirm rn-primitives passthrough is right.

## Card vs strip — composition, not variant

Wireframes show two flavors of accordion shape:

- **Strip** (baseline default) — items joined by `border-b`, no
  margin between. Used by Browse rail status grouping (Active /
  Staged / Retired stacked in the same list pane).
- **Card** — each item is its own bordered card with bg-region,
  margin-bottom between cards. Used by App Settings profile /
  provider lists where each item is a substantive editable entity.

**Decision: primitive ships strip; consumers opt into card via
className composition.** Card chrome is purely visual — adding a
`variant` enum to enumerate it would mix presentation with
behavior. Consumers that want card style pass:

```tsx
<AccordionItem
  className="bg-bg-region mb-3.5 rounded-md border border-b-0 border-border"
  value={profile.id}
>
  ...
</AccordionItem>
```

The `border-b-0` override drops the baseline's bottom-border (which
was joining items into a strip); the explicit border + radius +
bg-region make it card-shaped. That four-class incantation is the
canonical card form; pattern doc carries an example so consumers
don't diverge.

## Single vs multi-open

`@rn-primitives/accordion` supports both `type="single"` and
`type="multiple"`. v1 use cases are all multi-open:

- **Browse rail status groups** — user may keep multiple status
  tiers expanded.
- **App Settings profile list** — user may expand multiple
  profiles to compare.
- **App Settings provider list** — same.

**Default: `type="multiple"`.** Consumers opt into `type="single"`
for FAQ-style mutually-exclusive sections (none documented in v1).

## Chevron — wireframe convention

Baseline rotates `ChevronDown` 0° → 180° (down when collapsed, up
when expanded). Wireframes use the inverse: 0° when expanded
(natural ChevronDown), -90° when collapsed (effectively
ChevronRight).

The wireframe convention is more common in modern UIs (right →
down reads as "expand"; up → down reads less clearly). **Reshape:
trigger rotates -90° → 0° on expand**, with the reanimated worklet
on native and the existing `[data-state=open]>svg]:rotate-180`
hook reshaped to `[data-state=closed]>svg]:rotate-[-90deg]` (or
the equivalent — keep the data-state-driven rotation, just flip
the rest position).

## Web animation — complete the keyframes

The baseline references `animate-accordion-down` /
`animate-accordion-up` Tailwind utilities. Same gap as Sheet /
Popover / Select before — the keyframes don't exist in
[`tailwind.config.js`](../../tailwind.config.js); the animation
silently no-ops on web today.

Add two keyframes paired with utility classes:

```js
keyframes: {
  ...,
  'accordion-down': {
    from: { height: '0' },
    to: { height: 'var(--radix-accordion-content-height)' },
  },
  'accordion-up': {
    from: { height: 'var(--radix-accordion-content-height)' },
    to: { height: '0' },
  },
},
animation: {
  ...,
  'accordion-down': 'accordion-down 200ms var(--easing-standard)',
  'accordion-up': 'accordion-up 200ms var(--easing-standard)',
},
```

Radix exposes the measured content height as
`--radix-accordion-content-height` automatically; the keyframes
read it. Native side already handles expand/collapse via
`LinearTransition.duration(200)` on the wrapper plus `FadeOutUp`
on content exit.

## rn-primitives passthrough

Baseline correctly:

- Wraps `AccordionPrimitive.Root` with `LayoutAnimationConfig`
  - `Animated.View` for native layout transitions.
- Passes `value` / `defaultValue` / `type` / `collapsible` /
  `onValueChange` through.
- Uses `asChild` correctly across web / native.
- Wires `useItemContext().isExpanded` for trigger state-aware
  styling.

No reshape needed beyond the chevron rotation direction and
animation keyframe completion above.

## Adversarial pass

- **Load-bearing — composition for card chrome.** Risk: consumers
  diverge in card styling (different radius, border, padding).
  Mitigation: canonical card-chrome className example in the
  pattern doc as a reference.
- **Edge — empty accordion (no items).** Renders a flex container
  with no children. No visual artifact. ✓
- **Edge — content with dynamically loading height.** Radix
  re-measures `--radix-accordion-content-height` on content
  changes; CSS animation re-fires if state toggles. Standard radix
  concern. ✓
- **Edge — disabled item.** Baseline supports `disabled` (opacity
  - no press). ✓
- **Cascade — Browse rail filter × accordion grouping.** When a
  non-All filter is active, accordion groups flatten per
  [entity.md → Accordion grouping on "All" view](../ui/patterns/entity.md#accordion-grouping-on-all-view).
  Surface-level rule, not primitive concern.
- **Cascade — keyframe addition shares the tailwind.config slot
  with Sheet / Popover keyframes.** Already extended in the toast
  / animation pass; this just adds two more entries. ✓

## Integration plan

### New canonical doc

- **`docs/ui/patterns/accordion.md`** — primitive contract, card-chrome
  composition example, type prop guidance, chevron convention.

### Updates to existing canonical docs

- **`docs/ui/component-inventory.md`** — move Accordion from
  Primitives — needs design to Primitives — build-ready, citing
  `patterns/accordion.md`.
- **`docs/ui/patterns/README.md`** — add `accordion.md` to the
  index.
- **`docs/ui/patterns/entity.md`** — anchor "Accordion grouping
  on 'All' view" section to the new accordion.md primitive.

### Code change (tailwind config)

- **`tailwind.config.js`** — add `accordion-down` / `accordion-up`
  keyframes + animation utilities. This is the only code-side
  change in this design pass; the rest is documentation.

### Followups

None. All open questions resolved by the design.

### Wireframes

No screen-level wireframe affected — the wireframes already use
correct chevron convention (right when collapsed, down when
expanded). Card-style chrome already lives in app-settings.html.

### Storybook story shape

`Patterns/Accordion` — basic strip, multiple-open default, single-open
toggle (`type="single"`), card-style composition example,
disabled item, ThemeMatrix.
