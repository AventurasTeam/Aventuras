# Spacing

The spatial contract for v1. Sister to [`tokens.md`](./tokens.md)
(slot inventory across all classes), [`color.md`](./color.md),
and [`typography.md`](./typography.md). This file commits the
base unit + spacing scale, component-internal padding tokens,
radii vocabulary, depth metaphor (how surfaces communicate
elevation), and the density toggle's cut record.

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

Token-minted spacing is reserved for **component-internal padding
that needs cross-component consistency.** A list row's vertical
padding should be the same in the reader's Browse rail, the
World panel's list pane, the Plot panel — minting a token
(`--row-pad-y`) gives one source of truth that changes in one
place.

### Component-internal padding tokens

Single values (no density variants — the density toggle was cut
at this session; see [Density toggle — cut](#density-toggle--cut)
below):

| Token            | Value | Use                                 |
| ---------------- | ----- | ----------------------------------- |
| `--row-pad-y`    | 10 px | list / table row vertical padding   |
| `--row-pad-x`    | 12 px | list / table row horizontal padding |
| `--input-pad-y`  | 8 px  | form input vertical padding         |
| `--input-pad-x`  | 12 px | form input horizontal padding       |
| `--button-pad-y` | 8 px  | button vertical padding             |
| `--button-pad-x` | 14 px | button horizontal padding           |

Six tokens. Calibrated for ~14–16 px text (UI body / labels at
the locked type scale); comfortable on desktop without cramping
mobile.

### Tap-target on native — `hitSlop` recipe

Buttons at `--button-pad-y: 8 px` + `--text-sm` 20 px line-height
= **36 px visible height**. iOS HIG calls for 44 × 44 pt minimum
tap-target; Android Material guidelines call for 48 dp. The
contract specifies **visible** size; native components expand the
**tap zone** beyond the visible boundary via RN's `hitSlop` prop
(or equivalent padding-around-pressable on web). A 36 px button
with 4 px `hitSlop` on each side renders 36 px visually but
registers a 44 px touch zone — meets iOS HIG without enlarging
the visible button.

Same recipe applies to `--row-pad-y` (40 px row height) and
`--input-pad-y` (36 px input height) — `hitSlop` on native
expands tap zones; no contract changes.

This is implementation-pattern guidance, not a contract slot.
Components that pressable-wrap their visible contents are
responsible for declaring `hitSlop`; the design contract
guarantees the visible-size baseline.

### Spacing — what this commits

- Six component-internal padding tokens, single values each.
- 4 px base unit, Tailwind-aligned.
- Tailwind utilities (`gap-N`, `p-N`, etc.) for the long tail of
  spacing — no semantic spacing-scale tokens minted.
- No density variants. Final list for v1.

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

## Density toggle — cut

Density (`comfortable` / `compact` toggle on
`app_settings.appearance.density`) was reserved at session 1 with
an explicit cut-path; session 4 evaluates and cuts.

**Decision: single density posture for v1.** Component-internal
padding tokens (above) carry single values calibrated for both
mobile and desktop. No user setting; no UI control; no token
variants.

### Rationale

- Marginal value real but not pressing. Compact-mode hasn't been
  load-bearing in any wireframe across reader, world, plot,
  story-list, app/story settings, wizard, or onboarding.
- Cost: 2× visual-test footprint across every UI pass; Storybook
  stories per mode; ongoing QA tax against an axis of variation
  that doesn't directly serve the reading-heavy core.
- v1 scope is aggressive; every axis of variation is friction.
- Re-adding later is a one-field migration if mobile demand
  surfaces post-v1 — same shape as session 2's accent-override
  addition (one field, one UI control, mechanical PR).

### Re-adding path

Not tracked as a parked entry — re-adding is reversible by the
standard "if mobile users ask for compact density post-v1"
signal. The work is mechanical: one field on
`app_settings.appearance`, two-variant padding tokens, one UI
control. No design needs deferring; the door is closed for now.
