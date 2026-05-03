# Visual identity — curated theme palettes (session 6)

Final session of the multi-session visual-identity design pass (per
[`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions)).
Sessions 1–5 locked the architecture, slot inventory, contrast
targets, derivation algorithm, font stacks, type scale, spacing,
radii, depth metaphor, iconography vocabulary, and motion budget.
This session **authors the curated gallery** — concrete palettes
that every slot inventory finally consumes.

The canonical home is the new
[`../ui/foundations/themes.md`](../ui/foundations/themes.md). This
file is the exploration record carrying the design narrative + the
adversarial findings.

## Decisions locked entering this session

- **25-slot inventory** (per session 2 in
  [`color.md`](../ui/foundations/color.md)).
- **Three font-family slots** with system-stack defaults (per
  session 3).
- **Theme data shape** — `Theme.id`, `name`, `nameKey?`, `mode`,
  `description?`, `family?`, `accentOverridable?`,
  `leadingMultiplier?`, `tokens.colors`, `tokens.fonts?` (per
  session 1 in [`theming.md`](../ui/foundations/theming.md)).
- **Mode-locked themes.** Each theme declares `mode: 'light' | 'dark'`
  at compile time; no per-theme app toggle.
- **Accent override is opt-in per theme.** Curated themes leave
  `accentOverridable: false` by default; only the neutral defaults
  flip it on.
- **Pure-flat depth metaphor.** Theme palettes don't ship shadow
  tokens; depth is communicated via `--bg-raised` / `--bg-overlay`
  - borders + a fixed mode-aware scrim.

## Gallery — final composition

**10 themes total. 3 light : 7 dark.** Composition shape locked
at Q3-Q4 of the dialogue:

| #   | id                    | name                | mode  | family     | source                       | accent-overridable |
| --- | --------------------- | ------------------- | ----- | ---------- | ---------------------------- | ------------------ |
| 1   | `default-light`       | Default Light       | light | Default    | original                     | **yes**            |
| 2   | `default-dark`        | Default Dark        | dark  | Default    | original                     | **yes**            |
| 3   | `parchment`           | Parchment           | light | —          | original                     | no                 |
| 4   | `catppuccin-latte`    | Catppuccin Latte    | light | Catppuccin | established                  | no                 |
| 5   | `catppuccin-mocha`    | Catppuccin Mocha    | dark  | Catppuccin | established                  | no                 |
| 6   | `tokyo-night`         | Tokyo Night         | dark  | —          | established                  | no                 |
| 7   | `royal`               | Royal               | dark  | —          | original                     | no                 |
| 8   | `cyberpunk`           | Cyberpunk           | dark  | —          | original (port — color-only) | no                 |
| 9   | `fallen-down`         | Fallen Down         | dark  | —          | original (port)              | no                 |
| 10  | `aventuras-signature` | Aventuras Signature | dark  | —          | original (icon-keyed)        | no                 |

### Composition rationale

- **Two neutral defaults + Parchment as the anchor original.** The
  defaults are the accent-overridable base pair; Parchment is the
  warm-light writing-app archetype already named in
  [`theming.html`](../ui/foundations/theming.html)'s placeholder
  set. These three carry the "curated set of intent" across modes.
- **Catppuccin pair.** Same hue family across light + dark gives
  users a "stable identity, switch mode" experience that no other
  modern palette delivers as well. Latte is the canonical light
  Catppuccin entry; Mocha is the canonical dark.
- **Tokyo Night as a second saturated dark.** Distinct mood from
  Mocha's warm pastel — cooler, more neon-edge — without the
  effects-overlay scope creep that would come with the unedited
  Cyberpunk port.
- **Royal as a deeper-fantasy original.** Deep purple + gold;
  occupies the "period / gilded / fantasy-narrative" slot the
  rest of the gallery doesn't touch.
- **Cyberpunk as color-only port.** Old-app neon palette
  (cyan + pink + dark navy) without the animated CRT scanline /
  radial vignette / text-glow overlays that violate the locked
  flat-identity per
  [`spacing.md → Depth metaphor`](../ui/foundations/spacing.md#depth-metaphor)
  - [`principles.md → flat, nothing flashy`](../ui/principles.md).
- **Fallen Down as starkest aesthetic.** Pure black + neon
  yellow + monospace prose. Old-app port without bundled VT323
  pixel font; the system monospace stack carries the aesthetic.
  Niche but distinctive.
- **Aventuras Signature as brand statement.** Deep navy +
  warm cream, keyed directly to the app icon. Two-color identity
  (cream serves as both `--fg-primary` and `--accent`); inverted
  partner to Parchment (same colors, swapped roles).

### Cuts

Two old-app candidates considered and dropped:

- **Botanical / Ocean Breeze / Pastel Dreams / Rose Pine variants /
  Gruvbox / Nord / Solarized / Dracula / Retro Console / OLED**
  (all from old app). Cut for v1 to keep the gallery shape
  intentional rather than "everything we have." Several of these
  are excellent palettes; if signal surfaces post-launch (users
  asking for a specific named theme), they're cheap to add — same
  shape, drop into the registry.
- **Cyberpunk effects** (scanlines / vignette / text-glow). The
  effects don't fit v1's flat-nothing-flashy identity. Color-only
  port preserves the neon palette without the scope creep.
- **Fallen Down's bundled VT323 font.** Dropped per user
  preference; fallen-down ships with system monospace. Pixel
  fidelity loss accepted.

## First-launch default

`themeId: 'default-light'`. Safest cross-platform first-impression
— a light theme on first boot doesn't surprise anyone (Linux /
Windows / mac / iOS / Android all default-light on system level).
Despite the gallery's 3:7 light:dark skew and the user's
self-acknowledged dark bias, the _first-launch_ shouldn't presume
a preference the user hasn't expressed.

After first launch, the choice persists in
`app_settings.appearance.themeId` per
[`theming.md → Persistence`](../ui/foundations/theming.md#persistence).

## Authoring conventions per theme

Each theme module declares the 25 color slots, optional font
slots, the theme metadata fields, and (where applicable)
`accentOverridable: true`. The canonical
[`themes.md`](../ui/foundations/themes.md) carries the values; TS
modules under `lib/themes/<id>/<id>.ts` are the implementation
sources of truth. The audit utility (per
[`color.md → Theme audit utility`](../ui/foundations/color.md#theme-audit-utility))
runs over all 10 themes.

### Slot-mapping rules common to every theme

- **Disabled pair.** `--bg-disabled` = a neutralized version of
  `--bg-raised` (slightly desaturated, slightly toward `--bg-base`);
  `--fg-disabled` = a desaturated `--fg-muted`. WCAG exempts disabled
  controls from the AA floor; recipe targets 3:1 to stay readable.
- **Border slots.** `--border` = subtle delta from `--bg-raised`;
  `--border-strong` = ~1.5–2× the delta. Clears 3:1 non-text
  against both `--bg-base` and `--bg-raised`.
- **Selection bg.** Hand-authored on opinionated themes; derived
  via the algorithm on accent-overridable themes when the user
  customizes accent.
- **Recently-classified bg.** Authored as a subtle warm tint
  perceivably distinct from `--bg-base` but not loud against
  `--fg-primary` (clears AA 4.5:1 against text).

### Reading-font behavior

Most themes inherit the `--font-reading` serif system stack from
defaults (per typography.md). Two themes override:

- **Parchment** — keeps the serif default but explicit about it
  (the writing-app archetype demands it).
- **Fallen Down** — overrides to a monospace stack:
  `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.
  Stark / void / pixel-tribute identity demands monospace prose.
  No bundled font; the system monospace carries.

## Theme-by-theme intent

### 1. Default Light

Neutral, lightweight, accent-overridable. Off-white canvas
(`#fdfdfd`-ish, not pure white — easier on the eye than `#ffffff`),
near-black text, soft borders. Default accent picks the canonical
shadcn blue (`#3b82f6`) — familiar, AAA-clearing on accent-fg
auto-flip. User changes accent → derivation algorithm cascades.

### 2. Default Dark

Neutral charcoal canvas (`#0e0f10`-ish, near-true-neutral with
barely-cool tint), bright-but-not-glaring text. Default accent
mirrors Default Light (canonical blue) so the accent-override
picker behaves predictably across modes. User-bias-checked: the
dark theme should be **truly neutral** rather than slate-blue —
the accent override needs the canvas not to fight whatever hue
the user picks.

### 3. Parchment

Warm cream paper canvas (`#f5e6c4`-ish), deep ink-brown text
(`#3a2818`-ish), russet accent (`#8b3a14`-ish). Reads as
hand-pressed paper + dip-pen ink. Serif explicit (Charter /
Iowan / Source Serif at top of the stack — the system serifs
that look most like print). Pairs with Aventuras Signature as
inverted partners (same brand colors, light-mode vs dark-mode).

### 4. Catppuccin Latte

Canonical Catppuccin Latte values verbatim (Base `#eff1f5`, Text
`#4c4f69`, accent Blue `#1e66f5`). Soft pastel light theme; warm
without being parchment. Catppuccin mascot recognition for users
familiar with it from IDE / terminal use. Per
[`color.md → Body-prose AAA target`](../ui/foundations/color.md#text-on-background),
Latte fails the AAA 7:1 target on `--fg-primary` × `--bg-base`
(the canonical pair clears AA 4.5:1 but not AAA). **Documented
exemption** rather than tuned-against-spec; Catppuccin's published
identity is preserved.

### 5. Catppuccin Mocha

Canonical Catppuccin Mocha values (Base `#1e1e2e`, Text `#cdd6f4`,
accent Mauve `#cba6f7`). Picked Mauve over Blue for v2 because
Tokyo Night already occupies the blue-accent dark slot — Mauve
gives Mocha distinct character. Same body-prose AAA exemption as
Latte: documented, not tuned.

### 6. Tokyo Night

Canonical Tokyo Night Night-variant values (bg `#1a1b26`, fg
`#c0caf5`, accent Blue `#7aa2f7`). Cool saturated dark — distinct
mood from Mocha's warm pastel. Borders slightly more saturated
than canonical to clear 3:1 non-text against `--bg-base` per
v2's contract.

### 7. Royal

Original. Deep purple canvas (`#0d0216` near-black-purple), warm
foreground (`#f3e8ff` lavender-cream), gold accent (`#fbbf24`).
Period / gilded / fantasy-narrative coded. The gold accent
auto-flips to dark `--accent-fg` (gold's relative luminance is
above 0.5, so near-black text per the algorithm). Old-app port
with v2-contract slot mapping; canvas pulled darker than old-app
`#0d0216` for AAA on body prose against the lavender foreground.

### 8. Cyberpunk

Color-only port. Deep navy canvas (`#0d1326`), bright cyan-white
text (`#e0f7fa`), neon cyan accent (`#00f0ff`). Old-app's
neon-yellow + neon-pink supplementary palette — `--warning` →
neon yellow, `--info` → neon pink — gives semantic states
distinct cyberpunk character without needing the global
animated overlays. Sharp-edge identity (radius 0) is **not**
preserved per session-4's structurally-locked radii — cyberpunk
inherits the same `--radius-sm` 4px / `-md` 8px etc. as everything
else.

### 9. Fallen Down

Original-port. Pure-black canvas (`#000000`), pure-white text
(`#ffffff`), neon yellow accent (`#ffff00`). System monospace
prose. Stark / void / Undertale-tribute coded. Same radius
constraint as Cyberpunk — sharp edges not preserved; the radii
soften the pixel-aesthetic but the black + white + yellow + mono
combo carries the identity.

### 10. Aventuras Signature

Original. Deep navy canvas (`#0e2240`) keyed to the
[app icon](../../assets/images/icon.png) — same hue. Warm cream
foreground (`#d4c9a8`, muted from icon's `#ede5cc` brightest
cream by ~11 L points — easier on long-session eyes). **Two-color
identity:** `--fg-primary` and `--accent` are both the muted
cream. Buttons render as cream-on-navy with auto-flipped
near-black text — striking inversion that signals the brand
statement. Pairs with Parchment as the brand's inverted
partners.

## Adversarial-pass findings

### Audit-utility expectations across the gallery

Pre-running the audit mentally against the chosen palettes:

- **Default Light / Default Dark** — clear AAA on body prose by
  design (default accent is canonical-shadcn blue, no risk).
- **Parchment** — clears AAA on body prose (deep-ink × cream-paper
  is exactly what AAA was tuned for).
- **Catppuccin Latte** — body prose sits **right at the AAA 7:1
  threshold** (`#4c4f69` × `#eff1f5` ≈ 7.0:1 — Catppuccin's
  canonical values land at the edge). Audit utility may report
  `pass` or `warn` depending on rounding; either way clears AA
  4.5:1 with margin.
- **Catppuccin Mocha** — clears AAA on body prose
  (`#cdd6f4` × `#1e1e2e` ≈ 11.3:1).
- **Tokyo Night** — clears AAA on body prose (canonical
  `#c0caf5` × `#1a1b26` ≈ 9.5:1).
- **Royal** — clears AAA after canvas-darkening adjustment.
- **Cyberpunk** — `#e0f7fa` × `#0d1326` ≈ 16.5:1, well above AAA.
- **Fallen Down** — pure white × pure black = 21:1 maximum
  contrast.
- **Aventuras Signature** — `#d4c9a8` × `#0e2240` ≈ 9.6:1, clears
  AAA.

**One theme (Catppuccin Latte) sits at the AAA 7:1 threshold on
body prose by canonical design** — depending on the audit
utility's rounding, it may report `pass` or `warn`. Either way,
the AA 4.5:1 floor clears with margin. Catppuccin Mocha actually
clears AAA with comfortable margin (~11:1) — the
preservation-of-identity reasoning still applies to keep both
themes' canonical values verbatim. Per
[`color.md → Body-prose AAA target`](../ui/foundations/color.md#text-on-background),
sitting below the target but above the floor reports as `warn`,
not `fail`.

### Issues surfaced + resolved

- **Fallen-Down sharp-edge identity loss.** Verified:
  structurally-locked radii forbid theme-level override. Accepted
  as fidelity drop; the black/white/yellow/mono combination
  carries identity even with rounded corners. Not a contract-
  changing concern.
- **Cyberpunk effects scope creep.** Avoided by choosing the
  color-only port. If demand for theme-level animation effects
  surfaces post-launch, the contract can extend (likely as a new
  `Theme.runtime?` shape, declarative; not a v1 commitment). For
  now, themes carry only token values.
- **Aventuras Signature reading bg-base distinguishability.**
  `#0e2240` vs Tokyo Night's `#1a1b26`: ΔE perceivable but not
  large. Mood difference (saturated brand-navy vs neutral
  midnight) carries the distinction. User can A/B them in the
  picker.
- **Default Dark vs Aventuras Signature accent collision.**
  Default Dark's default accent is `#3b82f6` blue; Signature's
  accent is cream. Distinct enough; no actual collision.
- **`accentOverridable` interaction with non-default themes.**
  All 8 opinionated themes set `accentOverridable: false`;
  switching from a custom-accent default theme to an opinionated
  theme silently shelves the override (it persists in
  `app_settings.appearance.accentOverride` but isn't applied)
  per [`theming.md → Accent override`](../ui/foundations/theming.md#accent-override-opt-in).
  Verified.
- **`leadingMultiplier` per theme.** Most themes: 1.0 (sans /
  serif system stack default leading is fine). Parchment:
  optional 1.05 escape if reading-line-height feels tight on the
  serif body — kept at 1.0 for v1, revisitable. Fallen Down:
  monospace fonts often look tighter than serifs at the same
  multiplier; left at 1.0 because the niche-aesthetic surface
  doesn't have marathon-reading expectations.
- **i18n behavior across the gallery.** Per
  [`theming.md → Translation of theme names`](../ui/foundations/theming.md#translation-of-theme-names):
  Default Light, Default Dark, Parchment, Aventuras Signature
  declare `nameKey` for i18next localization. Catppuccin Latte,
  Catppuccin Mocha, Tokyo Night, Royal, Cyberpunk, Fallen Down
  omit `nameKey` (proper-noun identities; localization would
  damage recognition). Verified.

### What didn't get asked

- **Color-blindness sims across the gallery.** Not run. v1
  contract relies on contrast targets + non-color signals
  (icons, position, text). Worth a follow-on pass once real users
  report friction. **Not parked** — implicit in the audit utility's
  future expansion scope.
- **HDR / wide-gamut behavior.** Themes ship sRGB-only hex; HDR
  displays render fine as standard sRGB. Wide-gamut authoring
  is out of scope for v1.
- **Per-platform native scrollbar / form-control colors.** Per
  [`theming.md → Switching mechanism`](../ui/foundations/theming.md#switching-mechanism),
  `data-theme-mode` attribute drives platform-native CSS that
  reacts. Themes don't author scrollbar-thumb colors — system
  defaults follow the mode attribute. Verified — old-app
  per-theme scrollbar overrides are intentionally dropped.

## Followups generated

None this session, but **two existing followups become ripe**:

- **[Theme-audit CI gate](../followups.md#theme-audit-ci-gate)** —
  was deferred until session 6 lands. Now ripe for its own design
  pass with real palette data informing the gate's exempt-list
  shape (Catppuccin variants are the obvious exempt candidates).
  Followup retained but its "deferred until session 6 lands"
  rationale updates to "ripe for design pass."
- **NativeWind runtime theme-swap parity** — load-bearing for the
  10-palette gallery on native. Resolved during phase 1 foundations
  bring-up; characterization recorded in
  [`theming.md → Switching mechanism`](../ui/foundations/theming.md#switching-mechanism).

## Parked items added

None.

## Parked items resolved

None directly — session 6 doesn't resolve any parked entries; it
authors the gallery the gallery-pending architecture was waiting
for.

## Integration plan

### Files changed

- **NEW** [`../ui/foundations/themes.md`](../ui/foundations/themes.md) —
  canonical curated-gallery contract: roster, first-launch default,
  authoring conventions, per-theme intent + slot values + audit
  expectations, theme-author guidance for v1.5+ additions.
- **EDIT** [`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions) —
  flip session 6 from "pending" to "landed 2026-05-01" with link
  to this exploration record. Update Files inventory to add
  `themes.md`. Update closing note (foundations is feature-complete
  for v1).
- **EDIT** [`../ui/foundations/theming.md`](../ui/foundations/theming.md) —
  Two updates: (1) [First-launch defaults](../ui/foundations/theming.md#first-launch-defaults)
  replace "TBD at session 6" with `default-light`. (2) [Demo](../ui/foundations/theming.md#demo)
  description updates from "three placeholder palettes" to "the
  curated gallery."
- **EDIT** [`../ui/foundations/color.md`](../ui/foundations/color.md) —
  Lead paragraph updates "real curated palettes (with audit-
  passing values) land at session 6" to past tense referencing
  themes.md.
- **EDIT** [`../ui/foundations/theming.html`](../ui/foundations/theming.html) —
  Replace the three placeholder palette dropdown options (Default
  Light, Default Dark, Parchment) with the full 10-theme dropdown.
  Each dropdown option's `data-*` attributes declare the slot
  values per the curated palettes.
- **EDIT** [`../followups.md → Theme-audit CI gate`](../followups.md#theme-audit-ci-gate) —
  Update opening sentence: deferral is no longer "until session 6
  lands"; the gate is now ripe for its own design pass with real
  palette data.

### Renames

None.

### Patterns adopted on a new surface

None — themes.md is foundations-internal; doesn't cite a pattern
or per-screen surface.

### Followups resolved

None.

### Followups introduced

None.

### Wireframes updated

- **theming.html** — 10-theme dropdown replaces 3-palette stub.
  Per the [foundations wireframe-exemption](../ui/foundations/README.md#wireframe-convention-exemption),
  this demo is allowed to render real palettes (the rest of
  `screens/` stays monochrome).

### Intentional repeated prose

None planned.

### Exploration record fate

Keep at integration; frozen historical record per the
session-record convention.
