# Foundations

Visual identity foundations for Aventuras. Sister to
[`../principles.md`](../principles.md) (philosophy + architecture-
shaped rules) and [`../patterns/`](../patterns/README.md)
(reusable component primitives) — the three are orthogonal: a
pattern consumes token slots from foundations and obeys principles
from `principles.md`; foundations carry the visual contract
themselves.

Multi-session pass — see [Sessions](#sessions) below. Each
session lands its own file(s) and updates the session list with
its status + exploration-record link.

## Files

- [`tokens.md`](./tokens.md) — token contract: classes (themeable
  / user-orthogonal / structurally locked), naming convention,
  color slot inventory, font-family slots, structural slot
  families.
- [`theming.md`](./theming.md) — theme data shape, registry
  pattern, switching mechanism (CSS vars at root + NativeWind
  runtime), persistence in `app_settings.appearance`, accent
  override (opt-in), density-token policy, demo reference.
- [`theming.html`](./theming.html) — interactive demo: theme +
  density swap with three placeholder palettes (Default Light,
  Default Dark, Parchment). Replaces visual identity with a
  working architecture proof; specific palettes are not the
  curated gallery.

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
   density-token policy with cut-path, interactive demo HTML.
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
   per-theme contrast + derivation reporting; CI gate parked
   until session 6 lands real palette data. File:
   [`color.md`](./color.md).
3. **Typography** — pending. Reading-text font choice
   (system-stack vs custom-bundled; load-bearing for the primary
   reading activity), type scale (sizes / line-heights / weights),
   per-font leading multiplier (escape valve for serif vs sans
   harmony at the locked scale), `--font-display` decision,
   cross-platform font availability + fallback chains. Lands as
   `typography.md`.
4. **Density / spacing / radii / depth metaphor** — pending. Base
   spacing unit, density posture (the comfortable / compact
   variants on component-internal padding tokens), radii
   vocabulary (`--radius-sm` / `-md` / `-lg` / `-full`), the
   "flat, nothing flashy" cashing out as borders + tinted fills as
   the depth metaphor (no shadows, or shadows only on overlay
   surfaces — TBD). **Density toggle ship-or-cut decision lands
   here** per the cut-path in
   [`theming.md → Density-token policy`](./theming.md#density-token-policy).
   Lands as `density.md` (and possibly `radii.md` / `spacing.md`
   if the topic fans out further).
5. **Iconography + motion** — pending. Icon set choice (Lucide is
   the obvious default; alternatives evaluated), stroke weight,
   sizing scale, top-bar glyph vocabulary (App Settings ⚙ vs Story
   Settings glyph per
   [`../principles.md → Top-bar design rule → Settings icon scope`](../principles.md#settings-icon-scope)),
   per-entry icon row composition with conditional 5th icon (per
   [`../../parked.md`](../../parked.md#per-entry-icon-row-composition-with-conditional-5th-icon)),
   motion budget (`--duration-fast` / `-base` / `-slow`,
   `--easing-standard` / `-emphasis`), reduced-motion behavior.
   Lands as `iconography.md` + `motion.md` (or combined).
6. **Curated theme palettes** — pending. Author each theme in the
   v1 curated gallery (5–10+ entries, mode-locked per
   [`theming.md → Theme data shape`](./theming.md#theme-data-shape)).
   Pick `Default Light` and `Default Dark` (the
   [accent-overridable](./theming.md#accent-override-opt-in) base
   pair) and one or more opinionated themes (Parchment / Catppuccin
   variants / Tokyo Night / etc.). Default `themeId` for first
   launch lands here. Lands as `themes.md` (or `themes/` subdir
   if it fans out further).

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
render real (placeholder) palettes. The exemption applies only to
this directory; `screens/` wireframes stay monochrome.
