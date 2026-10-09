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
- [EntryCard pattern](./entry-card.md#world-time-footer): Sheet
  hosts the per-entry world-time edit overlay on phone. Desktop and
  tablet use a centred **Dialog**, not a Popover — the trigger sits
  in a scrolling entry list, so an anchored overlay drifts off its
  own footer and collides with the chrome around the list. Both
  contain a `TierTupleInput` matching the active calendar's tier
  shape.
- [`SearchableOverlayList`](./searchable-overlay-list.md): composes
  both — anchored Popover on desktop/tablet, bottom Sheet on phone —
  as the per-tier dispatch for its three consumers (Autocomplete,
  provider-model-picker, Actions menu), which reach the overlays
  through it rather than directly.
- [Reader · Peek drawer](../screens/reader-composer/reader-composer.md#peek-drawer--peek-implies-rail-open):
  a right Sheet on desktop and tablet whose open and close focus
  override the defaults below; on phone the peek is a level of the
  rail's bottom Sheet, not a Sheet of its own.

The Used-by list grows as primitives and patterns adopt the
overlays. Future consumers will include the Branch chip popover,
the Time chip popover, the Chapter chip popover, the Calendar
picker, the Raw JSON viewer, and the generation-in-flight pill
expansion.

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
  open onOpenChange
  ariaLabel ariaLabelledBy ariaDescribedBy
  onOpenAutoFocus onCloseAutoFocus
>
  <SheetTrigger asChild>...</SheetTrigger>      // optional; controlled is canonical
  <SheetContent anchor size dismissable onDismissRefused keyboardBehavior>{children}</SheetContent>
</Sheet>
```

**Root props:**

- `open: boolean` / `onOpenChange: (open) => void` — controlled
  state. Uncontrolled `defaultOpen` supported but consumers like
  Select drive open programmatically.
- `ariaLabel?: string` / `ariaLabelledBy?: string` /
  `ariaDescribedBy?: string` — accessible-name and description
  routing; see [Sheet — ARIA contract](#sheet--aria-contract) below.
- `onOpenAutoFocus?: (event: FocusEvent) => void` /
  `onCloseAutoFocus?: (event: FocusEvent) => void` —
  focus-handling overrides, read by the right anchor; see
  [Sheet — ARIA contract](#sheet--aria-contract).

**`SheetContent` props**, a union keyed on `anchor`, so a prop only
the other anchor reads fails typecheck rather than doing nothing:

- `anchor: 'bottom' | 'right'` — defaults to `'bottom'`.
  `'right'` is desktop-anchored (~440px wide, full height) per
  [`layout.md → Mapping`](../foundations/mobile/layout.md#mapping--desktop-to-mobile);
  `'bottom'` is the mobile / phone shape.
- `size: 'short' | 'medium' | 'tall' | 'auto'` — bottom only.
  `short` / `medium` / `tall` map to fixed
  viewport-percentage heights (33 / 60 / 95 vh) per
  [`layout.md`](../foundations/mobile/layout.md). `auto` opts out of
  a fixed height — content drives the panel via flexbox, capped at
  95vh. Use for editors whose intrinsic height is small and
  predictable but doesn't fit any rigid size (e.g. ColorPicker's
  custom-color editor); use the rigid sizes when the sheet should
  visually communicate its weight regardless of content.
  Right-anchored sheets are always full-height.
- `dismissable: boolean` (default `true`) — bottom only. `false`
  holds the sheet open against drag-down, a scrim tap and Android
  back, which it then swallows so the route doesn't pop. Set `false`
  for a sheet that must commit or cancel explicitly: a pending save,
  or an editor holding unsaved input. Esc on a web bottom sheet waits
  on its focus handling (roadmap M9.5); the right anchor dismisses
  on Esc and an outside click as a Radix dialog does.
- `onDismissRefused?: () => void` — bottom only. Called when a held
  sheet refuses a scrim tap or Android back, so an editor can raise
  the [in-edit guard](../foundations/mobile/layout.md#sheet-behavior--additional-rules).
  Drag-down reports nothing; it snaps back. A modal raised over an
  open bottom Sheet passes `portalHost={ABOVE_SHEETS_PORTAL_HOST}`:
  gorhom mounts its sheets after the app's default `PortalHost`, and
  the root layout mounts this host after gorhom's provider.
- `keyboardBehavior?: 'interactive' | 'extend'` — bottom only;
  replaces the behavior `size` picks, see
  [Sheet — Keyboard handling](#sheet--keyboard-handling) below.
- `portalHost?: string` — right only; the rn-primitives Portal host
  to render into.
- `suppressOverlayRegistration?: boolean` — opts out of claiming the
  surface as a blocking overlay, for the Actions menu's own sheet.

**Anatomy:**

- **Drag handle** — rendered automatically when `anchor='bottom'`;
  hidden on `anchor='right'` per [`layout.md → Sheet behavior`](../foundations/mobile/layout.md#sheet-behavior--additional-rules).
- **Scrim** — full-screen backdrop; tap dismisses unless
  `dismissable` is `false`, when it goes to `onDismissRefused`.
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

Bottom-anchored sheets ride gorhom's own keyboard handling
(`@gorhom/bottom-sheet`); the right anchor is desktop-only and takes
none.

- **Behavior per size.** `keyboardBehavior` follows `size`:
  `extend` for `tall`, whose 95% already clears the keyboard, so
  content reflows inside it; `interactive` for every other size,
  which lifts the sheet by the keyboard height and keeps its resting
  size. A sheet whose size crosses `tall` while open pins one value
  through `keyboardBehavior`, because the flip stops gorhom's content
  scrolling on native; the rail Sheet's peek level does this.
- **Top inset.** The lift stops at the safe-area top (`topInset`),
  so a tall keyboard can't put a sheet's head under the status bar.
  The same holds for Select's own phone sheet.
- **Blur and Android.** `keyboardBlurBehavior="restore"` returns the
  sheet to its detent when the keyboard hides.
  `android_keyboardInputMode="adjustPan"`: under `adjustResize`
  gorhom waits for a container shrink that never arrives under
  edge-to-edge, leaving every sheet under the keyboard
  (device-verified both ways).
- **Inputs and scroll.** Inside a sheet, `Input` renders gorhom's
  keyboard-aware text input (through `InputComponentContext`), so
  focusing a field moves the sheet. A fixed-detent sheet provides
  its scroll component (`ScrollComponentContext`, gorhom's on
  native), read by lists and by `ContextScrollView`, so a scrollable
  body coordinates with drag-down. An `auto` sheet provides none;
  its content sizes it.
- **A keyboard already up.** gorhom learns the keyboard only from
  show and hide events, so a sheet opened over an open keyboard
  dismisses it first; focusing a field in the sheet raises it again
  where gorhom sees it.

**Consumer rule of thumb:**

- **Forms, input-bearing sheets, single-purpose edits** (custom-color
  picker, world-time correction) → `size='auto'`. The panel hugs the
  content and rises with the keyboard.
- **Scrollable lists, picker surfaces, content that adapts to
  whatever space is available** (Select with search, MultiSelect,
  Calendar picker, the Browse rail) → `short` / `medium` / `tall`.

Sheet primitive does not ship a built-in scrollable wrapper —
consumers already make per-consumer list-shape choices
(virtualized vs not, search-bar position, sticky-footer) and a
primitive-owned scrollable wrapper would conflict with those.
Dialog takes the opposite default, for a reason the detent gives
Sheet for free: see
[Dialog — height and scroll](#dialog--height-and-scroll).

**Independent of `dismissable`.** A held-open sheet can still host
inputs; keyboard behavior doesn't depend on it.

**Translation note.** `ariaLabel` strings (see
[ARIA contract](#sheet--aria-contract)) are translatable
user-facing text. Consumers route them through whatever translation
surface they use for visible UI copy.

### Sheet — ARIA contract

**Role.** Sheet renders `role="dialog"` on web. A bottom sheet on
native is `none`: gorhom's container takes only `accessibilityRole`,
whose union has no `dialog`. The consent-gate
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
`ariaLabel=""`. On native a bottom sheet's container is labelled by
`ariaLabel` alone — gorhom forwards no `aria-labelledby` — so a sheet
named by its heading has that heading read in place there.

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

## Dialog — height and scroll

A Dialog is centred inside a `position: fixed` overlay that never
scrolls. An uncapped panel taller than the viewport therefore grows
past both edges at once — header above the top, actions below the
bottom — and neither is reachable, because nothing in the chain
scrolls to bring them back.

`DialogContent` caps itself at 90% of the window height and scrolls
its own children. The cap is measured from `useWindowDimensions()`
rather than a `vh` unit, which native has no equivalent for. The
corner close button sits outside the scroll region and stays
pinned.

`scrollable={false}` opts a host out of the primitive-owned scroll
region. It does not opt out of the cap, which always applies. Use
it when the dialog already owns a bounded scroll region with chrome
around it — the import dialog's payload details, the embedder
download's log pane, the wizard's AI-assist list. Two nested
scrollables fight for the gesture on Android, and the host's own
region is the one that should win.

Opting out binds the host for **every** state it renders, not the
one that motivated the opt-out. A multi-state dialog whose bodies
swap per state must bound each body that can grow without a
ceiling — a model-supplied file list, a model-supplied chip
collection. The cap still applies to those states, so an unbounded
one is clipped rather than scrolled, and the actions row goes with
it.

**Pinned actions.** The primitive scrolls everything it is handed,
the actions row included, and it cannot pin that row on the host's
behalf: no consumer renders `DialogFooter` as a direct child of
`DialogContent`. The actions live inside a stateful body component —
the scene editor's form, each collision-resolve mode, the world-time
footer — so the primitive never sees them among its own children and
has nothing to partition. A host that wants pinned actions takes
`scrollable={false}` and adopts the shape a Sheet already uses: a
body that scrolls and shrinks, with the actions row outside it. The
scene editor does this, which is why it reads identically on both
tiers.

[AlertDialog](./alert-dialog.md#rich-content-via-composition) pins
its actions in the primitive instead, because its consumers do
render the footer as a direct child. The divergence is in what each
primitive can see among its own children, not in what the two
surfaces want.

**Verified on native.** Both paths were measured on an Android
emulator at 1080x2400 (`app/dev/dialog.tsx`, 2026-09-04). The panel
settles at exactly 2160px under either. On the default host the
scroller clamps at the panel edge and the actions row scrolls into
reach at the end, as the pinning note above describes; under
`scrollable={false}` the host's own scroller clamps above the actions,
which stay put without scrolling. A `flexShrink` scroll view does
clamp against a parent's `maxHeight` on native, as it does under
RN-Web. Scroll initiation was probed separately, since the responder
claim this primitive clears
([lessons-learned](../../implementation/lessons-learned/dialog-content-responder-claim.md))
fails intermittently rather than outright: a fresh first touch started
the scroll in 6 of 6 trials on the default host and 4 of 4 on the
nested one.

This is the opposite default from
[Sheet](#sheet--api-surface), which ships no scroll wrapper at all.
The asymmetry is deliberate. A Sheet is bounded by its detent, so a
consumer that adds no scroll region still gets a panel that is on
screen and dismissable, merely clipped. A Dialog has no such floor:
without the cap its content leaves the viewport entirely.

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
