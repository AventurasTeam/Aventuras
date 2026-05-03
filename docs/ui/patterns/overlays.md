# Overlay primitives

Sheet and Popover — the two transient floating-overlay primitives
shipped in phase 2 Group A of Storybook bring-up. Sister to
[`forms.md`](./forms.md) (Select consumes both) and to
[`calendar-picker.md`](./calendar-picker.md) (calendar-picker
consumes both via Select). Modal lands later as a third primitive
sister to these two; this file gains a Modal section once it ships.

**Canonical decision-tree, behavior rules, and surface bindings live
in [`../foundations/mobile/layout.md`](../foundations/mobile/layout.md)**
— that doc covers _when_ to use Sheet vs Popover vs Modal vs
full-screen route, the mobile / desktop / tablet mapping, the
stacking rules (Modal-over-Sheet allowed, Sheet-over-Sheet
disallowed), and the surface bindings table for retrofits. This
file covers only the **implementation contract** for the Sheet and
Popover React primitives — the API surface, rn-primitives mapping,
slot reshape policy, and Storybook story shapes.

Used by:

- (none yet — Group B's Select primitive is the first consumer)

The Used-by list grows as primitives and patterns adopt the
overlays. Initial consumers will be Select (Group B), the Actions
menu, the Branch chip popover, the Time chip popover, the Chapter
chip popover, the Calendar picker, the Peek drawer, the Raw JSON
viewer, and the generation-in-flight pill expansion.

---

## Primitive split

Two sibling components, **`<Sheet>`** and **`<Popover>`**, with
independent API surfaces. Shared lifecycle (open / close, focus
trap, dismiss-on-outside, mount / unmount semantics, scroll
locking) is delegated to rn-primitives; Aventuras does not wrap
that into its own internal `Overlay` abstraction.

The split tracks the **presentation contract**, not the platform.
Sheet is bottom-anchored or right-anchored, scrimmed, drag-aware;
Popover is trigger-anchored, content-sized, no scrim. Both are
available cross-platform — the platform-vs-overlay decision is a
consumer concern (per [`layout.md → Decision tree`](../foundations/mobile/layout.md#decision-tree)
and [`layout.md → Surface bindings`](../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces)),
not something the primitives encode.

The deferred [responsive-switch helper](../../followups.md#calendar-picker-primitive--open-shape-decisions)
question (one consumer-side `<ResponsiveOverlay>` helper vs
in-Select breakpoint dispatch) lives with Group B's Select design
pass, not with the primitives.

## rn-primitives mapping

- **Sheet** ← [`@rn-primitives/dialog`](https://www.npmjs.com/package/@rn-primitives/dialog)
  (already a project dep). Dialog provides the lifecycle layer
  (open / close, focus trap, scrim, dismiss-on-outside, scroll
  lock); Sheet layers slide-in presentation, drag-to-dismiss
  gesture handling, and the drag-handle visual on top.
- **Popover** ← `@rn-primitives/popover` (needs to be added at
  implementation time). Popover provides anchor positioning,
  collision detection, lifecycle, and outside-click dismiss; the
  primitive layers token reshape and motion-driven enter / exit
  on top.

Per [`components.md` sourcing rules](../components.md#sourcing--react-native-reusables-as-baseline),
the implementation pulls the reusables CLI scaffolds for both
(component names verified at scaffold time) and reshapes tokens,
variant API, and accessibility surface; structural defaults
(rn-primitives composition, lifecycle wiring, anchor positioning
math) are accepted as-is.

The future Modal primitive shares `@rn-primitives/dialog` with
Sheet — different presentation, same lifecycle source.

## Sheet — API surface

```
<Sheet open onOpenChange anchor size dismissable>
  <Sheet.Trigger asChild>...</Sheet.Trigger>      // optional; controlled is canonical
  <Sheet.Content>{children}</Sheet.Content>
</Sheet>
```

**Props:**

- `open: boolean` / `onOpenChange: (open) => void` — controlled
  state. Uncontrolled `defaultOpen` supported but consumers like
  Select drive open programmatically.
- `anchor: 'bottom' | 'right'` — defaults to `'bottom'`.
  `'right'` is desktop-anchored (~440px wide, full height) per
  [`layout.md → Mapping`](../foundations/mobile/layout.md#mapping--desktop-to-mobile);
  `'bottom'` is the mobile / phone shape.
- `size: 'short' | 'medium' | 'tall'` — applies to
  `anchor='bottom'` only. Maps to viewport-percentage heights per
  [`layout.md`](../foundations/mobile/layout.md). Right-anchored
  sheets are always full-height; `size` is ignored when
  `anchor='right'`.
- `dismissable: boolean` (default `true`) — controls drag-down
  (bottom only), tap-outside, system-back / Escape behavior. Set
  `false` for sheets that must commit-or-cancel explicitly.

**Anatomy:**

- **Drag handle** — rendered automatically when `anchor='bottom'`;
  hidden on `anchor='right'` per [`layout.md → Sheet behavior`](../foundations/mobile/layout.md#sheet-behavior--additional-rules).
- **Scrim** — full-screen backdrop; tap dismisses when
  `dismissable=true`.
- **Content area** — free shape. Consumer renders any tree. Sheet
  imposes no snap points or layout. In-sheet navigation (e.g.
  mobile browse rail → peek drawer state swap) lives in the
  consumer's content tree, not in the primitive.

**Behavior contract.** Behavioral rules (drag threshold, scrim
opacity, focus trap, scroll lock, tap-outside dismissal, in-edit
guard, keyboard / Esc handling) are canonical in
[`layout.md → Sheet behavior`](../foundations/mobile/layout.md#sheet-behavior--additional-rules).
Primitive-layer additions on top of that contract:

- **Animation source.** Slide-in driven by motion tokens. Native
  parity is the [NativeWind transition followup](../../followups.md#nativewind-transition--support-on-native)
  — Sheet's slide is the v1 surface forcing resolution.
- **Gesture path.** Drag-to-dismiss is implemented via
  `react-native-gesture-handler` (Expo iOS / Android only). Electron
  has no gesture path and ignores the drag affordance; outside-click
  - Escape remain the desktop dismiss surface.

**Token consumption.** Surface tokens (`--bg-overlay`,
`--border-strong`, scrim) and radius tokens (`--radius-lg` on the
open-edge corners) are canonical in
[`layout.md → Container conventions`](../foundations/mobile/layout.md#container-conventions)
and [`spacing.md → Depth metaphor`](../foundations/spacing.md#depth-metaphor).
Sheet-only specifics:

- Motion — `--duration-base`, `--ease-emphasis` (token names
  finalize at the implementation pass).

## Popover — API surface

```
<Popover onOpenChange>
  <PopoverTrigger asChild>...</PopoverTrigger>
  <PopoverContent side align sideOffset>{children}</PopoverContent>
</Popover>
```

Three flat exports (`Popover`, `PopoverTrigger`, `PopoverContent`)
matching the react-native-reusables / shadcn convention; same flat
shape as Aventuras's other primitives. No compound `Popover.Trigger`
namespace.

**Props:**

- `onOpenChange?: (open: boolean) => void` — fires on every state
  change. **No `open` / `defaultOpen` controlled API**:
  `@rn-primitives/popover@1.4.0` exposes uncontrolled state only;
  the trigger toggles internally. Programmatic control requires a
  consumer-side wrapper using `useRootContext` from inside the
  tree, which is out of scope for v1 — defer until a real consumer
  needs it.
- `<PopoverContent side align>` — `side: 'top' | 'bottom'` and
  `align: 'start' | 'center' | 'end'`, forwarded to rn-primitives.
  No `'left'` / `'right'` side: rn-primitives popover positions on
  the vertical axis only. `sideOffset` (number, default `4`)
  fine-tunes the gap between trigger and content.

**Anatomy:**

- **No scrim.** Outside-click capture is transparent; document
  scroll continues. Per [`layout.md → Container conventions`](../foundations/mobile/layout.md#container-conventions).
- **Anchor positioning** — collision-aware via rn-primitives;
  flips to the opposite side or shifts when viewport edge would
  clip.

**Behavior contract.** Dismissal surfaces, scroll-locking semantics,
and stacking rules are canonical in
[`layout.md → Container conventions`](../foundations/mobile/layout.md#container-conventions)
and [`layout.md → Stacking`](../foundations/mobile/layout.md#stacking).
Primitive-layer additions:

- **Animation source.** Fade + slight scale driven by motion
  tokens. Same native-parity caveat as Sheet
  ([NativeWind transition followup](../../followups.md#nativewind-transition--support-on-native)).
- **Trigger-out-of-view.** rn-primitives' default applies — popover
  follows the anchor or closes when the anchor scrolls out.

**Token consumption.** Surface tokens (`--bg-overlay`, `--border`
— note: `--border`, _not_ `--border-strong`, distinct from Sheet)
and radius (`--radius-md`) are canonical in
[`spacing.md → Depth metaphor`](../foundations/spacing.md#depth-metaphor).
Popover-only specifics:

- Motion — `--duration-fast`, `--ease-out`.

## Slot reshape — once at scaffold

Both primitives go through the [`components.md` reshape audit](../components.md#sourcing--react-native-reusables-as-baseline)
once when scaffolded:

- Hardcoded color / spacing / radius / motion values in the
  reusables scaffold get reshaped to read from the slot system.
- Variant / size / anchor API names get reshaped to the
  domain vocabulary defined above.
- rn-primitives composition, focus-trap mechanics, scroll-lock
  implementation, anchor positioning math, gesture-handler
  integration are accepted as-is.
- Tie-break: tokens win against any structural hardcode.

After scaffold reshape, both primitives read tokens automatically;
ongoing maintenance does not require re-reshape.

## Storybook story shapes

Per [`components.md` axes-driven rule](../components.md#storybook-story-conventions):

- **Sheet** → Default · States (open, dismissing, with-tall-content)
  · ThemeMatrix.
- **Popover** → Default · Sizes (anchored sizes — narrow / medium /
  wide) · States (open, modal, with-trigger, escape-dismissed) ·
  ThemeMatrix.

No Variants or Shapes section for either.

## Open implementation questions

Tracked in [`followups.md`](../../followups.md):

- **Sheet keyboard handling on mobile.** When a Sheet contains an
  Input and the keyboard opens, does the sheet shift up, shrink, or
  get covered? rn-primitives/dialog ships no keyboard-aware
  behavior. See [Sheet keyboard handling on mobile](../../followups.md#sheet-keyboard-handling-on-mobile).
- **Sheet + Popover ARIA contract.** Roles, `aria-labelledby`,
  `aria-describedby`, popover modality semantics. See [Sheet + Popover ARIA contract](../../followups.md#sheet--popover-aria-contract).
- **Native motion parity.** Sheet's slide animation depends on
  the [NativeWind transition followup](../../followups.md#nativewind-transition--support-on-native).
  Sheet is the v1 surface that forces resolution.

These resolve at the first Sheet / Popover implementation pass.
