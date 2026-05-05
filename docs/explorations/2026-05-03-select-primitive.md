# Select primitive — implementation contract

Phase 2 Group B. Locks the implementation shape for Aventuras's Select
primitive built on the [`@rn-primitives/select`](https://www.npmjs.com/package/@rn-primitives/select)
package and the react-native-reusables baseline. Sister to
[`overlays.md`](../ui/patterns/overlays.md) (Sheet and Popover
contracts shipped in Group A); resolves the Group B scope sketched
in [`phase-2-sketch.md → Group B`](./2026-05-03-phase-2-sketch.md#group-b--select-primitive).

Integrates into [`forms.md → Select primitive`](../ui/patterns/forms.md#select-primitive)
(canonical pattern doc). This exploration carries the **implementation
contract** — TS API, rn-primitives mapping, render-mode dispatch
shape, phone-tier overlay resolution, story shape — that forms.md's
Select section gains as a "Implementation contract" subsection at
integration time.

## Two-layer architecture

Select ships as two layers in one file (`components/ui/select.tsx`),
both exported:

- **`<Select>` dispatcher** — options-driven, cascade-resolving public
  surface. The default consumer site for "pick one of N values to
  commit" interactions.
- **`SelectPrimitive` namespace** — reshaped reusables baseline pieces
  (Root, Trigger, Value, Content, Item, Group, Label, Separator,
  ItemText, ItemIndicator, ScrollUpButton, ScrollDownButton). Compound
  shape matching reusables / shadcn convention. Used by power
  consumers (calendar picker, future rich-row pickers) when the
  cascade-driven dispatcher's API doesn't fit.

```tsx
import { Select, SelectPrimitive } from '@/components/ui/select'

// Dispatcher (default consumer surface)
<Select
  options={[{ value: 'a', label: 'Option A' }, ...]}
  value={value}
  onValueChange={setValue}
/>

// Power composition (calendar picker, future rich-row pickers)
<SelectPrimitive.Root value={...} onValueChange={...}>
  <SelectPrimitive.Trigger asChild>...</SelectPrimitive.Trigger>
  <SelectPrimitive.Content>
    <SelectPrimitive.Item value="a">...</SelectPrimitive.Item>
  </SelectPrimitive.Content>
</SelectPrimitive.Root>
```

Both layers share the phone-tier Sheet bridge automatically:
`SelectPrimitive.Content` internally dispatches to Sheet on phone
(via `useRootContext` → Sheet's controlled API) and to
`@rn-primitives/select`'s own Portal/Overlay/Content on tablet /
desktop. Power consumers get the responsive switch for free.

## Render modes — cascade dispatch

The dispatcher resolves the render mode using
[forms.md's auto-derivation cascade](../ui/patterns/forms.md#auto-derivation-cascade):

```
1. Explicit `mode` prop → use as-is
2. Any option has a description field → radio
3. Else if option count ≤ 3 (≤ 2 on phone) → segment
4. Else → dropdown
```

Three internal branches the dispatcher can render:

- **`segment`** — horizontal bordered button group, no overlay. Pure
  CSS / NativeWind composition over Pressable. No `@rn-primitives/select`
  involvement; the segment branch implements its own select-state
  wiring (single-state-of-truth via `value` / `onValueChange` props).
- **`radio`** — vertical list of rows with descriptions, no overlay.
  Pure composition over Pressable + a check indicator. Same
  self-contained state pattern as segment.
- **`dropdown`** — composes `SelectPrimitive.*` (which delegates to
  `@rn-primitives/select` for state and to Sheet/Popover for surface
  per the phone-tier dispatch).

Cardinality threshold reads `useTier()` for the mobile bump (≤ 2 on
phone, ≤ 3 elsewhere).

## Phone-tier overlay — Sheet, not Popover

Per the [phase-2 design conversation that walked back forms.md's
prior over-claim](#design-conversation-summary):

- **Phone (`useTier() === 'phone'`)** → dropdown render mode opens via
  **Sheet** (bottom-anchored). Native idiom on iOS / Android — bottom
  sheets are the dominant pattern for value-pick from a list when
  cardinality outgrows segment.
- **Tablet / Desktop** → dropdown render mode opens via
  `@rn-primitives/select`'s own Portal/Overlay/Content (anchored
  popover, the reusables-shipped baseline).

### Why Sheet on phone, not Popover

A small floating popover anchored next to a trigger is **a desktop
pattern**. Mobile-native equivalents for "pick one of N values" are
bottom sheets (Apple Notes, Material modal bottom sheet, Spotify's
"Add to playlist", Notion / Linear / Bear pickers), full-screen
push-to-list (iOS Settings.app), or Material's exposed-dropdown
(full-width below TextField, distinct from web popover positioning).
Web-style popover-next-to-trigger is essentially absent from native
mobile UIs. Sheet on phone matches platform expectations.

Forms.md's previous "phone-tier dropdown opens via Sheet" rule was
correct in direction; the integration narrows it (the prior wording
cited "model picker" as a Sheet (medium) example, but model is
Autocomplete-with-create-and-search per forms.md's own Used-by
classification, not Select).

### Sheet size — auto-derive

- **Sheet (short)** for flat lists of short labels (≤ ~6 options).
  Default for the dropdown branch.
- **Sheet (medium)** for grouped lists or option counts where short
  feels cramped (~7+ options, or any options with `group` field).
  Auto-applied when the option shape warrants it.
- Explicit `sheetSize: 'short' | 'medium' | 'auto'` prop (default
  `'auto'`) for consumer override.

### State bridge mechanism

`@rn-primitives/select`'s `Root` exposes
`useRootContext(): { open, onOpenChange, ... }`. `SelectContent` on
phone renders:

```tsx
const { open, onOpenChange } = SelectPrimitive.useRootContext()
return (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent anchor="bottom" size={sheetSize}>
      <ScrollView>{children}</ScrollView>
    </SheetContent>
  </Sheet>
)
```

Items rendered inside Sheet (rather than inside
`SelectPrimitive.Content`) work because `SelectPrimitive.Item` only
depends on Root context, not on Content. `closeOnPress` calls back
into the same `onOpenChange`; Sheet dismisses; selected value commits
through the Root.

## Native scroll wrap

`@rn-primitives/select`'s native `Content` and `Viewport` are bare
View / Fragment with no scroll behavior. On the dropdown render
mode's tablet / desktop branch, the reshape wraps `Viewport` in a
`ScrollView` with `maxHeight: ~50%` of screen height (capped by
keyboard line on phone where applicable). Web inherits the
reusables baseline's `max-h-52 overflow-y-auto` + ScrollUpButton /
ScrollDownButton — no work needed.

Virtualization is the
[virtual-list followup](../followups.md#reader-narrative-scroll-anchoring-on-prepend).
Group B doesn't trigger it: Select's "if your list outgrows Sheet
(medium), switch to Autocomplete" rule keeps option counts in
ScrollView-friendly territory. Autocomplete's larger lists (200+
provider models) become the virtualization driver in its later
implementation pass.

## `useTier()` hook

New: `hooks/use-tier.ts`. Returns `'phone' | 'tablet' | 'desktop'`
from `useWindowDimensions().width` against the boundaries declared
in [`responsive.md`](../ui/foundations/mobile/responsive.md):

- `width < 640` → `phone`
- `640 ≤ width < 1024` → `tablet`
- `width ≥ 1024` → `desktop`

First consumer is Select (cardinality bump + Sheet/Popover dispatch),
but the hook also covers other already-spec'd behaviors:

- Sheet auto-dismiss on tier transition (per
  [`platform.md → Mid-use unfold reflows`](../ui/foundations/mobile/platform.md))
- Future cross-tier components (calendar picker, autocomplete,
  responsive overlay helper)

The
[ResponsiveOverlay primitive](../followups.md#calendar-picker-primitive--open-shape-decisions)
question stays parked. Building it now is YAGNI — Select can't use
it (Select's popover side is `@rn-primitives/select`, not our
Popover), and only one Phase-2 consumer needs the Sheet/Popover
switch. When a Phase-3 consumer (calendar picker, actions menu)
needs the same dispatch with our-Popover internals, abstract
ResponsiveOverlay on top of `useTier()` then.

## Reshape policy

Per [`components.md` reshape audit](../ui/components.md#sourcing--react-native-reusables-as-baseline),
the reusables select scaffold goes through the same reshape Sheet
and Popover did:

**Reshaped (always):**

- Color tokens — `bg-popover` → `bg-bg-overlay`,
  `text-popover-foreground` → `text-fg-primary`,
  `border-input` → `border-border-strong`, `bg-background` →
  `bg-bg-base`, `text-muted-foreground` → `text-fg-muted`,
  `bg-accent` → `bg-bg-active`, `text-accent-foreground` →
  `text-fg-primary`, `bg-border` → `bg-border-default`,
  `text-foreground` → `text-fg-primary`,
  `aria-invalid:border-destructive` → token TBD at reshape time.
- Shadow classes (`shadow-sm shadow-black/5`, `shadow-md`) —
  stripped per Aventuras's flat-depth principle.
- Web entry / exit animations (`animate-in / fade-in-0 / zoom-in-95
/ slide-in-from-* / origin-(...)`) — stripped pending the
  [NativeWind transition followup](../followups.md#nativewind-transition--support-on-native).
  Native FadeIn / FadeOut retained via reanimated.
- Dark-mode-only opacity tweaks (`dark:bg-input/30
dark:active:bg-input/50 dark:hover:bg-input/50`) — stripped.
  Aventuras's theme-driven token system handles dark / light via
  registry; conditional opacity overlays are baseline cruft.
- Focus-ring classes — reshape to Aventuras's `--focus-ring` token.
- `outline-hidden` → `outline-none` (Tailwind 3 compatibility,
  matching Sheet / Popover).

**Accepted (default):**

- `@rn-primitives/select` composition: Root, Trigger, Value, Content,
  Item, Group, Label, Separator, ItemText, ItemIndicator,
  ScrollUpButton, ScrollDownButton.
- Lifecycle wiring (open / close, focus trap, scroll lock,
  dismiss-on-outside, anchor positioning math via
  `useRelativePosition`).
- Trigger position measurement (the wasted call on phone where Sheet
  hosts content is harmless).
- Web ScrollUpButton / ScrollDownButton.
- iOS `FullWindowOverlay` z-index handling.

**Augmented:**

- `Select` dispatcher (options-driven cascade) — new public layer on
  top of the reshape, justified by forms.md's "one primitive, three
  render modes" framing. Header comment in `select.tsx` cites
  [components.md augmentation policy](../ui/components.md#augmentation--when-adding-api-beyond-baseline).
- `useTier()` hook — new hook, justified by the multi-consumer
  responsive-switch concern.

**Subtracted:**

- Nothing material. The reusables baseline maps cleanly to our
  Aventuras vocabulary; no capability removed.

## TS API surface

```tsx
type SelectOption = {
  value: string
  label: string
  description?: string // → routes to radio mode
  group?: string // → bumps Sheet size to medium on phone
  disabled?: boolean
}

type SelectMode = 'segment' | 'radio' | 'dropdown'

type SelectProps = {
  options: SelectOption[]
  value: string
  onValueChange: (value: string) => void
  mode?: SelectMode // explicit override; else auto-derive
  sheetSize?: 'short' | 'medium' | 'auto' // phone-tier dropdown only; default 'auto'
  placeholder?: string // dropdown trigger value placeholder
  disabled?: boolean
  className?: string // forwarded to active branch's root element
}
```

`SelectPrimitive.*` exports preserve their reusables / rn-primitives
TS shapes, with the reshape applied to className output and the
phone-tier Sheet bridge automatic in `SelectPrimitive.Content`.

## Storybook story shape

Per [`components.md` axes-driven rule](../ui/components.md#storybook-story-conventions):

- **Default** — dispatcher with a tiny option list (cascade lands on
  segment).
- **Variants** — explicit mode prop forcing each render mode
  (segment / radio / dropdown).
- **Sizes** — dropdown trigger sizes (default / sm).
- **States** — disabled, with-value, with-disabled-options, error
  (if error visual ships with the reshape).
- **ThemeMatrix** — covers segment + radio (both inline, no portal);
  dropdown skipped per the
  [portal-using-primitives carve-out](../ui/components.md#storybook-story-conventions).
  The dropdown branch's open content escapes per-row dataSet
  scoping; verify dropdown theme parity via the toolbar global theme
  switcher (web) and `<ThemePicker />` on native.

In-file comment in `select.stories.tsx` documents the partial
ThemeMatrix per components.md's portal-skip pattern.

## Implementation order

1. **`useTier()` hook** in `hooks/use-tier.ts` (smallest piece;
   blocks the rest).
2. **Reshape primitives** in `components/ui/select.tsx`: token swap,
   shadow strip, animation strip, native Viewport ScrollView wrap,
   Sheet bridge in `SelectContent`. Export
   `SelectPrimitive` namespace.
3. **Build dispatcher** (`Select` in same file): cascade resolution
   - segment / radio / dropdown branches. Segment + radio are
     self-contained; dropdown composes `SelectPrimitive.*`.
4. **Stories** (`select.stories.tsx`): axes per the shape above.
5. **Dev page** (`app/dev/select.tsx`): all three render modes,
   cardinality bump (verify on phone vs tablet preview), Sheet swap
   on phone, controlled-state demo.
6. **forms.md integration**: tighten the phone-tier rule (Sheet for
   both Select and future Autocomplete; remove model-as-Sheet
   example; add Sheet-size auto-derive rule). Add Implementation
   contract subsection citing this exploration.
7. **Followup updates**: close
   [Calendar picker primitive — open shape decisions](../followups.md#calendar-picker-primitive--open-shape-decisions)
   only partially — Select's responsive-switch resolution lands
   here; calendar picker's Picker-fork-vs-Select-extension question
   stays open until calendar picker's design pass. Update the
   followup wording to reflect what's resolved.

## Adversarial pass

**Load-bearing assumption.** `@rn-primitives/select`'s `Item`
component works correctly when rendered outside its native `Content`
(i.e., directly inside a Sheet on phone). Verified via the package's
TS source: Item depends only on Root context (`useRootContext`,
`onValueChange`, value comparison), not on Content's positioning or
context. Risk: low. If a future `@rn-primitives/select` version
adds a Content-context dependency to Item, the bridge breaks. Pin
the version in `package.json` to mitigate.

**Edge case — multi-Select rapid open / close.** Sheet's drag-down
gesture + scrim tap dismissal both call `onOpenChange(false)` →
propagates through `useRootContext` to Select's Root. Item taps also
call `onOpenChange(false)` (via `closeOnPress`). All three pathways
converge on the same setter; no double-fire risk because the open
state is single-source-of-truth at the Root.

**Edge case — Sheet drag down conflicts with ScrollView.** Phone
dropdown renders `<ScrollView>` inside `<SheetContent>`. Sheet's
pan gesture (drag-down to dismiss) and ScrollView's vertical pan
gesture both compete. Resolution: ScrollView's pan should win when
its content can scroll (user is mid-list-scroll); Sheet's pan wins
when ScrollView is at the top boundary and the user pulls further
down. `react-native-gesture-handler` supports this via
`waitFor` / `simultaneousHandlers`. Already a Sheet-internal
concern, not Select-specific — flag as a known
gesture-coordination detail to verify during impl.

**Edge case — tier transition mid-open.** User opens Select on
phone, resizes browser to tablet width (Storybook web only; rare on
real device). Sheet auto-dismisses per
[`platform.md → tier transition`](../ui/foundations/mobile/platform.md);
Select's Root state persists; reopening on tablet renders Popover
with selected value highlighted. Clean.

**Read-site impact — forms.md.** Wording around "phone-tier dropdown
surface" gets tightened. Walk-back: model picker was cited as a
Sheet (medium) example but is Autocomplete (per forms.md's own
Used-by line). Calendar picker stays as the Sheet (medium) example
but with a forward-pointer to the open-shape followup. New
Implementation contract subsection cites this exploration.

**Read-site impact — calendar-picker.md.** No structural change;
calendar picker's Sheet-on-phone behavior stays as-spec'd. The
open-shape followup is referenced from the Implementation contract
section as deliberately unresolved.

**Read-site impact — overlays.md.** Used-by list gains "Select
(via Sheet on phone, via `@rn-primitives/select` own Content on
tablet/desktop)." Worth pinning that the tablet/desktop dropdown
branch does NOT use our Popover primitive — it uses
`@rn-primitives/select`'s own machinery, which is a sibling
dependency, not a consumer of overlays.md's Popover.

**Read-site impact — components.md.** Augmentation precedents list
gains the `Select` dispatcher entry (forms.md cascade, options-driven
API beyond reusables baseline). Storybook conventions list gains
note that Select's ThemeMatrix is partial (segment / radio covered;
dropdown skipped per portal-skip rule).

**Read-site impact — followups.md.** Calendar picker open-shape
followup wording updated to reflect that Select's responsive-switch
resolution landed (Sheet on phone for Select; ResponsiveOverlay
deferred); the Picker-fork question stays open until calendar
picker's design pass.

**Missing perspective — desktop multi-line selects.** Could a
desktop dropdown render mode want a richer trigger (multi-line value
display, secondary metadata)? Not raised in forms.md or downstream
docs; leaving the trigger as the reusables-baseline single-line
shape. If a real consumer surfaces, augmentation pass at that point.

**Missing perspective — keyboard navigation on web.** Reusables
baseline ships keyboard nav (arrow keys, Enter, Escape) via
`@rn-primitives/select`. Reshape strip-list doesn't touch keyboard
behavior. Verify during impl that arrow / Enter / Escape work on
the segment + radio branches too — those are pure RN composition,
not `@rn-primitives/select`-backed, so keyboard nav has to be
implemented manually. This is a real gap to flag.

**Verified vs. assumed split.** Verified: Item works outside
Content (TS source read), `useRootContext` exposes
`{ open, onOpenChange }` (TS source read), native Viewport / Content
have no built-in scroll (JS source read), web baseline has scroll
free (JS source read), reusables CLI scaffolds Select correctly
with Icon dependency (user ran the CLI and pinned the output in
`_tmp/select-check/`). Assumed: keyboard navigation works correctly
on the dropdown branch after reshape (likely safe, no reshape
touches keyboard); ScrollView-vs-Sheet-pan gesture coordination
resolves cleanly (likely needs `simultaneousHandlers` config —
verify during impl).

## Design conversation summary

For posterity, the iterative design path that landed here:

1. **Initial framing** — Select dispatcher consumes options; primitives
   compound shape (Shape B + cascade-driven dispatcher = Shape C).
2. **Responsive-switch question** — initially proposed `useTier()` hook
   - in-Select dispatch (vs. ResponsiveOverlay primitive vs. raw
     `useWindowDimensions`). Locked.
3. **Autocomplete-consistency concern raised** — Select-as-Sheet vs.
   Autocomplete-as-Popover would diverge sharply on phone for
   visually-similar desktop affordances.
4. **First overcorrection** — proposed "Select never Sheets;
   tiny-content goes Popover on phone." Walked too far.
5. **User pushback on native idiom** — bottom sheets (or full-screen
   push) are the actual native pattern for value-pick on mobile;
   web-style floating popover next to trigger is essentially absent.
6. **Final position** — Sheet on phone for both Select dropdown render
   mode AND future Autocomplete. Per-tier idiomatic: desktop gets
   anchored popover, phone gets bottom sheet, both for both
   primitives. Visual consistency restored within each tier.

The corrected position returns ~forms.md's original Sheet rule, but
narrows it (model picker was misclassified as Select with Sheet —
it's Autocomplete) and adds the auto-derive Sheet-size rule.
