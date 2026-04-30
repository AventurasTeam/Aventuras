# Color

The color contract for v1. Sister to [`tokens.md`](./tokens.md) (the
slot inventory across all classes) and [`theming.md`](./theming.md)
(the theme runtime); this file commits the **values** the color
slots take — final inventory, per-pair contrast targets, state
treatments, accent-derivation algorithm, pattern-driven slots, and
the dev-only audit utility.

The interactive demo at [`theming.html`](./theming.html) exercises
the slot list at session-1 fidelity; real curated palettes (with
audit-passing values) land at session 6.

## Final slot inventory

V1 contract — **25 slots total.** Every theme module provides every
slot or fails to compile (per the `Record<ColorToken, string>` type
guarantee in [`theming.md → Theme data shape`](./theming.md#theme-data-shape)).

**Backgrounds (5).**

- `--bg-base` — canvas.
- `--bg-raised` — cards, inputs, dialogs above canvas.
- `--bg-sunken` — input wells, code blocks, system-entry chrome.
- `--bg-overlay` — modal / popover surfaces.
- `--bg-disabled` — disabled-control surface.

**Foregrounds (4).**

- `--fg-primary` — default text.
- `--fg-secondary` — less-emphasized text.
- `--fg-muted` — placeholders, low-emphasis labels.
- `--fg-disabled` — disabled-control text.

**Accent group (3).**

- `--accent` — primary action, brand, selection-source.
- `--accent-hover` — hover state on accent surfaces.
- `--accent-fg` — text rendered on accent backgrounds.

The accent group is the **derivation set** when accent-override
fires — five outputs cascade from one user-supplied accent (the
three above plus `--focus-ring` and `--selection-bg`). Algorithm
in [Accent-derivation algorithm](#accent-derivation-algorithm)
below.

**Semantic states (8).** Each carries a background slot + an `-fg`
text-on-state slot:

- `--success` / `--success-fg`
- `--warning` / `--warning-fg`
- `--danger` / `--danger-fg`
- `--info` / `--info-fg`

**Borders (2).**

- `--border` — default boundaries (form fields, separators).
- `--border-strong` — emphasized boundaries (hover, table heads,
  focus surrounds).

**Focus (1).**

- `--focus-ring` — keyboard-focus indicator color. Own slot, not
  aliased to `--accent` — themes get tone control. When
  accent-override fires on accent-overridable themes, the
  derivation algorithm sets `--focus-ring` from the user's accent;
  hand-authored themes set their own value.

**Selection (1).**

- `--selection-bg` — text-selection background. Load-bearing for a
  reading-heavy app; users will spend long sessions selecting prose.

**Pattern-driven (1).**

- `--recently-classified-bg` — full-color tint for the **fresh**
  state of the recently-classified row pattern (per
  [`../patterns/entity.md → Recently-classified row accent`](../patterns/entity.md#recently-classified-row-accent)).
  The fading-tier renders the same value at reduced alpha; spec in
  [Recently-classified slot](#recently-classified-slot) below.

The contract is **extensible.** Future patterns may add their own
slots under the same convention (`--<pattern>-<role>`); foundations
records each addition's existence and the per-pattern semantics.

## Contrast targets

WCAG-derived. Three rungs: text-on-background, non-text contrast
(WCAG 1.4.11 for UI components), faint-signal exception. The
[theme audit utility](#theme-audit-utility) checks every pair below.

### Text-on-background

| Pair                                                                           | Target      | Floor    | Notes                                                      |
| ------------------------------------------------------------------------------ | ----------- | -------- | ---------------------------------------------------------- |
| `--fg-primary` × `--bg-base`                                                   | **AAA 7:1** | AA 4.5:1 | body prose — the load-bearing pair                         |
| `--fg-primary` × `--bg-raised` / `--bg-sunken` / `--bg-overlay`                | AA 4.5:1    | AA 4.5:1 | text on cards / system-entry / popovers                    |
| `--fg-secondary` × `--bg-base`                                                 | AA 4.5:1    | AA 4.5:1 | captions, sub-labels                                       |
| `--fg-muted` × `--bg-base`                                                     | AA 4.5:1    | 3:1      | placeholders may relax to 3:1; other muted use aims higher |
| `--fg-disabled` × `--bg-disabled`                                              | 3:1         | 3:1      | WCAG exempts disabled; floor is "still readable"           |
| `--accent-fg` × `--accent`                                                     | AA 4.5:1    | AA 4.5:1 | button text — load-bearing for accent-override auto-flip   |
| `--success-fg` / `--warning-fg` / `--danger-fg` / `--info-fg` × their state bg | AA 4.5:1    | AA 4.5:1 | semantic pills / banners                                   |
| `--fg-primary` × `--selection-bg`                                              | AA 4.5:1    | AA 4.5:1 | text under text-selection                                  |
| `--fg-primary` × `--recently-classified-bg`                                    | AA 4.5:1    | AA 4.5:1 | row content with the classifier tint applied               |

The body-prose **AAA 7:1** target is reach-where-feasible.
Opinionated palettes that fail it (Catppuccin Latte and similar)
remain valid — AA 4.5:1 is the firm floor; AAA is documented as
"aim for it on body prose" so theme authors prioritize the right
pair when tuning. The audit utility reports both rungs separately.

### Non-text contrast (WCAG 1.4.11)

| Pair                                                          | Target | Notes                                                        |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `--border` × `--bg-base` and × `--bg-raised`                  | 3:1    | structural form-field / separator borders                    |
| `--border-strong` × `--bg-raised`                             | 3:1    | emphasized boundaries                                        |
| `--focus-ring` × `--bg-base` / `--bg-raised` / `--bg-overlay` | 3:1    | keyboard focus across every surface a control can land on    |
| `--accent` × `--bg-base`                                      | 3:1    | accent as button bg, perceivable as a control against canvas |
| `--selection-bg` × `--bg-base`                                | 3:1    | selection visible without text content as a tell             |

The focus-ring × accent pair is **not** in the audit set — the
locked focus recipe (below) renders rings with positive
`outline-offset`, so the ring sits on the surrounding canvas, not
on the button's accent fill.

### Faint-signal exception

- `--recently-classified-bg` × `--bg-base` — **author-judged.**
  Intentionally subtle; gating by a strict ratio fights the design
  intent (the tint must whisper, not shout). The audit utility
  surfaces the value but does not fail; review by eyeball at
  theme-author time.

## State treatments

Per-state recipes, locked at the contract level. Per-platform
glue (web `outline` vs native `box-shadow`) is implementation
detail; the **visual contract** is the same across surfaces.
Hover transition timing references the motion budget (session 5
deferral); section 3 commits which tokens swap, not the duration.

### Focus

- **Trigger.** `:focus-visible` semantics — keyboard focus only.
  Mouse-click activations skip the ring.
- **Ring.** 2px solid `--focus-ring`.
- **Offset.** 2px gap from element edge — ring sits outside the
  element on the surrounding canvas.
- **Applies to.** Any focusable interactive element — buttons,
  inputs, list rows, links, settings rows.

Implementation footnote: web (RN Web) renders via
`outline: 2px solid var(--focus-ring); outline-offset: 2px`. Native
(Expo) renders the same visual contract via
`box-shadow: 0 0 0 2px transparent, 0 0 0 4px var(--focus-ring)`
or RN's equivalent — the implementation pass picks the glue.

### Disabled

- **Surface.** `--bg-disabled`.
- **Foreground.** `--fg-disabled`.
- **Border.** Reuses `--border` (no separate disabled-border slot —
  the bg/fg shift carries the signal).
- **No hover.** Disabled controls don't fire hover transitions.
- **No focus ring.** Disabled controls aren't focusable; `tabindex`
  suppression is component-level.
- **Web-only nicety.** `cursor: not-allowed`. RN native ignores;
  the bg/fg signal is sufficient.

### Hover

Per-surface recipe — each rule names exactly which token swaps:

- **Primary buttons.** `bg: --accent → --accent-hover`. Foreground
  unchanged.
- **Secondary buttons.** `border: --border → --border-strong`.
  Background and foreground unchanged. (Stays subtle to keep
  secondary visually below primary on hover.)
- **List rows.** `bg: transparent → --bg-raised`. Text unchanged.
- **Inputs (not focused).** `border: --border → --border-strong`.
  Background unchanged.
- **Inline links.** Underline appears (text-decoration). Color
  unchanged — no `--link-hover` slot.
- **Disabled controls.** No hover effect.

### Active / pressed state

**Deferred.** No `--accent-active` slot. Most modern UI doesn't
distinguish hover from active visually beyond a motion-driven tap
pulse; if a real need surfaces, session 5 (motion) is the better
landing pad than adding a color slot here.

## Accent-derivation algorithm

Concrete constants for the JS function declared in
[`theming.md → Accent override (opt-in)`](./theming.md#accent-override-opt-in).
Runs at theme-application time when (a) the active theme has
`accentOverridable: true` AND (b) `app_settings.appearance.accentOverride`
is set.

### Function signature

```ts
function deriveAccent(
  accent: string, // user-supplied hex; e.g. "#7c3aed"
  mode: 'light' | 'dark', // from active theme's mode
  bgBase: string, // active theme's --bg-base
): {
  accentHover: string // → --accent-hover
  accentFg: string // → --accent-fg
  focusRing: string // → --focus-ring
  selectionBg: string // → --selection-bg
}
```

Pure function; identical on web and native; runs once at
theme-application (not per render).

### Color space choice

- **Hover delta** computed in HSL. Adjusting L is well-behaved and
  doesn't interpolate hue.
- **Selection-bg mix** computed in RGB (linear). Mixing two hues
  in HSL interpolates hue, producing unexpected intermediate
  colors; RGB linear interpolation is the standard "tint A toward
  B" math.
- **Auto-flip threshold** uses WCAG relative luminance (the
  0.0–1.0 perceptual lightness measure, not HSL `L`).

OKLCH is the modern alternative but adds a dependency and
complicates "identical on web + native" parity; HSL + RGB is
universally implemented and hand-rollable in ~30 lines. OKLCH
could be revisited later if real perceptual issues surface in
practice.

### Per-output algorithm

**1. `accentHover` — HSL lightness delta, mode-aware.**

```
hsl = toHSL(accent)
delta = mode === 'light' ? -10 : +10   // light themes darken; dark themes lighten
hsl.L = clamp(hsl.L + delta, 0, 100)
return toHex(hsl)
```

Magnitude `±10` (HSL L percentage points) is the locked constant.
5% is too subtle on muted hues; 15% jumps; 10% is consistently
perceivable across saturated and pastel inputs.

**2. `accentFg` — WCAG relative-luminance threshold, auto-flip.**

```
L_rel = relativeLuminance(accent)
return L_rel < 0.5 ? '#ffffff' : '#0a0a0a'
```

The 0.5 bisection is WCAG-canonical. `#0a0a0a` (not pure
`#000000`) avoids harsh contrast; symmetric with shadcn's pattern.
Hand-authored themes wanting a different fg shade keep
`accentOverridable: false`.

**3. `focusRing` — direct passthrough.**

```
return accent
```

No opacity reduction. Opacity dilutes the ring against canvas and
risks failing the 3:1 non-text contrast target; the 2px solid +
2px offset recipe carries the focus signal at full strength.

**4. `selectionBg` — RGB linear mix toward bgBase, mode-aware ratio.**

```
ratio = mode === 'light' ? 0.20 : 0.30  // accent share in the mix
rgb = lerpRGB(toRGB(bgBase), toRGB(accent), ratio)
return toHex(rgb)
```

Light themes: 80% canvas + 20% accent → pale accent tint. Dark
themes: 70% canvas + 30% accent → dimmed accent against dark
canvas. The asymmetry compensates for dark canvases needing more
accent saturation to perceive selection at all. Both ratios
preserve `--fg-primary` × `--selection-bg` ≥ 4.5:1 since
selection-bg stays close to bgBase.

### Constants summary

| Output        | Color space | Constant                                       |
| ------------- | ----------- | ---------------------------------------------- |
| `accentHover` | HSL         | `±10` L delta, sign by mode                    |
| `accentFg`    | WCAG L_rel  | threshold `0.5`; outputs `#ffffff` / `#0a0a0a` |
| `focusRing`   | —           | direct passthrough                             |
| `selectionBg` | RGB linear  | accent share `0.20` (light) / `0.30` (dark)    |

### Known limitations

- **Mid-luminance bgBase + accent-override.** A theme with
  `--bg-base` near mid-gray (HSL L around 50) produces a
  derived `--selection-bg` very close to canvas — potentially
  failing the 3:1 selection-visibility target. The audit utility
  surfaces this in its derivation sweep; theme authors of
  mid-luminance bgBase should not enable `accentOverridable: true`,
  OR the derived selection sits below 3:1 as a documented
  limitation. The contract doesn't try to "fix" this — the input
  combination is genuinely difficult.
- **Pure black / pure white as accent.** A user picking
  `#000000` or `#ffffff` produces `accentHover` clamped to the
  same value (no perceived hover state). Documented; not blocked.
  UX degrades gracefully.
- **Accent at exactly the WCAG 0.5 threshold.** The flip is
  deterministic (`< 0.5` → white, `>= 0.5` → near-black) — at the
  bisector, behavior is consistent run-to-run.

## Recently-classified slot

One slot, two visual states via opacity. Ties to
[`../patterns/entity.md → Recently-classified row accent`](../patterns/entity.md#recently-classified-row-accent).

### Slot

`--recently-classified-bg` — full-color value, theme-authored.
Used as the row background tint for the **fresh** state.

### Two-tier rendering

- **Fresh.** `bg: var(--recently-classified-bg)` — 100% color,
  the just-classified turn.
- **Fading.** `bg: color-mix(in srgb, var(--recently-classified-bg) 50%, transparent)`
  on web; equivalent runtime alpha at 50% on native — half-strength
  on the same color, the 1-2-turns-ago decay tier. After 2 turns,
  the class is removed; no tint.

Locked alpha for the fading tier: **0.5.** Empirically, 0.3 reads
invisible on most palettes; 0.7 doesn't read as decay; 0.5 is the
perceptual midpoint that works across light + dark + opinionated
themes without per-theme tuning.

### Detail-pane "Recently classified" badge

The row tint is mirrored in the entity detail pane as a "Recently
classified" badge in the same color (per `entity.md`). The badge
uses the **fresh** color directly at full strength regardless of
which tier the row is in — the badge presence is the signal; the
row tint carries the decay timing. Same slot, no second token.

### Theme-authoring guidance

The slot value should:

- Be perceivably distinct from `--bg-base` (the row sits on canvas
  and the tint must read).
- Stay subtle enough that long lists with multiple recently-
  classified rows don't visually shout.
- Support `--fg-primary` × `--recently-classified-bg` ≥ 4.5:1 —
  text on the row must remain readable.

The audit utility surfaces the bg × bg-base value but doesn't
gate; "subtle but visible" is judgment.

### Why one slot, not two

Two literal slots (`-fresh-bg` + `-fading-bg`) was rejected: every
theme would carry both, and there's no real palette case where the
fading state wants a hue _different_ from the fresh state. Reduced
opacity is the correct mental model. A generalized
`--decay-fade-alpha` user-orthogonal token was rejected as
premature — one consumer today, no second pattern queued. If a
future pattern's decay needs a different alpha, that pattern
introduces its own constant.

## Theme audit utility

Dev-only command that loads every registered theme, computes
contrast on every documented pair, runs `deriveAccent` over a
sample input set for accent-overridable themes, and prints a
pass/fail/warn table. **No CI gate at v1** — see
[Followups → Theme-audit CI gate](../../followups.md#theme-audit-ci-gate)
for the deferral rationale.

### Invocation

```
pnpm themes:audit
```

Lives as a script under `scripts/` (path TBD at implementation).
Reads from the theme registry (`lib/themes/index.ts` or wherever),
runs the checks, prints to stdout.

### What it checks per theme

For each theme in the registry:

1. **Text-on-bg pairs.** Every pair in
   [Contrast targets → Text-on-background](#text-on-background) —
   computes WCAG contrast ratio. Reports against the **floor**
   column (failure = below floor) and against the **target**
   column (warning = below target but above floor).
2. **Non-text pairs.** Every pair in
   [Contrast targets → Non-text contrast](#non-text-contrast-wcag-1411) —
   computes contrast, fails below 3:1.
3. **Faint-signal pair.** `--recently-classified-bg` × `--bg-base` —
   reports the contrast value for review; **never fails**.
4. **Accent-overridable themes only — derivation sweep.** Runs
   `deriveAccent` against a fixed sample set (saturated red
   `#dc2626`, blue `#2563eb`, green `#16a34a`, plus pastel
   variants) and checks each derived `--accent-fg` × `--accent`
   pair clears 4.5:1 and `--fg-primary` × `--selection-bg` clears
   the 3:1 selection-visibility target. Surfaces inputs where the
   derivation produces a sub-floor pair.

### Output shape

Plaintext table per theme. Columns: **pair**, **ratio**,
**status** (`pass` / `warn` / `fail`). Footer summary: total fails
per theme; **exit code 0 even on fails** (no CI gate).

### Out of scope

- **CI integration.** Parked until session 6 + real palette data
  informs the gate's shape.
- **Multi-theme cross-check.** No "are these two themes
  consistent" check — themes are independent palettes.
- **Visual regression.** Not the audit utility's job.
- **Auto-fix.** Audit reports; theme authors fix. No
  proposed-color suggestions in v1.
