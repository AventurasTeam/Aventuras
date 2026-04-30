# Foundations

Visual identity foundations for Aventuras. Sister to
[`../principles.md`](../principles.md) (philosophy + architecture-
shaped rules) and [`../patterns/`](../patterns/README.md)
(reusable component primitives) — the three are orthogonal: a
pattern consumes token slots from foundations and obeys principles
from `principles.md`; foundations carry the visual contract
themselves.

Multi-session pass; session 1 (architecture / contract) lands in
this initial set. Subsequent sessions add files for color,
typography, density, motion, iconography, and the curated theme
gallery.

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

## Wireframe convention exemption

Per [`../../conventions.md → Wireframe authoring`](../../conventions.md#wireframe-authoring),
wireframes are monochrome by rule because pixel-fidelity decisions
defer to visual identity. Foundations wireframes are the
**explicit exception** — `theming.html` and any future
foundations wireframe demonstrate palette swap and therefore
render real (placeholder) palettes. The exemption applies only to
this directory; `screens/` wireframes stay monochrome.
