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

Multi-session pass — see [`sessions.md`](./sessions.md) for the
visual-identity track chronicle; mobile sessions are chronicled at
[`mobile/sessions.md`](./mobile/sessions.md). Each session lands
its own file(s) and updates the relevant sessions doc with its
status + exploration-record link.

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
  [`themes.md`](./themes.md)).
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
  (3 light + 7 dark), first-launch default, authoring conventions,
  full per-theme slot values + audit expectations.
- [`sessions.md`](./sessions.md) — multi-session chronicle for the
  visual-identity track + the wireframe-convention exemption.
- [`mobile/`](./mobile/README.md) — mobile / responsive contract
  (sister to visual identity, orthogonal axis). Form-factor tiers,
  breakpoints, artifact strategy, viewport toggle pattern, plus the
  multi-session plan that pins navigation / layout / collapse rule
  / touch grammar / platform adaptations across subsequent passes.
