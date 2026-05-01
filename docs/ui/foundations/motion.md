# Motion

The motion contract for v1. Sister to
[`iconography.md`](./iconography.md) (the other half of session
5). This file commits the motion budget tokens, reduced-motion
behavior, and per-use-site duration / easing guidance.

## Motion budget tokens

Three durations, two easings. Structurally locked (per the
[token-class taxonomy](./tokens.md#three-classes)).

### Durations

| Token             | Value  | Use                                                                                     |
| ----------------- | ------ | --------------------------------------------------------------------------------------- |
| `--duration-fast` | 150 ms | micro-interactions — hover, focus, button press feedback                                |
| `--duration-base` | 250 ms | standard transitions — popover / dropdown open-close, tooltip appear, inline-edit focus |
| `--duration-slow` | 400 ms | major transitions — modal open-close, screen transitions, panel slide                   |

The 150 / 250 / 400 progression sits in the middle of cross-
platform conventions (Material's 100 / 200 / 400; Apple HIG's
200 / 300 / 500). Avoids both "too snappy" (sub-100 ms transitions
feel jittery) and "too slow" (>500 ms feels sluggish on 60 Hz
displays). Each token is roughly 1.5–1.7× the previous, giving
perceivable but not jarring step-ups.

### Easings

| Token               | Value                            | Use                                                                   |
| ------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `--easing-standard` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | general transitions — the default for any element entering or leaving |
| `--easing-emphasis` | `cubic-bezier(0.0, 0.0, 0.2, 1)` | elements that "land" — modals, popovers, dropdowns appearing          |

`--easing-standard` is Material Design's standard curve —
balanced ease-in-out, smooth across the duration. Works well for
symmetric transitions (something appearing then disappearing the
same way).

`--easing-emphasis` is a pure ease-out (no initial ease-in). Best
for elements that **arrive** at a destination — modals dropping
into place, popovers anchoring to triggers. The lack of ease-in
makes the arrival feel decisive rather than tentative.

Why two easings, not more: most use sites are covered by these
two. Specialty curves (overshoot / spring / bounce) are out of
scope for v1's "flat, nothing flashy" identity.

### Budget — what this commits

- Three duration tokens + two easing tokens; structurally
  locked.
- Tailwind / NativeWind utility classes wire to these tokens via
  the config.

## Reduced-motion behavior

Respect platform reduced-motion preferences:

- **Web / Electron** — `@media (prefers-reduced-motion: reduce)`
  query.
- **Native (Expo)** — `AccessibilityInfo.isReduceMotionEnabled()`
  - change subscription.

When reduced motion is active, the **transform vs opacity
distinction** drives behavior:

- **Transform-based motion** (slide-in, scale-in, position
  translation) — **clamped to 1 ms** (effectively instant).
  These are the motions that trigger vestibular issues for
  sensitive users.
- **Opacity transitions** (fade-in, fade-out, cross-fade) —
  **kept at `--duration-fast`** (150 ms). Fades don't trigger
  vestibular issues, and instant opacity changes feel jarring
  (content "popping" into existence).

This is the modern accessibility pattern — Apple HIG and Material
Design Accessibility both recommend the transform-vs-opacity
distinction over a blanket "all motion off."

### Implementation pattern

JS-side at app boot + on accessibility-pref change: derive a
`--motion-scale` runtime variable (1.0 default; 0.0 when
reduced-motion is active). Transform-based transitions multiply
their duration by `--motion-scale`; opacity transitions ignore
it.

```css
.modal-enter {
  transition:
    transform calc(var(--duration-slow) * var(--motion-scale)) var(--easing-emphasis),
    opacity var(--duration-base) var(--easing-emphasis);
}
```

When `--motion-scale: 0`, the transform transition collapses to
instant; the opacity transition remains 250 ms. The user sees the
modal appear without sliding-from-elsewhere, but with a soft
fade-in rather than a hard pop.

## Use-site guidance

| Use site                                                       | Duration          | Easing                                                                   |
| -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| Hover state changes (background tint, border emphasis)         | `--duration-fast` | `--easing-standard`                                                      |
| Focus ring appearing                                           | `--duration-fast` | `--easing-standard`                                                      |
| Button press feedback                                          | `--duration-fast` | `--easing-standard`                                                      |
| Popover / dropdown open-close                                  | `--duration-base` | `--easing-emphasis`                                                      |
| Tooltip appear                                                 | `--duration-base` | `--easing-emphasis`                                                      |
| Inline-edit focus transition                                   | `--duration-base` | `--easing-standard`                                                      |
| Modal open-close                                               | `--duration-slow` | `--easing-emphasis`                                                      |
| Screen transitions                                             | `--duration-slow` | `--easing-standard`                                                      |
| Panel slide-in / out (reader rail collapse, world-pane expand) | `--duration-slow` | `--easing-standard`                                                      |
| Recently-classified row tint decay                             | `--duration-slow` | `--easing-standard` (cross-fade only — opacity transition, no transform) |

The recently-classified decay specifically rides the opacity
branch (no transform), so it stays visible even under reduced
motion — the signal carries through.

### Use-site — what this commits

- Each common use site has a recommended duration + easing
  combination.
- The transform-vs-opacity distinction protects vestibular-
  sensitive users while preserving non-motion fades.

## Implementation notes

### Web / Electron

Standard CSS `transition-duration` and `transition-timing-function`
properties consume the tokens via CSS custom properties.
Tailwind's `transition-*` utilities can be configured to map to
these tokens.

### Native (Expo)

RN's `Animated` API takes `duration` (ms) and `easing` functions
directly. Token values translate to JS constants at theme-
application time. NativeWind 4's animation utilities (where
supported) wire to the same tokens.

The `--motion-scale` reduced-motion handling derives a JS
constant (0 or 1) from `AccessibilityInfo.isReduceMotionEnabled()`
at app boot and on subsequent changes; transform-based animations
multiply their duration by this constant.

Folds into the existing
[NativeWind runtime theme-swap parity validation](../../followups.md#nativewind-runtime-theme-swap-parity-validation)
followup — motion-token parity is validated alongside color +
font.
