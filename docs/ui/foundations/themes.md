# Themes

The curated theme gallery for v1. Sister to
[`tokens.md`](./tokens.md) (slot inventory),
[`color.md`](./color.md) (slot values + contrast targets +
derivation algorithm), [`typography.md`](./typography.md) (font
stacks), and [`theming.md`](./theming.md) (data shape + runtime).
This file commits the **palettes themselves** — every slot,
every theme.

10 themes total: 3 light + 7 dark. Two accent-overridable neutral
defaults (Default Light / Default Dark) plus eight opinionated
palettes spanning warm-paper, soft-pastel, neon-saturated, deep-
fantasy, stark-aesthetic, and a brand-keyed signature.

## Gallery roster

| #   | id                    | name                | mode  | family     | source                     | accent-overridable |
| --- | --------------------- | ------------------- | ----- | ---------- | -------------------------- | ------------------ |
| 1   | `default-light`       | Default Light       | light | Default    | original                   | **yes**            |
| 2   | `default-dark`        | Default Dark        | dark  | Default    | original                   | **yes**            |
| 3   | `parchment`           | Parchment           | light | —          | original                   | no                 |
| 4   | `catppuccin-latte`    | Catppuccin Latte    | light | Catppuccin | established                | no                 |
| 5   | `catppuccin-mocha`    | Catppuccin Mocha    | dark  | Catppuccin | established                | no                 |
| 6   | `tokyo-night`         | Tokyo Night         | dark  | —          | established                | no                 |
| 7   | `royal`               | Royal               | dark  | —          | original                   | no                 |
| 8   | `cyberpunk`           | Cyberpunk           | dark  | —          | original (color-only port) | no                 |
| 9   | `fallen-down`         | Fallen Down         | dark  | —          | original (port)            | no                 |
| 10  | `aventuras-signature` | Aventuras Signature | dark  | —          | original (icon-keyed)      | no                 |

### First-launch default

`themeId: 'default-light'`. Safe cross-platform first impression
— a light theme on first boot doesn't presume a preference the
user hasn't expressed. Despite the gallery's 3:7 light:dark
ratio, the first-launch should not assume the user wants dark
immediately. After first launch, the choice persists in
`app_settings.appearance.themeId` per
[`theming.md → Persistence`](./theming.md#persistence).

### Cascade — theme and density compose orthogonally

Theme CSS scopes by `[data-theme="<id>"]` and density CSS scopes
by `[data-density="<value>"]`; the two cascades are independent
and compose freely. The CSS generator emits one `[data-theme]`
block per theme + one `[data-density]` block per density value,
and any `[data-theme]` ancestor combined with any `[data-density]`
ancestor resolves the full token surface (theme provides color
slots; density provides sizing slots). See
[`spacing.md → Density toggle`](./spacing.md#density-toggle) for
density tokens + resolution mechanism.

### Translation policy

Per [`theming.md → Translation of theme names`](./theming.md#translation-of-theme-names):

- **Declare `nameKey`** — Default Light, Default Dark, Parchment,
  Aventuras Signature.
- **Omit `nameKey`** — Catppuccin Latte, Catppuccin Mocha, Tokyo
  Night, Royal, Cyberpunk, Fallen Down (proper-noun identities;
  localization damages recognition).

## Authoring conventions

Every theme module declares the 25 color slots from
[`color.md → Final slot inventory`](./color.md#final-slot-inventory)
plus optional font-family overrides. Values render as CSS custom
properties at the document root (web / Electron) and via
NativeWind 4 runtime context (Expo native).

### Common slot recipes

- **Disabled pair.** `--bg-disabled` neutralizes `--bg-raised`
  toward `--bg-base`; `--fg-disabled` desaturates `--fg-muted`
  one more step. Targets 3:1 (WCAG-exempt; readable).
- **Border slots.** `--border` reads as a subtle delta from
  `--bg-raised`; `--border-strong` runs ~1.5–2× the delta. Both
  clear the 3:1 non-text floor against `--bg-base` and
  `--bg-raised`.
- **Recently-classified bg.** Authored as a warm tint
  perceivably distinct from `--bg-base` while still clearing
  AA 4.5:1 against `--fg-primary` per
  [`color.md → Recently-classified slot`](./color.md#recently-classified-slot).
- **Selection bg.** Hand-authored on opinionated themes; derived
  via `deriveAccent` per
  [`color.md → Accent-derivation algorithm`](./color.md#accent-derivation-algorithm)
  on accent-overridable themes when the user customizes accent.

### Reading-font policy per theme

Most themes inherit the `--font-reading` serif system stack from
[`typography.md → Default font stacks`](./typography.md#default-font-stacks).
Two override:

- **Parchment** — keeps the serif default but pins it explicitly
  in its `tokens.fonts` (the writing-app archetype demands serif).
- **Fallen Down** — overrides `--font-reading` to a monospace
  stack: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.
  Stark / void / pixel-tribute identity demands monospace prose.
  Bundled VT323 from old-app is **not** carried forward; the
  system monospace stack approximates the aesthetic without
  bundle cost.

### `leadingMultiplier` per theme

All 10 themes ship `leadingMultiplier: 1.0` for v1. The escape
valve exists in the contract per
[`typography.md → Per-font leading multiplier`](./typography.md#per-font-leading-multiplier);
no current palette demands it. Revisitable per-theme if implementation
testing surfaces a serif-vs-sans harmony issue on Parchment or
similar.

---

## 1. Default Light

`id: 'default-light'` · light · accent-overridable · Default
family · `nameKey: 'foundations.themes.defaultLight'`

Neutral, lightweight. Off-white canvas (not pure-white — easier
on the eye on prolonged sessions), near-black text, soft borders.
Default accent is canonical-shadcn blue; user accent override
cascades through the
[derivation algorithm](./color.md#accent-derivation-algorithm).

```
--bg-base:        #fdfdfd
--bg-raised:      #ffffff
--bg-sunken:      #f4f4f5
--bg-overlay:     #ffffff
--bg-disabled:    #f5f5f5

--fg-primary:     #0a0a0a
--fg-secondary:   #525252
--fg-muted:       #71717a
--fg-disabled:    #a1a1aa

--accent:         #3b82f6
--accent-hover:   #2563eb
--accent-fg:      #ffffff

--success:        #16a34a   --success-fg: #ffffff
--warning:        #d97706   --warning-fg: #ffffff
--danger:         #dc2626   --danger-fg:  #ffffff
--info:           #0284c7   --info-fg:    #ffffff

--border:         #e4e4e7
--border-strong:  #a1a1aa

--focus-ring:     #3b82f6
--selection-bg:   #dbeafe

--recently-classified-bg: #fef3c7
```

**Audit expectations** — clears AAA 7:1 on body prose
(`#0a0a0a` × `#fdfdfd` ≈ 19.4:1); clears all non-text 3:1 targets;
default-accent derivation pairs all clear AA on accent-fg
auto-flip.

---

## 2. Default Dark

`id: 'default-dark'` · dark · accent-overridable · Default
family · `nameKey: 'foundations.themes.defaultDark'`

Truly neutral charcoal canvas — barely-cool tint, no slate-blue
cast. The accent override needs the canvas not to fight whatever
hue the user picks. Default accent mirrors Default Light's
canonical-shadcn blue for predictable picker behavior across
modes.

```
--bg-base:        #0e0f10
--bg-raised:      #18191b
--bg-sunken:      #08090a
--bg-overlay:     #1c1d1f
--bg-disabled:    #1c1d1f

--fg-primary:     #f5f5f5
--fg-secondary:   #a1a1aa
--fg-muted:       #71717a
--fg-disabled:    #52525b

--accent:         #3b82f6
--accent-hover:   #60a5fa
--accent-fg:      #ffffff

--success:        #22c55e   --success-fg: #052e16
--warning:        #f59e0b   --warning-fg: #422006
--danger:         #ef4444   --danger-fg:  #450a0a
--info:           #38bdf8   --info-fg:    #0c1d3a

--border:         #27272a
--border-strong:  #3f3f46

--focus-ring:     #3b82f6
--selection-bg:   #1e3a8a

--recently-classified-bg: #422006
```

**Audit expectations** — clears AAA 7:1 on body prose
(`#f5f5f5` × `#0e0f10` ≈ 17.4:1); clears all non-text targets;
default-accent derivation pairs clear AA across the sample set.

---

## 3. Parchment

`id: 'parchment'` · light · opinionated · `nameKey: 'foundations.themes.parchment'`

Warm cream paper canvas, deep ink-brown text, russet accent.
Reads as hand-pressed paper + dip-pen ink. Pinned serif (Charter /
Iowan / Source Serif at the top of the stack — system serifs
that look most like print). Pairs with Aventuras Signature as
inverted partners (same warm-cream + deep palette, swapped
modes).

```
--bg-base:        #f5e6c4
--bg-raised:      #f9ecd2
--bg-sunken:      #ecdcb4
--bg-overlay:     #fbf2dd
--bg-disabled:    #e8d8b0

--fg-primary:     #3a2818
--fg-secondary:   #5a3e2a
--fg-muted:       #8b6f55
--fg-disabled:    #b89876

--accent:         #8b3a14
--accent-hover:   #6f2e0f
--accent-fg:      #f5e6c4

--success:        #4a6b2e   --success-fg: #f5e6c4
--warning:        #b8560e   --warning-fg: #f5e6c4
--danger:         #8b1d1d   --danger-fg:  #f5e6c4
--info:           #1e5e7e   --info-fg:    #f5e6c4

--border:         #d4c099
--border-strong:  #b89876

--focus-ring:     #8b3a14
--selection-bg:   #e8d8a8

--recently-classified-bg: #f0d68a
```

`tokens.fonts.--font-reading: '"Charter", "Iowan Old Style", "Source Serif Pro", Georgia, "Cambria", "Liberation Serif", "Noto Serif", serif'`

**Audit expectations** — clears AAA 7:1 on body prose
(`#3a2818` × `#f5e6c4` ≈ 11.7:1); clears non-text targets across
borders and focus.

---

## 4. Catppuccin Latte

`id: 'catppuccin-latte'` · light · opinionated · Catppuccin family

Canonical [Catppuccin Latte](https://catppuccin.com/palette)
values verbatim. Soft pastel light theme; warm without being
parchment. Catppuccin mascot recognition for users familiar
with it from IDE / terminal use.

```
--bg-base:        #eff1f5    /* Base */
--bg-raised:      #e6e9ef    /* Mantle */
--bg-sunken:      #ccd0da    /* Surface 0 */
--bg-overlay:     #dce0e8    /* Crust */
--bg-disabled:    #ccd0da

--fg-primary:     #4c4f69    /* Text */
--fg-secondary:   #6c6f85    /* Subtext 0 */
--fg-muted:       #8c8fa1    /* Overlay 1 */
--fg-disabled:    #9ca0b0    /* Overlay 0 */

--accent:         #1e66f5    /* Blue */
--accent-hover:   #1852c4
--accent-fg:      #eff1f5

--success:        #40a02b    /* Green */    --success-fg: #eff1f5
--warning:        #df8e1d    /* Yellow */   --warning-fg: #eff1f5
--danger:         #d20f39    /* Red */      --danger-fg:  #eff1f5
--info:           #04a5e5    /* Sky */      --info-fg:    #eff1f5

--border:         #bcc0cc    /* Surface 1 */
--border-strong:  #acb0be    /* Surface 2 */

--focus-ring:     #1e66f5
--selection-bg:   #b9cbf7

--recently-classified-bg: #fff5d6
```

**Audit expectations** — body prose `#4c4f69` × `#eff1f5` ≈ 7.0:1
(sits **right at the AAA 7:1 threshold** — Catppuccin's
canonical values land at the edge; depending on rounding the
audit utility may report this as `pass` or `warn`). All non-text
targets clear 3:1.

---

## 5. Catppuccin Mocha

`id: 'catppuccin-mocha'` · dark · opinionated · Catppuccin family

Canonical [Catppuccin Mocha](https://catppuccin.com/palette)
values. Accent is **Mauve** (`#cba6f7`) rather than Blue —
Tokyo Night already occupies the blue-accent dark slot, so Mocha
gets distinct character via Mauve. Same body-prose AA-floor /
near-AAA contrast as Latte; documented exemption preserves
Catppuccin identity.

```
--bg-base:        #1e1e2e    /* Base */
--bg-raised:      #313244    /* Surface 0 */
--bg-sunken:      #181825    /* Mantle */
--bg-overlay:     #45475a    /* Surface 1 */
--bg-disabled:    #313244

--fg-primary:     #cdd6f4    /* Text */
--fg-secondary:   #bac2de    /* Subtext 1 */
--fg-muted:       #a6adc8    /* Subtext 0 */
--fg-disabled:    #7f849c    /* Overlay 1 */

--accent:         #cba6f7    /* Mauve */
--accent-hover:   #d8b8ff
--accent-fg:      #1e1e2e

--success:        #a6e3a1    /* Green */    --success-fg: #1e1e2e
--warning:        #f9e2af    /* Yellow */   --warning-fg: #1e1e2e
--danger:         #f38ba8    /* Red */      --danger-fg:  #1e1e2e
--info:           #89dceb    /* Sky */      --info-fg:    #1e1e2e

--border:         #45475a    /* Surface 1 */
--border-strong:  #585b70    /* Surface 2 */

--focus-ring:     #cba6f7
--selection-bg:   #45475a

--recently-classified-bg: #4a3d2a
```

**Audit expectations** — body prose `#cdd6f4` × `#1e1e2e` ≈ 11.5:1
(clears AAA 7:1). Non-text targets clear 3:1 across borders and
focus.

---

## 6. Tokyo Night

`id: 'tokyo-night'` · dark · opinionated

Canonical [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme)
Night-variant values. Cool saturated dark — distinct mood from
Mocha's warm pastel. Borders pulled slightly more saturated than
canonical to clear 3:1 non-text against `--bg-base`.

```
--bg-base:        #1a1b26
--bg-raised:      #24283b
--bg-sunken:      #16161e
--bg-overlay:     #2e3247
--bg-disabled:    #24283b

--fg-primary:     #c0caf5
--fg-secondary:   #a9b1d6
--fg-muted:       #565f89    /* Tokyo's "Comments" */
--fg-disabled:    #3b415a

--accent:         #7aa2f7    /* Blue */
--accent-hover:   #9eb9f8
--accent-fg:      #1a1b26

--success:        #9ece6a    /* Green */         --success-fg: #1a1b26
--warning:        #e0af68    /* Yellow */        --warning-fg: #1a1b26
--danger:         #f7768e    /* Red */           --danger-fg:  #1a1b26
--info:           #7dcfff    /* Bright Blue */   --info-fg:    #1a1b26

--border:         #3b415a
--border-strong:  #565f89

--focus-ring:     #7aa2f7
--selection-bg:   #3d4775

--recently-classified-bg: #3b2e4a
```

**Audit expectations** — body prose `#c0caf5` × `#1a1b26` ≈ 11.6:1
(clears AAA 7:1). Non-text targets clear 3:1.

---

## 7. Royal

`id: 'royal'` · dark · opinionated

Deep purple canvas + gold accent. Period / gilded / fantasy-
narrative coded. Old-app port with v2-contract slot mapping;
canvas pulled darker than old-app's `#0d0216` for AAA on body
prose against the lavender foreground.

```
--bg-base:        #14081f
--bg-raised:      #1f0e2e
--bg-sunken:      #0a0314
--bg-overlay:     #2a1742
--bg-disabled:    #1f0e2e

--fg-primary:     #f3e8ff    /* lavender-cream */
--fg-secondary:   #d8b4fe
--fg-muted:       #a78bfa
--fg-disabled:    #6b46a8

--accent:         #fbbf24    /* gold */
--accent-hover:   #f59e0b
--accent-fg:      #14081f    /* auto-flip — gold's L_rel > 0.5 */

--success:        #84cc16    --success-fg: #14081f
--warning:        #f97316    --warning-fg: #14081f
--danger:         #ec4899    --danger-fg:  #14081f
--info:           #a78bfa    --info-fg:    #14081f

--border:         #3d2057
--border-strong:  #5b3681

--focus-ring:     #fbbf24
--selection-bg:   #4b2c75

--recently-classified-bg: #4a3a0a
```

**Audit expectations** — body prose `#f3e8ff` × `#14081f` ≈ 16.8:1
(clears AAA 7:1). Gold-accent auto-flip lands `--accent-fg` near
the canvas color; gold × deep-purple non-text contrast clears
3:1.

---

## 8. Cyberpunk

`id: 'cyberpunk'` · dark · opinionated · color-only port

Color-only port of the old-app cyberpunk theme. Animated CRT
scanline overlay, radial vignette, and text-glow are **not**
carried forward (they violate the
[pure-flat depth metaphor](./spacing.md#depth-metaphor)).
Sharp-edge identity (radius 0) is also not preserved per
session-4's structurally-locked radii. The neon palette alone
carries the identity: deep navy canvas, neon cyan accent, neon
yellow focus ring, neon pink danger.

```
--bg-base:        #0d1326
--bg-raised:      #142036
--bg-sunken:      #0b1426
--bg-overlay:     #1a2a47
--bg-disabled:    #142036

--fg-primary:     #e0f7fa    /* bright cyan-white */
--fg-secondary:   #94a3b8    /* cool gray */
--fg-muted:       #64748b
--fg-disabled:    #475569

--accent:         #00f0ff    /* neon cyan */
--accent-hover:   #5eead4
--accent-fg:      #0a0a0a

--success:        #00ff88    --success-fg: #0a0a0a
--warning:        #faff00    /* neon yellow */    --warning-fg: #0a0a0a
--danger:         #ff00ff    /* neon pink */      --danger-fg:  #0a0a0a
--info:           #00f0ff    /* neon cyan, mirrors accent */ --info-fg: #0a0a0a

--border:         #1a2a47
--border-strong:  #2a4068

--focus-ring:     #faff00    /* neon yellow ring; honors old-app */
--selection-bg:   #1a4d5e

--recently-classified-bg: #2a4868
```

**Audit expectations** — body prose `#e0f7fa` × `#0d1326` ≈ 16.5:1
(clears AAA 7:1). Neon-cyan accent × deep-navy canvas clears 3:1
non-text. Focus-ring (neon yellow) × bg-base clears 3:1.

---

## 9. Fallen Down

`id: 'fallen-down'` · dark · opinionated · monospace-prose

Pure-black canvas, pure-white text, neon-yellow accent.
`--font-reading` overrides to system monospace. Stark / void /
pixel-tribute identity. Old-app's bundled VT323 font is
explicitly **not** carried forward; the system monospace stack
approximates the aesthetic. Old-app's sharp-edge radius identity
is also not preserved per session-4's structurally-locked radii.

```
--bg-base:        #000000
--bg-raised:      #0a0a0a
--bg-sunken:      #000000
--bg-overlay:     #1a1a1a
--bg-disabled:    #0a0a0a

--fg-primary:     #ffffff
--fg-secondary:   #c0c0c0
--fg-muted:       #808080
--fg-disabled:    #404040

--accent:         #ffff00
--accent-hover:   #ffff80
--accent-fg:      #000000

--success:        #00ff00    --success-fg: #000000
--warning:        #ffa500    --warning-fg: #000000
--danger:         #ff0000    --danger-fg:  #000000
--info:           #00ffff    --info-fg:    #000000

--border:         #404040
--border-strong:  #ffffff

--focus-ring:     #ffff00
--selection-bg:   #4a4a00

--recently-classified-bg: #1a1a00
```

`tokens.fonts.--font-reading: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'`

**Audit expectations** — body prose `#ffffff` × `#000000` = 21:1
(WCAG-maximum contrast); all targets clear with margin.

---

## 10. Aventuras Signature

`id: 'aventuras-signature'` · dark · opinionated ·
`nameKey: 'foundations.themes.aventurasSignature'`

The brand statement. Deep navy canvas keyed to the [app icon's](../../../assets/images/icon.png)
background hue; warm cream foreground keyed to the icon's mark
color, pulled ~11 L points cooler/darker than the icon's
literal cream for long-session readability. **Two-color
identity:** `--fg-primary` and `--accent` are both the muted
cream; primary buttons render as cream-on-navy with auto-flipped
near-black text. Pairs with Parchment as inverted partners (same
warm-cream + deep palette, swapped modes).

```
--bg-base:        #0e2240
--bg-raised:      #152a4a
--bg-sunken:      #091830
--bg-overlay:     #1a3354
--bg-disabled:    #142a44

--fg-primary:     #d4c9a8    /* muted cream — icon-keyed */
--fg-secondary:   #b8ad8c
--fg-muted:       #8a8068
--fg-disabled:    #5a5444

--accent:         #d4c9a8    /* same as fg-primary */
--accent-hover:   #c0b594
--accent-fg:      #0e2240    /* near-bg navy on cream */

--success:        #a3b88c    /* sage */          --success-fg: #0e2240
--warning:        #d4a85a    /* warm amber */    --warning-fg: #0e2240
--danger:         #d49494    /* muted coral */   --danger-fg:  #0e2240
--info:           #94b8d4    /* cool steel */    --info-fg:    #0e2240

--border:         #2a3d5e
--border-strong:  #3d527a

--focus-ring:     #d4c9a8
--selection-bg:   #2a3d5e

--recently-classified-bg: #2a4068
```

**Audit expectations** — body prose `#d4c9a8` × `#0e2240` ≈ 9.6:1
(clears AAA 7:1 with margin). Cream-accent × navy-canvas clears
3:1 non-text. Focus-ring (cream) × bg-base clears 3:1.

---

## Theme-author guidance for v1.5+ additions

The gallery is intentionally bounded for v1. Adding a new
curated theme post-launch follows the same shape:

1. Author the TS module under `lib/themes/<id>/<id>.ts` declaring
   the 25 color slots + optional fonts + theme metadata. Type-
   check guarantees every slot is provided.
2. Run `pnpm themes:audit` (per
   [`color.md → Theme audit utility`](./color.md#theme-audit-utility))
   over the new theme. Clear all AA 4.5:1 floors; aim for AAA on
   body prose where the palette identity allows.
3. Add the theme to the registry array.
4. Add an entry to the gallery roster table above with the new
   theme's row.
5. Decide `accentOverridable`: only flip on if the theme's
   identity is "neutrals plus a color." Opinionated themes
   keep it off.

User-authored themes (raw CSS drop-in, parked-until-signal per
[`../../parked.md → User-authored themes`](../../parked.md#user-authored-themes))
follow the same slot inventory once the loading mechanism lands;
they don't go through the curated registry but consume the same
`Record<ColorToken, string>` shape via runtime parsing.
