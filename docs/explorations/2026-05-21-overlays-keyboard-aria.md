# 2026-05-21 — Sheet + Popover: keyboard handling and ARIA

Resolves both
[`Sheet keyboard handling on mobile`](../followups.md) and
[`Sheet + Popover ARIA contract`](../followups.md) followups in a
single combined pass. Pins the library, API surface, drag-gesture
behavior under keyboard-up, role / labelling / focus contract for
both primitives, and the doc-cascade points where existing
consumers (Select, Calendar picker, EntryCard) need clarifying
notes.

## Outcome

**Keyboard handling.** Sheet gains an `avoidKeyboard?: boolean`
prop, defaults `true` on `anchor='bottom'`, no-op on
`anchor='right'`. Implementation wraps `Sheet.Content`'s child tree
in `KeyboardAvoidingView` from
[`react-native-keyboard-controller`](https://github.com/kirillzyusko/react-native-keyboard-controller)
(new dep) with `behavior='translate-with-padding'` and
`automaticOffset`. Scrollable Sheet bodies layer a consumer-rendered
`KeyboardAwareScrollView` inside the wrap to track the focused
input. Drag-down on the Sheet body is suspended while a keyboard is
showing or shown; the drag handle remains the explicit dismiss
surface in all keyboard states.

**ARIA.** Sheet renders `role="dialog"` always — the
`dismissable={false}` variant doesn't earn `alertdialog`, because
the consent-gate primitive is
[`AlertDialog`](../ui/patterns/alert-dialog.md), distinct.
Popover defaults `role="dialog"`, consumer-overridable via a
`role` prop on `PopoverContent` (the future Actions-menu redesign
is the natural `role="menu"` adopter). Both primitives gain
`ariaLabel`, `ariaLabelledBy`, `ariaDescribedBy`, `onOpenAutoFocus`,
`onCloseAutoFocus` props. Triggers carry `aria-haspopup` matched to
the surface's role plus `aria-expanded` synced to open state plus
`aria-controls` when open. Sheet traps focus (rn-primitives Dialog
default); Popover does not (rn-primitives Popover default).

**New dep.** `react-native-keyboard-controller` lands at the first
Sheet implementation pass. Reanimated 4 and gesture-handler 2.30
are already deps; the integration cost is one entry in
`package.json`.

## Locked answers (clarifying)

| Question                                                      | Answer                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library for keyboard avoidance?                               | `react-native-keyboard-controller`, not RN core. Modern Reanimated-based, `automaticOffset` removes manual offset math, `translate-with-padding` mode is the library's own recommendation for complex layouts (sheets).                                        |
| Where does keyboard avoidance live?                           | Primitive-side. Sheet wraps its content in `KeyboardAvoidingView` when `avoidKeyboard` is on. Default-on because input-hosting sheets are the common case across the surface bindings.                                                                         |
| What about focused-input visibility inside scrollable Sheets? | Consumer-rendered `KeyboardAwareScrollView` inside the wrap. Primitive does not ship a built-in scrollable wrapper, because Sheet's scrollable consumers (Select, Calendar picker, Peek drawer) already make per-consumer list-shape choices.                  |
| What happens to drag-down dismiss while keyboard is up?       | Body-drag suspended; drag handle remains drag-active. Tap-outside, Esc, system-back unaffected. Rationale: the drag handle is the canonical drag surface; body-drag is supplementary convenience that conflicts with the iOS scroll-pulls-keyboard-down chain. |
| Sheet role?                                                   | `role="dialog"` always. `dismissable={false}` is a form-shaped modal, not a consent gate; AlertDialog handles the consent shape.                                                                                                                               |
| Popover role?                                                 | `role="dialog"` default, consumer-overridable. `role="menu"` requires arrow-key menuitem navigation that our default content trees aren't set up for. The Actions menu's broader-design pass adopts `role="menu"` when it ships proper menuitem semantics.     |
| Focus return on close?                                        | Default-to-trigger. Override via `onCloseAutoFocus` with `event.preventDefault()`. Symmetric `onOpenAutoFocus` for the open path.                                                                                                                              |
| Does Popover trap focus?                                      | No (rn-primitives Popover default). Sheet traps; the asymmetry matches Radix conventions and the surface shapes (Sheet is full-attention; Popover is non-modal supplementary).                                                                                 |
| Translation of `ariaLabel`?                                   | Treat as a translatable string. Consumer-side concern; passes through whatever translation surface visible UI copy uses.                                                                                                                                       |

## Section 1 — Keyboard handling

### Library choice

Three options surveyed:

- **RN core `KeyboardAvoidingView`.** Three behaviors
  (`padding` / `height` / `position`), no Reanimated, Android jank is
  widely reported, manual `keyboardVerticalOffset` per consumer.
  Zero new dep but bad fit for sheets that sit inside a portaled
  Dialog (the offset math is annoying).
- **`react-native-keyboard-controller`.** Reanimated 4-backed
  drop-in replacement. Adds `behavior='translate-with-padding'` —
  GPU translateY during keyboard animation, settles to padding at
  rest; the library's own recommendation for complex layouts.
  Adds `automaticOffset` (auto-detects view position accounting
  for headers / modals). Ships sister primitives:
  `KeyboardAwareScrollView` (auto-scrolls focused input above
  keyboard) and `KeyboardGestureArea` (interactive iOS-physics
  dismiss). High reputation, score 84.25, 120 documented snippets.
- **`@gorhom/react-native-bottom-sheet` pattern.** Domain-specific
  bottom-sheet library that ships a custom `BottomSheetTextInput`
  coordinating sheet snap with keyboard. Not portable to our
  rn-primitives Dialog substrate; only the concept (sheet resizes
  around keyboard) is borrowable, not the implementation.

**Chosen: `react-native-keyboard-controller`.** Reanimated 4 is
already a project dep so the integration cost is small; the
`automaticOffset` feature is specifically valuable for portaled
sheet content; the sister primitives
(`KeyboardAwareScrollView` for scrollable bodies) cover the second
half of the design without additional libraries.

### Sheet API surface

Sheet gains one prop on the existing API:

```
<Sheet open onOpenChange anchor size dismissable avoidKeyboard>
  <Sheet.Trigger asChild>...</Sheet.Trigger>
  <Sheet.Content>{children}</Sheet.Content>
</Sheet>
```

- `avoidKeyboard?: boolean` — defaults `true` when `anchor='bottom'`.
  Ignored (no-op) when `anchor='right'` — right-anchored is desktop-only,
  no soft keyboard in scope. Set `false` for bottom-anchored sheets
  that explicitly want no avoidance.

Implementation contract (lives in
[`patterns/overlays.md → Sheet → Keyboard handling`](../ui/patterns/overlays.md)):
when `avoidKeyboard && anchor === 'bottom'`, `Sheet.Content` wraps
the consumer's child tree in
`<KeyboardAvoidingView behavior='translate-with-padding' automaticOffset>`
from `react-native-keyboard-controller`. The wrap is a single
`flex:1`-shaped layer; consumers writing flex-based child layouts
treat it as transparent.

`automaticOffset` removes the manual `keyboardVerticalOffset` math
that would otherwise be needed to account for the Dialog portal's
position. If the offset detection fails inside the rn-primitives
Dialog portal in practice, the escape hatch is
`keyboardVerticalOffset={N}` exposed on Sheet (additive when
`automaticOffset` is on) — documented as the fallback, not the
recommended path.

### Scrollable Sheet bodies

`avoidKeyboard` handles the outer layout response. It does not
scroll a focused input into view when the input sits below the
visible area inside a scrollable Sheet body. For that, consumers
render
[`KeyboardAwareScrollView`](https://github.com/kirillzyusko/react-native-keyboard-controller)
inside the wrap, replacing any inner `<ScrollView>` or `<FlatList>`
they would otherwise render.

Pattern rule (documented in `patterns/overlays.md`):

- **Scrollable Sheet body** (Select with search, Calendar picker,
  Peek drawer hosting save-session edits) → wrap content in
  `KeyboardAwareScrollView`.
- **Non-scrollable Sheet body** (world-time edit Sheet with
  TierTupleInput) → rely on `avoidKeyboard` alone.

Recommended consumer props on `KeyboardAwareScrollView`:

- `bottomOffset={16}` — keyboard-top to focused-input-bottom gap.
  One row-gap unit, aligns to `--spacing-row-gap-md`.
- `mode='insets'` (library default) — best perf, no layout reflow.
  `mode='layout'` only when the focused element must remain inside a
  flex-justified region.
- `disableScrollOnKeyboardHide={false}` (library default) — preserves
  scroll position on keyboard dismiss so the user's edit context
  isn't snapped back.

Primitive does not ship a built-in scrollable Sheet wrapper because
consumers already make per-consumer list-shape choices (virtualized
vs not, search-bar position, sticky-footer) and forcing them through
a primitive-owned scrollable wrapper would conflict with those.

### Drag × keyboard interaction

While a keyboard is showing or shown, body-drag on the Sheet is
suspended; drag-handle drag remains active. Tap-outside, Esc, and
system-back continue to dismiss as usual.

Three options were considered:

- **A (chosen): body-drag suspended, handle stays active.** Uniform,
  deterministic. Drag handle is the canonical drag-to-dismiss
  surface (visually rendered at the top of every bottom-anchored
  sheet per [`layout.md → Sheet behavior`](../ui/foundations/mobile/layout.md#sheet-behavior--additional-rules));
  suspending body-drag during composition removes accidental
  dismissal and avoids the iOS scroll-chain conflict.
- **B: body-drag chains (drag dismisses keyboard first, then sheet).**
  Matches iOS native UIScrollView pattern. Implementation is fragile
  cross-platform — the drag has to detect "I've consumed keyboard
  dismissal" and survive the layout shift mid-drag. Rejected as
  high-cost-low-marginal-value.
- **C: body-drag dismisses sheet (keyboard goes with).** Status quo
  if nothing changes. Aggressive — tiny accidental swipes while
  reaching for an input dismiss the user's compose context. Rejected
  as user-hostile.

Implementation contract: Sheet's gesture-handler integration
consults the keyboard state (the library ships universal
keyboard-state hooks, Android 21+ and iOS) and short-circuits the body-drag's
`onBegin` when the keyboard is showing or shown. Drag-handle
gesture detector ignores keyboard state — always active.

The consumer-side scroll view's `keyboardDismissMode='interactive'`
remains the recommended iOS-style scroll-pulls-keyboard-down chain
when wrapping `KeyboardAwareScrollView`. Sheet's body-drag
suspension removes its competition with this chain, rather than
trying to coordinate with it.

### Short / right-anchored / `dismissable` cases

- **`size='short'`** — no special handling. `translate-with-padding`
  translates the sheet up by keyboard height; short-sheet-height
  plus typical phone keyboard usually fits inside the viewport with
  margin. Worst case (very small viewport plus large keyboard) is
  the sheet brushing the status bar; the input remains visible. If
  visual breathing room matters more than the brief-affordance
  feel, the consumer-side fix is bumping to `size='medium'` —
  documented as a known visual quirk, not a primitive bug. Realistic
  population: world-time edit Sheet (short, TierTupleInput) is the
  only short-with-input Sheet on the surface-bindings table.
- **`anchor='right'`** — desktop-only. Soft keyboards don't fire on
  Electron / RN-Web in practice; `avoidKeyboard` is documented as
  ignored when `anchor='right'`. Not an error to pass it.
- **`dismissable={false}` × `avoidKeyboard`** — independent axes.
  Commit-or-cancel sheets can still host inputs (calendar swap
  warnings with a confirm field, save-session navigate-away guard
  with a textarea). `avoidKeyboard` defaults `true` regardless of
  `dismissable`.

### Storybook coverage

Per [`components.md` axes-driven rule](../ui/components.md#storybook-story-conventions),
Sheet stories remain Default · States · ThemeMatrix. The States
group adds one entry: `with-input-inside` — a story that renders
an Input inside Sheet content with `autoFocus`. On native this
exercises the real avoidance path; on web / Electron the keyboard
doesn't fire so the visual snapshot mirrors the baseline `open`
state (the story's documentation value is the input-hosting
pattern itself, not the keyboard motion).

## Section 2 — ARIA contract

### Role on the overlay surface

**Sheet → `role="dialog"` always.** ARIA's `alertdialog` spec
requires an important and usually time-sensitive message with at
least one focusable element — that's the
[`AlertDialog` primitive](../ui/patterns/alert-dialog.md)'s job,
already distinct on `@rn-primitives/alert-dialog`. Sheet's
`dismissable={false}` variant is a modal form (save-session,
multi-field edit, calendar swap warning), not a consent gate.
Consequence: `dismissable` has no effect on ARIA role; the two
axes are independent.

**Popover → `accessibilityRole="dialog"` default, consumer-overridable.**
Popover content varies across our surfaces — action lists,
forms, inert display. `role="menu"` carries strict obligations
(`role="menuitem"` children, arrow-key navigation, Enter activation,
Escape close); our default content trees Tab through focusable
children rather than navigating with arrow keys, so defaulting to
`role="menu"` would break that assumption. `role="dialog"` is the
broad-content default that works for forms, lists, and inert
content alike. Consumer override path:
`<PopoverContent accessibilityRole="menu">` — the standard RN
prop name for cross-platform role attribution; reshape audit at
scaffold time confirms both rn-primitives' Popover and Dialog
accept it consistently. The
[Actions menu broader-design pass](../followups.md#actions-menu-broader-design-pass)
is the natural future `role="menu"` adopter once it ships proper
arrow-key menuitem semantics. For v1, even the Actions menu
ships as `role="dialog"` — under-claiming precision is safer than
over-claiming menu semantics we can't honor.

### Trigger ARIA

`<Sheet.Trigger>` and `<PopoverTrigger>` receive:

- `aria-haspopup` matching the surface's role (`"dialog"` default,
  `"menu"` when consumer overrides Popover role).
- `aria-expanded` synced to open state, flipping on open / close.
- `aria-controls` pointing at the overlay content's element ID
  while open; omitted when closed.

rn-primitives' Dialog and Popover trigger components handle the
open-state sync (`aria-expanded`) automatically. Our reshape audit
at scaffold verifies `aria-haspopup` value matches the role we
set on Content. The single `accessibilityRole` prop on
`<PopoverContent>` drives both Content's role and Trigger's
`aria-haspopup`.

`asChild` slot-merge applies — when the trigger uses `asChild`
(canonical pattern), these attributes merge onto the consumer's
child element via the primitive's slot logic.

### Labelling

Both primitives accept:

- `ariaLabel?: string` — direct label string. Used when no visible
  header element exists in the content tree.
- `ariaLabelledBy?: string` — element ID inside the content.
  Preferred when content has a visible header.
- `ariaDescribedBy?: string` — optional, points at descriptive body
  text. Rarely needed across our surfaces; available, not required.

Convention (in `patterns/overlays.md`):

- Visible heading exists → prefer `ariaLabelledBy`. Duplicating
  heading text into `ariaLabel` is a maintenance hazard.
- No visible heading → use `ariaLabel`.
- Neither passed in dev → log a warning. ARIA requires some
  accessible name on a dialog; missing one is an accessibility bug.
  Opt-out via explicit `ariaLabel=""` (empty string, "I know what
  I'm doing"). Dev-only check; no production impact.

`ariaLabel` strings are translatable user-facing text. Consumers
route them through whatever translation surface they use for
visible UI copy — not a primitive concern.

### Focus management

**On close — default.** Focus returns to the trigger element when
one exists. When the overlay was opened programmatically without a
trigger child (Select drives Sheet via `open` prop directly), focus
restores to whatever element held focus immediately before the
open — standard Radix / rn-primitives behavior, inherited.

**On close — override.** `onCloseAutoFocus?: (event: FocusEvent) => void`,
mirroring rn-primitives / Radix. Consumer calls
`event.preventDefault()` to suppress default behavior, then focuses
their target:

```tsx
onCloseAutoFocus={(event) => {
  event.preventDefault();
  newlyCreatedRowRef.current?.focus();
}}
```

Common consumer needs: focus a newly-created entity row instead of
the "Create" trigger; focus a downstream form field after the
Calendar picker closes; handle the case where the Sheet's own
actions unmounted the trigger.

**On open — default.** Focus goes to the first focusable element
inside content (rn-primitives / Radix behavior). Often that's the
close-button "X" — fine but not always ideal.

**On open — override.** `onOpenAutoFocus?: (event: FocusEvent) => void`,
symmetric. Same `preventDefault` pattern. Used when focus should
land on an input directly (Sheet with a search bar at top) or on a
heading (`tabIndex={-1}` on the heading).

**Focus trap.** Sheet traps focus inside the overlay
(rn-primitives Dialog default — Tab cycles within content). Popover
does not (rn-primitives Popover default — Tab can leave the popover
into surrounding DOM). The asymmetry matches Radix conventions and
the surface shapes: Sheet is full-attention modal-like; Popover is
non-modal supplementary. Consumers who need trap on a Popover
(rare; possible for a content-rich Actions menu on desktop) opt in
via rn-primitives Popover's `modal` prop equivalent.

## Doc-cascade points

Three existing patterns reference Sheet on phone and need
clarifying notes at integration time:

- **[`patterns/forms.md` — Select primitive](../ui/patterns/forms.md).**
  Select consumes Sheet on phone. Select-with-search hosts an Input;
  notes that `avoidKeyboard` defaults on for the Sheet dropdown
  (no consumer change needed), and Select-with-search variants
  wrap the option list in `KeyboardAwareScrollView`. Doc note
  lands in Select's Implementation contract section.
- **[`patterns/calendar-picker.md`](../ui/patterns/calendar-picker.md).**
  Composes Autocomplete substrate, search-driven preset rows.
  Same pattern as Select-with-search; clarifying paragraph in
  Implementation notes.
- **[`patterns/entry-card.md` — World-time footer](../ui/patterns/entry-card.md#world-time-footer).**
  Popover on desktop, Sheet on phone hosting TierTupleInput. Short
  Sheet with non-scrollable body — `avoidKeyboard` alone, no
  `KeyboardAwareScrollView` needed. Brief note in the Mobile
  expression sub-section.

The `foundations/mobile/layout.md` Sheet-behavior section's
existing "Keyboard interaction" bullet expands to reference the
primitive's `avoidKeyboard` prop and the drag-suspension rule,
with the canonical text living in `patterns/overlays.md` per
the file's existing pointer convention.

## Assumptions and recoverable fallbacks

| Assumption                                                                                               | Recoverable fallback                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `automaticOffset` works correctly inside `@rn-primitives/dialog`'s portal.                               | Consumers pass `keyboardVerticalOffset={N}` explicitly; documented as the escape hatch.                                                           |
| `react-native-keyboard-controller`'s keyboard-state hook fires symmetrically on Android API 21+ and iOS. | Body-drag suspension may fail to engage on flaky older Androids; drag-handle remains the always-available dismiss path, so users aren't stranded. |
| rn-primitives' trigger components forward `aria-*` correctly via `asChild` slot-merge.                   | Implementation pass adds a slot-merge wrapper if needed; not a contract issue.                                                                    |

Nothing in the assumed column collapses the design. Each has a
documented degradation path or implementation-time fix.

## Rejected approaches

**Consumer-side `KeyboardAvoidingView` with RN core.** Zero new
dep, full consumer control, but every input-hosting Sheet
boilerplates the wrap, Android jank persists, manual
`keyboardVerticalOffset` per consumer accounts for the Dialog
portal's offset.

**Consumer-side `KeyboardAvoidingView` with
`react-native-keyboard-controller` (library upgrade, no primitive
surface).** Good library, but every consumer still boilerplates;
Sheet primitive's existing drag-down ownership can't coordinate
with the keyboard gesture from outside.

**Primitive-default keyboard avoidance with no opt-out.** Removes
the prop entirely. Rejected because the Actions-menu Sheet (no
input ever) has no use for the wrap — a trivial single-`View`
overhead but worth keeping the opt-out hatch.

**`role="menu"` default for Popover.** Strict ARIA obligations
(arrow-key menuitem navigation, Enter activation) that the default
content tree shape doesn't satisfy. Better to under-claim
precision via `role="dialog"` and let the Actions-menu broader
design opt in.

**`alertdialog` role for `dismissable={false}` Sheets.** The
dismiss-blocking Sheet is a form, not an alert. The consent gate
has its own primitive.

## Followups resolved / created

**Resolved:**

- [`Sheet keyboard handling on mobile`](../followups.md) —
  pinned in section 1. Library, API surface, scrollable-body
  pattern, drag suspension, edge cases all locked.
- [`Sheet + Popover ARIA contract`](../followups.md) —
  pinned in section 2. Role, trigger ARIA, labelling, focus
  management all locked.

**Created:** none. Adversarial pass surfaced assumptions with
recoverable fallbacks rather than new design questions.

**Adjacent followups, unaffected:**

- [`Native motion parity`](../ui/foundations/motion.md) — Sheet's
  slide-in animation, separate concern; not touched.
- [`Actions menu broader design pass`](../followups.md#actions-menu-broader-design-pass) —
  the natural future `role="menu"` adopter; explicitly mentioned
  as the upgrade path, but its own design pass stays open.
