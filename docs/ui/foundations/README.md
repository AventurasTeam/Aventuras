# Foundations

Foundations for Aventuras. Sister to
[`../principles.md`](../principles.md) (philosophy + architecture-
shaped rules) and [`../patterns/`](../patterns/README.md)
(reusable component primitives) — the three are orthogonal: a
pattern consumes tokens from foundations and obeys principles from
`principles.md`; foundations carry the underlying contracts
themselves.

Two orthogonal contracts live here:

- **Visual identity** — what things look like. Token slots, theme
  architecture, color, typography, spacing, iconography, motion,
  curated palettes. Top-level files in this directory.
- **Mobile / responsive** — what shape things take across form
  factors and how they're touched. Form-factor tiers, breakpoints,
  artifact strategy, navigation paradigm, layout primitives, touch
  grammar, platform adaptations. Lives under
  [`mobile/`](./mobile/README.md), tracked with its own multi-
  session plan.

Multi-session pass — see [Sessions](#sessions) below for the
visual-identity track; mobile sessions are tracked at
[`mobile/README.md → Sessions`](./mobile/README.md#sessions). Each
session lands its own file(s) and updates the relevant session list
with its status + exploration-record link.

## Files

- [`tokens.md`](./tokens.md) — token contract: classes (themeable
  / user-orthogonal / structurally locked), naming convention,
  color slot inventory, font-family slots, structural slot
  families.
- [`theming.md`](./theming.md) — theme data shape, registry
  pattern, switching mechanism (CSS vars at root + NativeWind
  runtime), persistence in `app_settings.appearance`, accent
  override (opt-in), demo reference.
- [`theming.html`](./theming.html) — interactive demo: live theme
  swap across the curated 10-theme gallery (per
  [`themes.md`](./themes.md)). Proves both the architecture
  (runtime CSS-var cascade) and the gallery (visible swatches
  re-render on swap).
- [`color.md`](./color.md) — color contract: 25-slot inventory,
  per-pair WCAG contrast targets, focus / disabled / hover state
  recipes, accent-derivation algorithm, recently-classified
  pattern slot, dev-only `pnpm themes:audit` utility.
- [`typography.md`](./typography.md) — typography contract:
  default font stacks (system-only at v1), Tailwind-aligned
  type scale at 16 px base, four weights, per-font leading
  multiplier, reader font-size user setting.
- [`spacing.md`](./spacing.md) — spatial contract: base unit +
  Tailwind utility-first spacing, six component-internal padding
  tokens, four radii tokens, pure-flat depth metaphor with fixed
  scrim.
- [`iconography.md`](./iconography.md) — iconography contract:
  Lucide icon set, 2 px stroke + three sizing tokens, full
  glyph vocabulary across top-bar / directional / disclosure /
  status / per-entry / entity-kind / common-UI categories.
- [`motion.md`](./motion.md) — motion contract: three duration
  tokens + two easing tokens, reduced-motion behavior with
  transform-vs-opacity distinction, per-use-site guidance.
- [`themes.md`](./themes.md) — curated theme gallery: 10 palettes
  (3 light + 7 dark) spanning two accent-overridable neutral
  defaults, the Parchment writing-app archetype, Catppuccin
  Latte / Mocha, Tokyo Night, Royal, Cyberpunk (color-only
  port), Fallen Down (monospace-prose port), and Aventuras
  Signature (icon-keyed brand theme). First-launch default,
  authoring conventions, full per-theme slot values + audit
  expectations.
- [`mobile/`](./mobile/README.md) — mobile / responsive contract
  (sister to visual identity, orthogonal axis). Form-factor tiers,
  breakpoints, artifact strategy, viewport toggle pattern, plus the
  multi-session plan that pins navigation / layout / collapse rule
  / touch grammar / platform adaptations across subsequent passes.

## Sessions

The visual identity contract spans six design sessions. They land
sequentially; each session updates this list with its status and a
link to its exploration record. Sessions that follow may be
collapsed (e.g. 4+5 into one pass) or split further as scope
becomes concrete; the list reflects the current plan, not a fixed
contract.

1. **Foundations / theme architecture** — landed 2026-04-30
   ([exploration record](../../explorations/2026-04-30-visual-identity-foundations.md)).
   Token classes + semantic naming, theme data shape, registry
   pattern, switching mechanism (CSS vars at root + NativeWind
   runtime), persistence in `app_settings.appearance`,
   accent-override opt-in (per-theme flag + JS-side derivation),
   density-token policy with cut-path (subsequently cut at
   session 4), interactive demo HTML.
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
   Tailwind utilities (no minted semantic gap tokens); six
   component-internal padding tokens (`--row-pad-y` / `-x`,
   `--input-pad-y` / `-x`, `--button-pad-y` / `-x`) at single
   values for cross-component consistency. Tap-target on native
   handled via `hitSlop`; visible-size contract preserved. Four
   radii tokens — `--radius-sm` (4 px), `--radius-md` (8 px),
   `--radius-lg` (12 px), `--radius-full` (9999 px) —
   structurally locked, not themeable. **Depth metaphor: pure
   flat** — zero shadow tokens; modals = `--bg-overlay` +
   `--border-strong` + fixed mode-dependent scrim
   (`rgba(0, 0, 0, 0.4)` light / `0.6` dark); popovers =
   `--bg-overlay` + `--border` (no scrim). **Density toggle
   cut for v1** — single comfortable posture for both mobile +
   desktop; `app_settings.appearance.density` removed from
   persistence shape; UI control removed; re-addable later
   without contract changes if mobile demand surfaces. File:
   [`spacing.md`](./spacing.md).
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
   neon yellow + monospace prose; bundled VT323 font dropped),
   and Aventuras Signature (deep navy + warm cream, keyed to the
   app icon — two-color identity, paired inverse with Parchment).
   First-launch default `themeId: 'default-light'`. Per-theme
   slot values + audit expectations canonical at
   [`themes.md`](./themes.md). Theme-audit CI gate followup
   becomes ripe with this session's palette data; gate's own
   design pass follows.

After session 6, foundations is feature-complete for v1. Component
implementation begins consuming the contract; per-pattern visual
specs (the "how" each pattern looks under the foundations) layer
on as components ship.

## Wireframe convention exemption

Per [`../../conventions.md → Wireframe authoring`](../../conventions.md#wireframe-authoring),
wireframes are monochrome by rule because pixel-fidelity decisions
defer to visual identity. Foundations wireframes are the
**explicit exception** — `theming.html` and any future
foundations wireframe demonstrate palette swap and therefore
render real curated palettes. The exemption applies only to
this directory; `screens/` wireframes stay monochrome.
