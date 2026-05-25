# Overlay primitives

Sheet and Popover — the two transient floating-overlay primitives
shipped in phase 2 Group A of Storybook bring-up. Sister to
[`forms.md`](./forms.md) (Select consumes both) and to
[`calendar-picker.md`](./calendar-picker.md) (calendar-picker
consumes both via Select), and
[`alert-dialog.md`](./alert-dialog.md) (the consent-gate
counterpart — modal-shaped, but a sibling primitive on
`@rn-primitives/alert-dialog`). A generic Modal primitive (for
non-consent surfaces — long-form modals, complex flows that need
more than AlertDialog's gap-4 shape) may land later as a third
primitive sister to Sheet and Popover; this file would gain a
Modal section then.

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

- [Select primitive](./forms.md#select-primitive) (Group B): Sheet
  hosts the dropdown render mode on phone via the
  `@rn-primitives/select` Root context bridge (see
  [Select implementation contract](./forms.md#select--implementation-contract)).
  Note: Select's tablet / desktop dropdown branch uses
  `@rn-primitives/select`'s own Portal / Overlay / Content rather
  than our Popover primitive — the two are sibling rn-primitives
  packages, so Popover here is _not_ Select's tablet / desktop
  surface.
- [EntryCard pattern](./entry-card.md#world-time-footer): Popover
  hosts the per-entry world-time edit overlay on desktop (anchored
  to the footer); Sheet hosts it on phone. Both contain a
  `TierTupleInput` matching the active calendar's tier shape.
- [`SearchableOverlayList`](./searchable-overlay-list.md): composes
  both — anchored Popover on desktop/tablet, bottom Sheet on phone —
  as the per-tier dispatch for its three consumers (Autocomplete,
  provider-model-picker, Actions menu), which reach the overlays
  through it rather than directly.

The Used-by list grows as primitives and patterns adopt the
overlays. Future consumers will include the Branch chip popover,
the Time chip popover, the Chapter chip popover, the Calendar
picker, the Peek drawer, the Raw JSON viewer, and the
generation-in-flight pill expansion.

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

The responsive-switch helper question (one consumer-side
`<ResponsiveOverlay>` helper vs in-Select breakpoint dispatch) was
answered in favor of in-Select breakpoint dispatch via the
`useTier()` hook: only one initial consumer needed the
Sheet/Popover switch, and Select's popover side uses
`@rn-primitives/select` rather than our Popover, so a shared
`ResponsiveOverlay` abstraction had no leverage. No separate helper
primitive; consumers like the calendar-picker compound use
`useTier()` directly.

## rn-primitives mapping

- **Sheet** ← [`@rn-primitives/dialog`](https://www.npmjs.com/package/@rn-primitives/dialog)
  (already a project dep). Dialog provides the lifecycle layer
  (open / close, focus trap, scrim, dismiss-on-outside, scroll
  lock); Sheet layers slide-in presentation, drag-to-dismiss
  gesture handling, and the drag-handle visual on top.
- **Popover** ← [`@rn-primitives/popover`](https://www.npmjs.com/package/@rn-primitives/popover)
  (added during phase 2 Group A implementation). Popover provides
  anchor positioning, collision detection, lifecycle, and
  outside-click dismiss; the primitive layers token reshape and
  motion-driven enter / exit on top.

Per [`components.md` sourcing rules](../components.md#sourcing--react-native-reusables-as-baseline),
the implementation pulls the reusables CLI scaffolds for both
(component names verified at scaffold time) and reshapes tokens,
variant API, and accessibility surface; structural defaults
(rn-primitives composition, lifecycle wiring, anchor positioning
math) are accepted as-is.

A future generic Modal primitive (if added beyond AlertDialog's
consent-gate shape) would share `@rn-primitives/dialog` with Sheet
— different presentation, same lifecycle source. AlertDialog
itself uses sibling `@rn-primitives/alert-dialog`, distinct from
both.

## Sheet — API surface

```
<Sheet
  open onOpenChange anchor size dismissable
  avoidKeyboard
  ariaLabel ariaLabelledBy ariaDescribedBy
  onOpenAutoFocus onCloseAutoFocus
>
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
- `size: 'short' | 'medium' | 'tall' | 'auto'` — applies to
  `anchor='bottom'` only. `short` / `medium` / `tall` map to fixed
  viewport-percentage heights (33 / 60 / 95 vh) per
  [`layout.md`](../foundations/mobile/layout.md). `auto` opts out of
  a fixed height — content drives the panel via flexbox, capped at
  95vh. Use for editors whose intrinsic height is small and
  predictable but doesn't fit any rigid size (e.g. ColorPicker's
  custom-color editor); use the rigid sizes when the sheet should
  visually communicate its weight regardless of content. Right-anchored
  sheets are always full-height; `size` is ignored when
  `anchor='right'`.
- `dismissable: boolean` (default `true`) — controls drag-down
  (bottom only), tap-outside, system-back / Escape behavior. Set
  `false` for sheets that must commit-or-cancel explicitly.
- `avoidKeyboard?: boolean` — defaults `true` when `anchor='bottom'`;
  ignored when `anchor='right'` (desktop-only, no soft keyboard in
  scope). Drives the keyboard-avoidance wrap; see
  [Sheet — Keyboard handling](#sheet--keyboard-handling) below.
- `ariaLabel?: string` / `ariaLabelledBy?: string` /
  `ariaDescribedBy?: string` — accessible-name and description
  routing; see [Sheet — ARIA contract](#sheet--aria-contract) below.
- `onOpenAutoFocus?: (event: FocusEvent) => void` /
  `onCloseAutoFocus?: (event: FocusEvent) => void` —
  focus-handling overrides; see
  [Sheet — ARIA contract](#sheet--aria-contract).

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
  parity is the [NativeWind transition followup](../foundations/motion.md#nativewind-transition--on-native)
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

### Sheet — Keyboard handling

Bottom-anchored sheets respond to on-screen keyboards via the
[`react-native-keyboard-controller`](https://github.com/kirillzyusko/react-native-keyboard-controller)
library (Reanimated 4 peer; lands at the first Sheet implementation
pass). Native-only — Electron and RN Web get the library's
documented no-op shim.

**Outer wrap (primitive-owned).** When `avoidKeyboard` is true and
`anchor='bottom'`, `Sheet.Content` wraps the consumer's child tree
in a `flex:1` `Animated.View` whose `paddingBottom` is driven
directly off `useReanimatedKeyboardAnimation()`'s `height`
SharedValue (negative when the keyboard is open; `paddingBottom`
applied as `-height.value`). The wrap is a single layer between
`<Sheet.Content>` and consumer children; flex-based child layouts
treat it as transparent.

The library's bundled `<KeyboardAvoidingView>` with `automaticOffset`
was tried first and rejected: its frame measurement runs once on
mount via `viewPositionInWindow`, which fires while the Sheet's
Reanimated layout-entering animation is still mid-slide-in,
capturing a stale screen position that the lib never re-measures
(transform-only animations don't re-trigger `onLayout`). The result
was a first-keyboard-open flicker after every Sheet open — the
KAV computed `paddingBottom` against the wrong position, the
resulting reflow triggered a fresh `onLayout`, and the second pass
corrected. Since the Sheet is anchored at `bottom:0`, keyboard
overlap is always exactly the keyboard height — no screen-position
math needed, no frame measurement, no race. The library's
`KeyboardContext` is still re-provided inside the rn-primitives
Portal (the Portal drops React contexts on native), so
`useReanimatedKeyboardAnimation()` resolves to the real shared
values inside the portaled tree.

**Inner scroll (consumer-rendered).** `avoidKeyboard` handles outer
layout; it does **not** scroll a focused input into view inside a
scrollable Sheet body. For that, consumers wrap their scrollable
list in
[`KeyboardAwareScrollView`](https://github.com/kirillzyusko/react-native-keyboard-controller)
from the same library, replacing any inner `<ScrollView>` or
`<FlatList>`. Recommended props: `bottomOffset={16}` (one row-gap
unit, aligns to `--spacing-row-gap-md`), `mode='insets'` (default,
best perf, no layout reflow), `disableScrollOnKeyboardHide={false}`
(default, preserves scroll position on keyboard dismiss).

**Two-line consumer rule.**

- Scrollable Sheet body (Select with search, Calendar picker, Peek
  drawer hosting save-session edits) → wrap content in
  `KeyboardAwareScrollView`.
- Non-scrollable Sheet body (world-time edit Sheet with
  TierTupleInput) → rely on `avoidKeyboard` alone.

Sheet primitive does not ship a built-in scrollable wrapper —
consumers already make per-consumer list-shape choices
(virtualized vs not, search-bar position, sticky-footer) and a
primitive-owned scrollable wrapper would conflict with those.

**Drag × keyboard interaction.** While a keyboard is showing or
shown, body-drag is suspended; the drag handle remains the explicit
drag-to-dismiss surface in all keyboard states. Tap-outside, Esc,
and system-back continue to dismiss as usual. The Sheet's gesture
detector consults the library's keyboard-state hook (Android 21+
and iOS) and short-circuits the body-drag's `onBegin` when the
keyboard is up; the drag-handle detector ignores keyboard state.
Rationale: the drag handle is the canonical drag surface per
[`layout.md → Sheet behavior`](../foundations/mobile/layout.md#sheet-behavior--additional-rules);
suspending body-drag during composition removes accidental dismiss
and avoids competing with the iOS scroll-pulls-keyboard-down chain
(consumers using `KeyboardAwareScrollView` should set
`keyboardDismissMode='interactive'` for the scroll-chain feel
inside the scroll surface).

**Independent of `dismissable`.** `dismissable={false}` sheets can
still host inputs (calendar swap warnings with a confirm field,
save-session navigate-away guard with a textarea). `avoidKeyboard`
defaults `true` regardless of `dismissable`.

**Size selection × keyboard interaction.** The `paddingBottom`
mechanism behaves differently depending on whether the panel has a
fixed height:

- **`size='auto'`** — panel has no fixed `height`, only `maxHeight`.
  The inner `flex:1` wrap has no parent height to fill, so it sizes
  to its content. `paddingBottom = keyboardHeight` then _grows_ the
  wrap (and therefore the panel) by the keyboard height — content
  visually translates upward, panel rises above the keyboard. Works
  for any content whose intrinsic height is smaller than
  `screenHeight − keyboardHeight − safeArea`.
- **`size='short' | 'medium' | 'tall'`** — panel pins to a fixed
  percentage of screen height (33% / 60% / 95%). The inner `flex:1`
  wrap fills that fixed space. `paddingBottom = keyboardHeight`
  then _shrinks_ the content area inside the fixed bounds — content
  reflows within the panel's existing position. The panel does
  **not** translate; it stays anchored at `bottom:0`. Works only
  when the panel is meaningfully taller than the keyboard.

**Consumer rule of thumb:**

- **Forms, input-bearing sheets, single-purpose edits** (custom-color
  picker, "add note", world-time correction, save-session
  navigate-away guard with a textarea) → use `size='auto'`. The
  panel hugs the content and rises with the keyboard.
- **Scrollable lists, picker surfaces, content that adapts to
  whatever space is available** (Select with search, Autocomplete,
  Calendar picker, multi-item lists) → use `short` / `medium` /
  `tall`. The list shrinks gracefully when the keyboard takes part
  of the panel, and `KeyboardAwareScrollView` (per the
  [Two-line consumer rule](#sheet--keyboard-handling) above) keeps
  the focused input visible while the list scrolls.

`size='short'` is **not suitable for input-bearing sheets** — a
typical mobile keyboard is taller than 33vh, so the
`paddingBottom = keyboardHeight` math leaves zero or negative
content area inside the panel and the input gets clipped above the
panel's top edge. Use `auto` for any short input form.

**Translation note.** `ariaLabel` strings (see
[ARIA contract](#sheet--aria-contract)) are translatable
user-facing text. Consumers route them through whatever translation
surface they use for visible UI copy.

### Sheet — ARIA contract

**Role.** Sheet renders `role="dialog"` always. The consent-gate
shape lives on [`AlertDialog`](./alert-dialog.md); Sheet's
`dismissable={false}` variant is a modal form (save-session,
multi-field edit, calendar swap warning), not an alert.
`dismissable` and ARIA role are independent axes.

**Trigger ARIA.** `<Sheet.Trigger>` (when used; controlled-state
is the canonical pattern) receives `aria-haspopup="dialog"`,
`aria-expanded` synced to open state, and `aria-controls` pointing
at the overlay content's element ID while open (omitted when
closed). `asChild` slot-merge applies — the attributes merge onto
the consumer's child via the primitive's slot logic.

**Labelling.** Consumers supply an accessible name via either
`ariaLabel?: string` (direct string, used when no visible header
exists in the content) or `ariaLabelledBy?: string` (element ID
inside the content, preferred when content has a visible header).
`ariaDescribedBy?: string` is optional for descriptive body text;
rarely needed. Convention: visible heading → use `ariaLabelledBy`
(duplicating heading text into `ariaLabel` is a maintenance
hazard); no visible heading → use `ariaLabel`. Passing neither
logs a dev-mode warning; opt-out via explicit empty
`ariaLabel=""`.

**Focus management — close.** Default returns focus to the trigger
element when one exists. Programmatic-open without a trigger child
(Select drives Sheet via `open` prop directly) falls back to the
element that held focus immediately before the open, per
rn-primitives / Radix convention. Override via
`onCloseAutoFocus?: (event) => void`:

```tsx
onCloseAutoFocus={(event) => {
  event.preventDefault();
  newlyCreatedRowRef.current?.focus();
}}
```

**Focus management — open.** Default focuses the first focusable
element inside content (rn-primitives / Radix default). Override
via symmetric `onOpenAutoFocus?: (event) => void` using the same
`preventDefault` pattern — typically used to focus an input
directly or a heading marked `tabIndex={-1}`.

**Focus trap.** Sheet traps focus inside the overlay
(rn-primitives Dialog default — Tab cycles within content).
Distinct from Popover (does not trap); see
[Popover — ARIA contract](#popover--aria-contract).

## Popover — API surface

```
<Popover
  onOpenChange
  ariaLabel ariaLabelledBy ariaDescribedBy
  onOpenAutoFocus onCloseAutoFocus
>
  <PopoverTrigger asChild>...</PopoverTrigger>
  <PopoverContent side align sideOffset accessibilityRole>
    {children}
  </PopoverContent>
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
  tree. [`SearchableOverlayList`](./searchable-overlay-list.md) is
  the consumer that needs it — the Actions menu's `Cmd-K` opens the
  Popover programmatically — and implements that bridge so its
  controlled `open` works on the desktop Popover branch.
- `<PopoverContent side align>` — `side: 'top' | 'bottom'` and
  `align: 'start' | 'center' | 'end'`, forwarded to rn-primitives.
  No `'left'` / `'right'` side: rn-primitives popover positions on
  the vertical axis only. `sideOffset` (number, default `4`)
  fine-tunes the gap between trigger and content.
- `<PopoverContent accessibilityRole?>` — defaults to `"dialog"`.
  Consumer can override (e.g., `"menu"` for an Actions-menu adopter
  with arrow-key menuitem navigation). Drives both Content's role
  and Trigger's `aria-haspopup`; see
  [Popover — ARIA contract](#popover--aria-contract) below.
- `ariaLabel?: string` / `ariaLabelledBy?: string` /
  `ariaDescribedBy?: string` — same routing as Sheet's; see
  [Popover — ARIA contract](#popover--aria-contract).
- `onOpenAutoFocus?: (event: FocusEvent) => void` /
  `onCloseAutoFocus?: (event: FocusEvent) => void` —
  focus-handling overrides; see
  [Popover — ARIA contract](#popover--aria-contract).

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
  ([NativeWind transition followup](../foundations/motion.md#nativewind-transition--on-native)).
- **Trigger-out-of-view.** rn-primitives' default applies — popover
  follows the anchor or closes when the anchor scrolls out.

**Token consumption.** Surface tokens (`--bg-overlay`, `--border`
— note: `--border`, _not_ `--border-strong`, distinct from Sheet)
and radius (`--radius-md`) are canonical in
[`spacing.md → Depth metaphor`](../foundations/spacing.md#depth-metaphor).
Popover-only specifics:

- Motion — `--duration-fast`, `--ease-out`.

### Popover — ARIA contract

**Role.** Popover renders `accessibilityRole="dialog"` by default,
consumer-overridable via the `accessibilityRole` prop on
`<PopoverContent>`. The standard RN cross-platform name; reshape
audit at scaffold confirms rn-primitives Popover accepts it
consistently. `role="menu"` carries strict obligations
(`role="menuitem"` children, arrow-key navigation, Enter
activation, Escape close); the default content trees in this
codebase Tab through focusable children rather than navigating
with arrow keys, so defaulting to `"menu"` would break that
assumption. The
[Actions menu](./actions-menu.md), designed as a searchable
combobox/listbox surface, keeps `"dialog"` and does not adopt
`"menu"`; the `accessibilityRole="menu"` override stays available
should a true menu consumer (menuitem children, no textbox child)
ever appear. Under-claiming precision is safer than over-claiming
menu semantics the implementation can't honor.

**Trigger ARIA.** `<PopoverTrigger>` receives `aria-haspopup`
matching the surface's role (`"dialog"` default, `"menu"` when
consumer overrides), `aria-expanded` synced to open state, and
`aria-controls` pointing at the overlay content's element ID
while open. The single `accessibilityRole` prop on
`<PopoverContent>` drives both Content's role and Trigger's
`aria-haspopup`. `asChild` slot-merge applies — attributes merge
onto the consumer's child via the primitive's slot logic.

**Labelling.** Same shape as Sheet — `ariaLabel?: string`,
`ariaLabelledBy?: string`, `ariaDescribedBy?: string`. Convention:
visible heading → `ariaLabelledBy`; no visible heading →
`ariaLabel`. Dev-mode warning when neither is passed; opt-out via
explicit empty `ariaLabel=""`. Strings are translatable
user-facing text; consumers route through their existing
translation surface.

**Focus management — close.** Default returns focus to the
trigger element. Override via
`onCloseAutoFocus?: (event) => void` with `event.preventDefault()`
followed by an explicit focus call, mirroring Sheet's pattern.

**Focus management — open.** Default focuses the first focusable
element inside content (rn-primitives default). Override via
symmetric `onOpenAutoFocus?: (event) => void`.

**Focus trap — does not trap.** Distinct from Sheet. Tab can
leave the popover into surrounding DOM (rn-primitives Popover
default — non-modal supplementary surface). Consumers needing
trap behavior (rare; possible for a content-rich Actions menu on
desktop) opt in via rn-primitives Popover's `modal` prop
equivalent at the implementation pass.

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

- **Sheet** → Default · States (open, dismissing, with-tall-content,
  with-input-inside) · ThemeMatrix.
- **Popover** → Default · Sizes (anchored sizes — narrow / medium /
  wide) · States (open, modal, with-trigger, escape-dismissed) ·
  ThemeMatrix.

No Variants or Shapes section for either.

## Open implementation questions

- **Native motion parity.** Sheet's slide animation depends on
  the [NativeWind transition followup](../foundations/motion.md#nativewind-transition--on-native)
  — open characterization tracked inline in
  [`motion.md`](../foundations/motion.md). Sheet is the v1 surface
  that forces resolution.
