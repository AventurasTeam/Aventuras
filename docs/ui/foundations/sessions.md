# Visual-identity sessions

Retrospective chronicle for the foundations visual-identity track.
All six design sessions landed 2026-04-30 → 2026-05-01; the
substrate is feature-complete for v1. Mobile / responsive sessions
are chronicled separately at
[`mobile/sessions.md`](./mobile/sessions.md).

## Session list

Six design sessions landed between 2026-04-30 and 2026-05-01 and
shipped the visual-identity contract. Foundations is
feature-complete for v1; the list below is a retrospective
chronicle (what landed, when, with what scope) — not a plan. Per
session: date landed, exploration record, scope summary, files
produced.

1. **Foundations / theme architecture** — landed 2026-04-30
   ([exploration record](../../explorations/2026-04-30-visual-identity-foundations.md)).
   Token classes + semantic naming, theme data shape, registry
   pattern, switching mechanism (CSS vars at root + NativeWind
   runtime), persistence in `app_settings.appearance`,
   accent-override opt-in (per-theme flag + JS-side derivation),
   density-token policy with cut-path (cut at session 4,
   reinstated 2026-05-03 by Phase 2 Group B), interactive demo
   HTML.
   Files: [`tokens.md`](./tokens.md), [`theming.md`](./theming.md),
   [`theming.html`](./theming.html).
2. **Color system + accessibility** — landed 2026-05-01
   ([exploration record](../../explorations/2026-05-01-color-system.md)).
   Final color slot inventory (25 slots), per-pair WCAG contrast
   targets (AAA target + AA floor on body prose; AA across other
   text-on-bg; 3:1 on non-text per WCAG 1.4.11; faint-signal
   exception on the recently-classified tint). Focus / disabled /
   hover state recipes locked at the contract level (per-platform
   glue is implementation detail). Accent-derivation algorithm
   with locked constants — HSL `±10` hover delta, WCAG luminance-
   threshold auto-flip, RGB linear mix toward `--bg-base` for
   selection. Recently-classified one-slot model with `0.5`
   fading-tier alpha. Dev-only `pnpm themes:audit` utility for
   per-theme contrast + derivation reporting; CI gate followup
   parked at session 2, gating-ripe at session 6 once the gallery
   data informed the exempt-list shape. File:
   [`color.md`](./color.md).
3. **Typography** — landed 2026-05-01
   ([exploration record](../../explorations/2026-05-01-typography.md)).
   System-stacks for v1 default fonts (zero bundled — themes opt
   into bundling at theme-author time). Tailwind-aligned type
   scale at 16 px base (xs through 3xl, paired `--leading-*`,
   four weights at 400 / 500 / 600 / 700; reading body at
   `--text-lg`, one step above UI base). `Theme.leadingMultiplier`
   optional escape valve for serif-vs-sans harmony, scoped to
   reading-text line-heights only. **Reader font-size setting** —
   new user-orthogonal axis at
   `app_settings.appearance.readerFontScale` (`sm` / `md` / `lg` /
   `xl`); applies to reader entry content only. `--font-display`
   slot evaluated and **skipped** for v1. File:
   [`typography.md`](./typography.md).
4. **Spacing / radii / depth metaphor** — landed 2026-05-01
   ([exploration record](../../explorations/2026-05-01-spacing.md)).
   4 px Tailwind-aligned base unit; spacing handled primarily via
   Tailwind utilities (no minted semantic gap tokens). Four
   radii tokens — `--radius-sm` (4 px), `--radius-md` (8 px),
   `--radius-lg` (12 px), `--radius-full` (9999 px) —
   structurally locked, not themeable. **Depth metaphor: pure
   flat** — zero shadow tokens; modals = `--bg-overlay` +
   `--border-strong` + fixed mode-dependent scrim
   (`rgba(0, 0, 0, 0.4)` light / `0.6` dark); popovers =
   `--bg-overlay` + `--border` (no scrim). **Density toggle**
   cut for v1 at this session, reinstated 2026-05-03 by Phase 2
   Group B Select implementation
   ([exploration record](../../explorations/2026-05-03-density-toggle.md)).
   Component-internal sizing now lives in density-aware tokens
   (`--control-h-*` height-driven for fixed-height controls,
   `--row-py-*` / `--row-px-*` padding-driven for rows), each
   with three variants keyed off active density (compact /
   regular / comfortable). User toggle at
   `app_settings.appearance.density` with sentinel `'default'`
   resolving per tier (compact on desktop, regular on phone +
   tablet). Tap-target compliance follows from default densities
   (44 px control-md on regular meets iOS HIG); `hitSlop` reserved
   for sub-`xs` affordances only. File: [`spacing.md`](./spacing.md).
5. **Iconography + motion** — landed 2026-05-01
   ([exploration record](../../explorations/2026-05-01-iconography-motion.md)).
   **Iconography:** Lucide as the icon set (shadcn-canonical,
   tree-shakeable, react/RN parity); 2 px uniform stroke;
   three sizing tokens (`--icon-sm` 16 px / `--icon-md` 20 px /
   `--icon-lg` 24 px). Full glyph vocabulary across top-bar /
   chrome (App Settings → `Settings`, Story Settings →
   `SlidersVertical`, Actions menu → `MoreVertical`, etc.),
   directional / navigational, disclosure carets, status / state
   (incl. `X` vs `Trash2` semantic split), per-entry actions,
   entity kind glyphs, common UI affordances. Per-entry icon row
   composition resolved to **flat 5-icon row** when era-flip is
   active (parked entry deleted). **Motion:** three duration
   tokens (`--duration-fast` 150 ms / `-base` 250 ms / `-slow`
   400 ms) + two easing tokens (Material standard +
   ease-out emphasis). Reduced-motion behavior uses a
   transform-vs-opacity distinction — clamp transform-based
   motion to 1 ms, keep opacity transitions at fast duration.
   Files: [`iconography.md`](./iconography.md),
   [`motion.md`](./motion.md).
6. **Curated theme palettes** — landed 2026-05-01
   ([exploration record](../../explorations/2026-05-01-curated-theme-palettes.md)).
   Final gallery: **10 themes, 3 light + 7 dark.** Two accent-
   overridable neutral defaults (`default-light` / `default-dark`)
   plus eight opinionated palettes — Parchment (warm-paper
   writing-app archetype), Catppuccin Latte + Mocha (canonical
   established pastel pair), Tokyo Night (canonical established
   cool-saturated dark), Royal (deep purple + gold fantasy-coded),
   Cyberpunk (neon palette, color-only port — animated CRT effects
   dropped per the flat depth metaphor), Fallen Down (pure-black +
   neon yellow + monospace prose; bundled VT323 font dropped —
   reinstated 2026-05-21), and Aventuras (deep navy + warm cream,
   keyed to the app icon — two-color identity, paired inverse with
   Parchment).
   First-launch default `themeId: 'default-light'`. Per-theme
   slot values + audit expectations canonical at
   [`themes.md`](./themes.md).

Component implementation consumes the contract going forward;
per-pattern visual specs (the "how" each pattern looks under the
foundations) layer on as components ship.

## Wireframe convention exemption

Per [`../../conventions.md → Wireframe authoring`](../../conventions.md#wireframe-authoring),
wireframes are monochrome by rule because pixel-fidelity decisions
defer to visual identity. Foundations wireframes are the
**explicit exception** — `theming.html` and any future
foundations wireframe demonstrate palette swap and therefore
render real curated palettes. The exemption applies only to
this directory; `screens/` wireframes stay monochrome.
