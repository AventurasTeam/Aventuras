# ColorPicker

Curated swatch row plus an optional custom-hex affordance. Pure UI
primitive — knows nothing about derivation, persistence, or
visibility gating. Each consumer wraps it with its own fallback
computation and (where relevant) warning logic.

Sister patterns: [`overlays.md`](./overlays.md) (Popover desktop,
Sheet narrow — the custom-color affordance composes both),
[`foundations/color.md → Curated accent palette`](../foundations/color.md#curated-accent-palette)
(the shared swatch source), and
[`foundations/color.md → Accent-derivation algorithm`](../foundations/color.md#accent-derivation-algorithm)
(the basis for App Settings's custom-hex contrast warning).

Used by:

- [App Settings — Appearance · Accent override](../screens/app-settings/app-settings.md#app--appearance)
- [Story Settings — About · Accent color](../screens/story-settings/story-settings.md#two-sections-under-one-roof--wizard-editable-vs-post-creation-tuning)
- `SuggestionCategoriesEditor` — per-category color slot
  ([Story Settings → Suggestion categories](../screens/story-settings/story-settings.md#suggestion-categories),
  [App Settings → Story Defaults → Suggestion categories](../screens/app-settings/app-settings.md#suggestion-categories))

## API

```ts
type ColorValue = string // hex, e.g. '#3b82f6'

type ColorPickerProps = {
  swatches: ColorValue[] // curated palette, order = render order
  value: ColorValue | null // null = fallback state
  onChange: (next: ColorValue | null) => void

  fallbackColor: ColorValue // shown in the (none) swatch
  fallbackLabel: string // tooltip + aria-label on (none) swatch

  allowCustom?: boolean // default false
  customWarning?: (hex: ColorValue) => ReactNode | null
  disabled?: boolean
  className?: string
  testID?: string
}
```

Fully controlled — no internal state. Consumer reads / writes
persistence directly. The primitive has no internal opinion on
where `value` comes from or where it should be persisted.

## Composition

Single horizontal row, `flex-wrap` at narrow widths. Order:

1. **`(none)` swatch** — always first. Same size + shape as a
   curated swatch. Fill = `fallbackColor`. **Marker: `border-dashed`**
   (instead of solid `--border`) — the visual signal that this is
   the fallback, not a curated pick.
2. **Curated swatches** — the `swatches[]` array, rendered as
   filled circles with solid `--border` outline at rest.
3. **`+ custom` chip** (when `allowCustom`) — swatch-sized circle
   with `+` glyph at rest. When the current `value` is a custom
   hex (i.e., not in `swatches[]`), the chip fills with that hex
   and shows the selected-state ring.

**Swatch size.** ~28 px circle at Regular density; resolves per
density token (compact / regular / comfortable) so the row scales
with the rest of the surface chrome. Tap-target floor on phone
follows
[`touch.md → Touch-target floor`](../foundations/mobile/touch.md#touch-target-floor-on-phone).

**Selected state.** Thicker `--border-strong` outline (visual
treatment may add a centered checkmark glyph at component-authoring
time; the contract is "unambiguously selected"). `(none)` and
`+ custom` use the same selected treatment as curated swatches.

**Value-equality precedence.** If `value` matches a curated swatch
verbatim, that curated swatch shows selected and the `+ custom`
chip stays at `+`, regardless of how the user originally set the
value. No provenance state.

**Swatch tooltips.** Curated swatches expose their slot name
(`red`, `orange`, etc.) as `aria-label` and hover tooltip. Supports
color-blind users for whom hue alone is not a discriminator. The
`(none)` swatch tooltip = `fallbackLabel` prop.

**Keyboard.** Each swatch is a focusable button; left/right arrow
keys move focus within the row (roving tabindex). Enter / Space
selects. `+ custom` opens the overlay; focus returns to `+ custom`
on overlay close (per
[`overlays.md`](./overlays.md) Popover / Sheet defaults).

**Disabled.** `pointerEvents: 'none'` on the row (per the
rn-primitives disabled gap on web), `opacity-50` visual. All
swatches inert.

## Custom-input overlay

Triggered by the `+ custom` chip. Surface routing per the
[overlays decision tree](../foundations/mobile/layout.md#decision-tree):

- **Desktop / tablet (≥640 px container).** Popover anchored to
  the chip, ~280 px wide.
- **Phone (<640 px container).** Sheet (Short variant) with
  drag-to-dismiss enabled.

**Layout inside.**

- Header: `Custom color` title, close icon.
- Body: cross-platform RN color picker library (hue control,
  saturation/value 2D area, hex sync) + dedicated hex text field
  - live preview swatch.
- Warning region: renders the `customWarning(localHex)` output
  (omitted when the prop is absent — saves vertical space).
- Footer: right-aligned `[Cancel] [Apply]`.

**Apply / Cancel semantics — NOT live.**

- Library + hex field write to **local popover state**, not to
  `value`.
- **Apply** closes the overlay and calls `onChange(localHex)`.
- **Cancel**, **Esc**, **outside-click**, and **drag-dismiss** all
  close and discard local state.
- **No "are you sure" guard.** Custom picking is preview-y; bail-out
  is free.

Why not live: App Settings re-runs `deriveAccent` and re-applies
the theme on every change — perceptible flicker. The library's
internal preview covers the "see it before committing" need.
Symmetric semantics across both consumers.

**Hex field.** Accepts `#RRGGBB` and `#RGB` shorthand. Normalizes
to 6-digit on Apply. Invalid hex: Apply disabled, `--danger` border
on the field, inline message `Enter a hex color, e.g. #3b82f6`.

**Focus / keyboard.** Open: focus lands on the hex field. Tab order:
library controls → hex field → Cancel → Apply. Enter inside the
hex field = Apply (when valid). Esc = Cancel.

## Consumer wiring shape

```tsx
// App Settings — Appearance · Accent override
<ColorPicker
  swatches={CURATED_ACCENT_PALETTE}
  value={appSettings.appearance.accentOverride ?? null}
  onChange={(next) => updateAccentOverride(next)}
  fallbackColor={activeTheme.accent}
  fallbackLabel="Use theme accent"
  allowCustom
  customWarning={(hex) => contrastWarningOrNull(hex, activeTheme)}
/>

// Story Settings — About · Accent color
<ColorPicker
  swatches={CURATED_ACCENT_PALETTE}
  value={story.accent_color ?? null}
  onChange={(next) => setDraftAccent(next)}
  fallbackColor={modeDerivedStripColor(story.mode, activeTheme)}
  fallbackLabel="Use mode-derived strip color"
  allowCustom
/>
```

Consumer responsibilities (NOT primitive concerns):

- Visibility gating (App Settings hides the row when active theme
  isn't `accentOverridable`).
- Theme-loaded guard — render nothing until `fallbackColor` is
  resolvable; `fallbackColor` is required and non-null.
- Persistence (writing to `app_settings.appearance.accentOverride`
  or via the surface's Save bar draft for `stories.accent_color`).
- `customWarning` content — derivation math + warning copy live in
  the consumer, not the primitive.

## Storybook

`Primitives/ColorPicker` — basic (no custom) / with custom /
disabled / with-warning (custom popover open showing warning
region) / mobile Sheet variant / ThemeMatrix.

## Implementation note — mobile gesture coordination

The cross-platform color picker library's hue slider and S/V area
use pan gestures. The Sheet variant uses pan gestures at the top
edge for drag-to-dismiss. Coordination of the two is an
implementation concern — verify at the first build pass that
library gestures don't trigger Sheet dismiss and that Sheet
drag-area is contained to the top of the overlay.
