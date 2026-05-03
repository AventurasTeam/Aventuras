# Components

Component-construction conventions for Aventuras' UI primitives and
patterns. Sister to [`principles.md`](./principles.md) (philosophy
and architecture rules) and [`patterns/`](./patterns/README.md)
(pattern visual / interaction specs); this file holds the **how we
build** rules — sourcing, story conventions, anything else that
applies across every primitive and pattern shipped to Storybook.

## Sourcing — react-native-reusables as baseline

`react-native-reusables` is the scaffold source for primitives that
have an analogous reusables component. The CLI scaffolds the
component; we then reshape it to fit the project's slot + token
contracts. Adapt-not-rebuild.

What gets reshaped vs accepted as default:

- **Reshape (always).** Color, spacing, and font tokens to read from
  our slot system. Variant, size, and shape API names to match
  domain vocabulary. Accessibility props that need to surface
  domain-specific behavior (e.g. Button's `loading` driving spinner
  color per variant).
- **Accept (default).** Underlying rn-primitives composition (open
  / close machinery, focus trap, lifecycle hooks). Component layout
  and DOM structure. Base interaction wiring that's a behavior
  contract rather than a visual token. RTL handling.
- **Tie-break.** When a structural default hardcodes a value the
  slot system owns (e.g. a font-family baked into a className
  rather than reading from `--font-*`), token reshape wins. Tokens
  are the contract.

For primitives without a reusables analogue, build from
`@rn-primitives/*` directly (or a different upstream) using the
same slot-first reshape discipline.

## Storybook story conventions

Each primitive's stories are **axes-driven**, not template-driven.
`Default` is the only mandatory story; other sections are added when
the primitive has the corresponding axis. Forcing a fixed template
on every primitive produces filler sections (a single-entry "Sizes"
because the convention demanded one) without paying for cognitive
cost.

Sections:

- **Default** — always. Most common usage; doubles as smoke test.
- **Variants** — when the primitive has visual or semantic variants
  (Button: yes; Sheet: no; Input: only if leading-icon / password
  ship as variants rather than slots).
- **Sizes** — when there's a multi-step size token axis (Button,
  Input, Icon: yes; Switch: usually single size, omit).
- **States** — when interactive states diverge enough to warrant
  isolated rendering (focus, error, loading, disabled, checked).
  Most interactive primitives qualify; pure-presentation ones
  (Skeleton) don't.
- **Shapes** — only when shape is a distinct token axis. Button has
  it (default / pill / square); most primitives don't.
- **ThemeMatrix** — when the primitive consumes theme-divergent
  slots (variant colors, accent, surface tiers). Almost all
  primitives qualify; primitives with shallow theme coupling
  (Skeleton, with one `bg-muted` slot) can omit — a wall of
  identical pulses isn't informative.

Indicative shapes by primitive:

- Button → Default · Variants · Sizes · States · Shapes ·
  ThemeMatrix.
- Sheet / Popover → Default · States · ThemeMatrix.
- Input / Textarea → Default · Sizes · States · ThemeMatrix.
- Select → Default · Sizes · States · ThemeMatrix (Variants if the
  segment / dropdown / radio render-mode rule from
  [`patterns/forms.md`](./patterns/forms.md) ships as variants).
- Switch / Checkbox / Radio → Default · States · ThemeMatrix.
- Icon → Default · Sizes · ThemeMatrix.
- Skeleton → Default · Sizes.
- Spinner → Default · Sizes · ThemeMatrix.

Patterns get the same treatment when they reach Storybook in
phase 3.

## Future additions

This doc collects baseline component-construction conventions as
they emerge. Likely future entries: slot-naming conventions,
primitive-vs-pattern boundary heuristics, accessibility-test
expectations per primitive shape. Add a section when the convention
is load-bearing across two or more primitives; until then, leave it
to per-primitive design passes.
