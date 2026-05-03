# Spacing

The spatial contract for v1. Sister to [`tokens.md`](./tokens.md)
(slot inventory across all classes), [`color.md`](./color.md),
and [`typography.md`](./typography.md). This file commits the
base unit + spacing scale, component-internal padding tokens,
radii vocabulary, depth metaphor (how surfaces communicate
elevation), and the density toggle (three-density user setting,
reinstated post-cut by Phase 2 Group B).

## Base unit + spacing scale

### Base unit

**4 px.** Aligns with Tailwind 3's default scale (each `1` step =
`0.25rem` = 4 px) and NativeWind's runtime utility output.
Picking 8 px would conflict with Tailwind's defaults and force
every utility translation; 4 px is the path of least resistance
and the modern web baseline.

### Spacing usage — utilities first

Most spacing in components is **arbitrary application of the
Tailwind scale via utilities** — `gap-2` (8 px), `p-4` (16 px),
`mt-6` (24 px), etc. These cover the long tail of layout work
without minting tokens.

Token-minted spacing is reserved for **component-internal
sizing that needs cross-component consistency.** A list row's
vertical padding should be the same in the reader's Browse rail,
the World panel's list pane, the Plot panel — minting a token
(`--row-py-md`) gives one source of truth that changes in one
place. The token is also density-aware (per
[Density toggle](#density-toggle) below) — the value swaps with
active density, but every consumer reads from the same slot.

### Component-internal sizing tokens — density-aware

Density-aware tokens carry **three variants** keyed off the active
density (`compact` | `regular` | `comfortable`); see
[Density toggle](#density-toggle) below for resolution + tier
defaults. Two classes:

**Height-driven tokens** for fixed-height controls (Trigger,
Button, Input — anything where a tap-target SLA matters):

| Token            | compact | regular | comfortable | Use                   |
| ---------------- | ------- | ------- | ----------- | --------------------- |
| `--control-h-xs` | 32 px   | 36 px   | 40 px       | dense chrome controls |
| `--control-h-sm` | 36 px   | 40 px   | 44 px       | compact form controls |
| `--control-h-md` | 40 px   | 44 px   | 48 px       | default form controls |
| `--control-h-lg` | 44 px   | 48 px   | 56 px       | hero CTAs             |

**Padding-driven tokens** for rows (list rows, item rows, where
content varies and row height emerges from content + padding):

| Token         | compact | regular | comfortable | Use                        |
| ------------- | ------- | ------- | ----------- | -------------------------- |
| `--row-py-xs` | 4 px    | 8 px    | 10 px       | dense rows                 |
| `--row-py-sm` | 6 px    | 10 px   | 12 px       | compact rows               |
| `--row-py-md` | 6 px    | 12 px   | 16 px       | default rows               |
| `--row-py-lg` | 8 px    | 16 px   | 20 px       | spacious rows              |
| `--row-px-xs` | 6 px    | 8 px    | 10 px       | dense rows (horizontal)    |
| `--row-px-sm` | 8 px    | 10 px   | 12 px       | compact rows (horizontal)  |
| `--row-px-md` | 8 px    | 12 px   | 16 px       | default rows (horizontal)  |
| `--row-px-lg` | 12 px   | 16 px   | 20 px       | spacious rows (horizontal) |

Why hybrid: controls with a tap-target SLA need explicit height
enforcement; pure padding math doesn't guarantee final pixel
height once font-rendering and border quirks creep in. Rows
have variable content (single-line label, label + description)
so a fixed row height would either crop content or waste space;
padding scales with density and the row absorbs whatever content
height results.

Tailwind utility shorthand exposed via `tailwind.config.js`
(`h-control-md`, `py-row-y-md` etc.) — primitives use the
utility once; density shifts swap the underlying CSS var on web
and the lookup-table value on native.

### Tap-target on native

The `regular` density (mobile default) sets `--control-h-md` to
44 px, which meets iOS HIG's 44 pt minimum without `hitSlop`
gymnastics. `comfortable` density bumps to 48 px (also meets
Android Material's 48 dp guidance). `compact` density at 40 px
sits below HIG, but it's the **desktop default** where mouse
precision settles the question; phone users on `compact` are
explicitly opting below HIG (a deliberate user choice).

`hitSlop` is no longer the primary mechanism for HIG compliance
post-density-reinstatement — visible size handles it on the
default densities for each tier. Components may still use
`hitSlop` for sub-`xs`-sized affordances (icon-only icon buttons
at `--control-h-xs`, etc.) where visible size is intentionally
small.

### Spacing — what this commits

- Density-aware sizing tokens (height-driven for controls,
  padding-driven for rows) carrying three variants per token
  (`compact` / `regular` / `comfortable`).
- 4 px base unit, Tailwind-aligned.
- Tailwind utilities (`gap-N`, `p-N`, etc.) for the long tail of
  spacing — no semantic spacing-scale tokens minted beyond the
  density-aware ones above.

## Radii vocabulary

Four tokens, structurally locked (constant across themes per the
[token-class taxonomy](./tokens.md#three-classes)):

| Token           | Value   | Use                                                           |
| --------------- | ------- | ------------------------------------------------------------- |
| `--radius-sm`   | 4 px    | small chrome — buttons, inputs, badges, pills (when not full) |
| `--radius-md`   | 8 px    | cards, list rows, panels                                      |
| `--radius-lg`   | 12 px   | major panels, modals, dialogs                                 |
| `--radius-full` | 9999 px | pills, avatar circles, status indicators                      |

Three sized steps + one full. Tailwind-aligned with a slight bump
from Tailwind 3's defaults (`rounded-sm` 2 px, `rounded-md` 6 px,
`rounded-lg` 8 px) for a contemporary feel without crossing into
"designer playground" territory.

The "flat, nothing flashy" identity reads as **moderate radii
consistently applied** — not zero (which feels stark and
brutalist), not large (which feels playful and busy). 4 / 8 / 12
strikes the middle.

No `--radius-none` / `0` token — when a surface needs sharp
corners, components reference `0` directly. A token would be
dead weight.

### Why radii aren't themeable

Locked, not themeable. Radii are part of the app's geometry
identity, not a theme's color identity. A theme that wants
sharper geometry would change too much of the visual language to
read as a theme rather than a fork. If real demand surfaces,
foundations could add themeable radii later — one Theme-interface
field, mechanical work. Not in v1.

### Radii — what this commits

- Four radii tokens, locked values.
- Structurally locked — no per-theme variation.
- No themeable radii in v1.

## Depth metaphor

The most distinctive design call of session 4. Locks how surfaces
communicate elevation in a "flat, nothing flashy" identity.

### Recipe — pure flat

**Zero shadow tokens ship in v1.** Surfaces communicate elevation
through:

1. **Color delta.** `--bg-overlay` is rendered slightly differently
   from `--bg-base` (per the locked color contract — a small
   luminance / hue offset). Modals and popovers are visually
   distinguishable from the canvas via the overlay surface color
   alone.
2. **Borders.** `--border` and `--border-strong` outline elevated
   surfaces. A modal sitting on canvas has a `--border-strong`
   outline; a popover has `--border`. Boundary is unambiguous
   without any blur or shadow.
3. **Backdrop scrim.** Modals (which fully overlay the canvas) get
   a semi-transparent scrim layer between the canvas and the
   modal — `rgba(0, 0, 0, 0.4)` over the entire viewport on light
   themes, `rgba(0, 0, 0, 0.6)` on dark. The scrim communicates
   "interactive content is paused below"; the modal sits on top
   of it. Scrim is rendered at a fixed mode-dependent value, not a
   theme variable.
4. **Position only — popovers.** Popovers and dropdowns rely on
   color-delta + border alone (no scrim). Their bounded position
   (anchored to a trigger) carries enough "above" signal.

### Why pure flat

- **Identity match.** "Flat, nothing flashy" is an explicit
  aesthetic choice; shadows are flashy by definition. Zero-shadow
  ships the identity unambiguously.
- **Cross-platform parity.** RN's shadow story is platform-specific
  (iOS uses `shadow*` props, Android uses `elevation`, Web uses
  `box-shadow`). Zero shadows means we don't fight cross-platform
  parity at the contract level.
- **Accessibility.** Shadow-based elevation cues fail for users
  with vision conditions where blur reads as visual noise. Color
  - border is a stronger affordance.
- **Theme authoring is easier.** Theme authors only tune
  `--bg-overlay` color; no shadow values to calibrate per palette.

### Theme-authoring guidance — overlay perceptibility

`--bg-overlay` should be perceptibly distinct from `--bg-base` —
otherwise modals look stuck against the canvas. Recommended floor:
**1.3:1 luminance ratio** between `--bg-overlay` and `--bg-base`
(soft check; not a hard fail). The session 2 audit utility (per
[`color.md → Theme audit utility`](./color.md#theme-audit-utility))
is the natural home for this check; folds into that work as a
warning when implementation begins. No new followup needed — the
existing audit utility is the carrier.

### Pure-black canvas — known limitation

A theme with `--bg-base: #000000` makes the scrim
(`rgba(0, 0, 0, 0.4)`) fully invisible — modal looks unanchored
on a black canvas. Resolution: theme authors avoid pure-black
canvases (already implicit — system fonts render poorly on
`#000000`, and the `--fg-primary × --bg-base` AAA target from
[`color.md → Contrast targets`](./color.md#contrast-targets)
nudges toward `#0a0a0a`-ish dark canvases anyway). Documented as
a known limitation; v1 contract doesn't add a per-theme scrim
slot. If real demand surfaces, `--scrim-bg` becomes a slot.

### What if a theme wants shadows?

A future opinionated theme that craves a Material-style elevation
can add its own shadow CSS at theme-author level (CSS in the
theme module's stylesheet, not a foundations slot). The contract
doesn't ship the slot; themes that want shadows pay their own
way. If three themes plus user demand surface this in v2,
foundations adds a `--shadow-overlay` slot — a one-line contract
change.

### Depth — what this commits

- **Zero shadow tokens in the foundations contract.**
- Modals = `--bg-overlay` + `--border-strong` + scrim.
- Popovers = `--bg-overlay` + `--border`, no scrim.
- Fixed mode-dependent scrim values: `rgba(0, 0, 0, 0.4)` light /
  `rgba(0, 0, 0, 0.6)` dark.

## Density toggle

Three densities — `compact` / `regular` / `comfortable` — drive
the sizing tokens above. User-controllable via
`app_settings.appearance.density` with a sentinel `'default'`
value selecting per-tier defaults:

| Tier          | Default density              |
| ------------- | ---------------------------- |
| Desktop       | `compact` (40 px control-md) |
| Phone, tablet | `regular` (44 px control-md) |

The toggle is **universal** — all three values selectable on
every tier. Defaults differ per tier; user override applies the
chosen value regardless of tier. A phone user can pick `compact`
(below HIG, deliberate); a desktop user can pick `comfortable`
(chunky on desktop but enabling for accessibility).

### Resolution

```
density = (settings.appearance.density === 'default')
  ? (tier === 'desktop' ? 'compact' : 'regular')
  : settings.appearance.density
```

The sentinel `'default'` lets us change tier-default rules later
without migrating user data — anyone who hadn't explicitly picked
a density picks up the new default automatically.

**Web (Storybook + Electron):** root element gets
`data-density="compact|regular|comfortable"` from a Provider.
CSS vars defined per `[data-density="X"]` block; theme cascade
(via `[data-theme]`) is independent and composes orthogonally.

**Native (Expo):** `useDensity()` hook returns the resolved
density string; primitives map to literal token values via a
`densityTokens[density]` lookup table.

### Surfaces

User-facing toggle surfaces in two places:

- **Onboarding Step 1** as a third field alongside Language and
  Theme.
- **App Settings → Appearance** for post-onboarding adjustment.

Both controls render via Select (cascade-driven). Labels:
"Default" (recommended), "Compact", "Regular", "Comfortable".
Subtitle for "Default" explains the rule: "Compact on desktop,
Regular on phone and tablet."

### History — cut + reinstatement

Density was originally reserved at session 1 of the visual
identity foundations work, then **cut** at session 4. The cut
rationale at the time: compact-mode wasn't load-bearing in any
wireframe; 2× visual-test footprint felt unaffordable for v1
scope; "if mobile users ask for compact density post-v1" was
listed as the signal for reinstatement.

**Reinstated at Phase 2 Group B (2026-05-03)** for a different
reason than the original signal anticipated: phone-tier sizing
forced the variation onto us anyway (44 pt iOS HIG minimum on
phone vs. denser desktop sizing). Once tier-responsive sizing
became necessary, exposing it as a user-controlled toggle with
tier-default fallback added marginal cost — settings field +
UI control — over the variation we'd already need to test.
Promoting "tier-responsive" to "density-as-toggle" gave users
override flexibility (accessibility on desktop, density on
mobile) for that marginal cost.

The original cut record's "mechanical PR" estimate held — the
reinstatement landed as one design-pass exploration + one
canonical-doc integration commit + one implementation commit.
