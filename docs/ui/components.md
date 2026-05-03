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

## Augmentation — when adding API beyond baseline

Reshape covers renaming or re-tokenizing existing baseline API.
Adding new API surface goes beyond reshape and is allowed only
when all three hold:

- **Maps onto Aventuras's slot or token system.** New variants /
  props express our domain vocabulary (color slots, size scale,
  semantic axes), not generic shorthand for arbitrary classNames.
- **Doesn't duplicate baseline API.** No parallel mechanism for
  the same concern (e.g., don't add a `bold` prop when className
  `font-bold` already works).
- **Documented in-file.** A header comment in the primitive's
  `.tsx` names what was augmented and why, citing this section.

Documented precedents:

- **Text's orthogonal `variant` (color) + `size` axes**
  ([`components/ui/text.tsx`](../../components/ui/text.tsx))
  split what reusables ships as a single semantic-typography
  variant axis into two visual axes that map onto Aventuras's
  `--fg-*` color slots and the typography ramp. Justified in the
  file's header comment.
- **Heading primitive** ([`components/ui/heading.tsx`](../../components/ui/heading.tsx))
  ships as a sibling primitive on top of Text rather than a Text
  variant, because heading-level is a semantic axis (drives
  `role="heading"` + `aria-level`) orthogonal to Text's visual
  axes. Bakes in default size + weight per level matching the
  MUI-style theme-driven typography pattern. Justified in the
  file's header comment.
- **Select dispatcher** (`components/ui/select.tsx`, lands with
  Phase 2 Group B impl) ships as a high-level public layer
  (`<Select options={...} />`) on top of the reshaped
  `react-native-reusables` baseline (which itself wraps
  `@rn-primitives/select`). The dispatcher resolves the
  [forms.md auto-derivation cascade](./patterns/forms.md#auto-derivation-cascade)
  (segment / radio / dropdown) at runtime; the reshaped baseline
  pieces are also exported as a `SelectPrimitive.*` namespace for
  power consumers (calendar picker, future rich-row pickers).
  Justified in the file's header comment per the
  [Select implementation contract](./patterns/forms.md#select--implementation-contract).
- **Density-aware sizing tokens** are baseline contract, not
  augmentation, but worth pinning here: primitives consume
  `h-control-md`, `py-row-y-md`, etc. (per
  [`spacing.md → Density toggle`](./foundations/spacing.md#density-toggle))
  rather than literal `h-10` / `py-2`. The token swaps per active
  density; primitives stay terse and consistent. Retrofitting a
  primitive from literal sizing → density tokens is mechanical
  (className edit only, no API change).
- **Input adornment slots + ARIA-driven error state**
  ([`components/ui/input.tsx`](../../components/ui/input.tsx),
  Phase 2 Group C). `leading` / `trailing` slots ship as augmented
  API (concrete v1 consumers: search-info popover, password
  show/hide, API-key reveal). The wrapper-vs-bare render switch
  keeps the common case a single-node tree. Error styling
  intentionally has **no** `state` prop — `aria-invalid={true}`
  drives the danger border + ring, matching how form libraries
  surface validity through ARIA. Width is also intentionally not
  a size variant — narrow numeric Inputs use `className="w-24"`
  rather than a `narrow` size, since width is a layout axis
  independent of height (density). Justified in the file's header
  comment per the
  [Input implementation contract](./patterns/forms.md#input-primitive).
- **Textarea height envelope + cross-platform auto-grow**
  ([`components/ui/textarea.tsx`](../../components/ui/textarea.tsx),
  Phase 2 Group C). `rows` / `maxRows` define a min/max height
  envelope; web grows via `field-sizing-content`, native grows
  via `onContentSizeChange` clamped to the same envelope. The
  pure envelope math lives in
  `components/ui/textarea-envelope.ts` so unit tests can import
  without dragging in NativeWind / RN. Justified per the
  [Textarea implementation contract](./patterns/forms.md#textarea-primitive).
- **Checkbox ARIA-driven error state**
  ([`components/ui/checkbox.tsx`](../../components/ui/checkbox.tsx),
  Phase 2 Group D). Error styling reads `aria-invalid` from props
  and applies `border-danger` from JS rather than the CSS
  `aria-invalid:` Tailwind variant. Same reliability strategy as
  Input + Textarea — RN-Web doesn't always forward arbitrary
  aria-\* attributes from rn-primitives wrappers to the rendered
  element. Justified per the
  [Checkbox implementation contract](./patterns/forms.md#checkbox-primitive).
- **Select.radio + Select.segment compose @rn-primitives/radio-group**
  ([`components/ui/select.tsx`](../../components/ui/select.tsx),
  Phase 2 Group D retrofit). Radio + segment render branches that
  were previously hand-rolled with bare Pressable rows now use
  `@rn-primitives/radio-group` (Root + Item) for arrow-key
  navigation, roving tabindex, and ARIA role wiring. Standalone
  Radio primitive intentionally not exported — Select.radio covers
  every wireframe consumer; if a non-description radio case ever
  surfaces, extend Select rather than duplicate the primitive.

## Subtraction — when removing baseline features

Removing or replacing baseline features is allowed only when all
three hold:

- **Replaced by an Aventuras-native equivalent.** The capability
  isn't lost — it's expressed via a different mechanism that
  better fits the project's vocabulary.
- **Accessibility and composition contracts aren't degraded.**
  Roles, ARIA properties, and rn-primitives lifecycle delegation
  (focus trap, scroll lock, dismiss-on-outside) are invariants;
  removing them without replacement is not allowed.
- **Documented in-file.** Same header-comment rule as
  augmentation.

Documented precedents:

- **Text dropped reusables' typography variants** (h1-h4, p,
  blockquote, code, lead, large, small) and the embedded
  `ROLE` / `ARIA_LEVEL` mapping. Replaced by orthogonal `variant`
  (color slot) + `size` (typography ramp) for visual styling and
  the new sibling [`Heading`](../../components/ui/heading.tsx)
  primitive for heading semantics. The accessibility contract is
  restored, not degraded.

Anti-pattern, surfaced retrospectively: phase 1 text.tsx
originally subtracted `ROLE` / `ARIA_LEVEL` _without_ replacement,
which was an a11y regression caught during phase 2 Group A
implementation. The reconciliation that introduced the Heading
sibling brought the file back into policy compliance and
motivated codifying this section.

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
  (Button: yes; Sheet: no; Input: no, since `leading` / `trailing`
  ship as adornment slots and error state is ARIA-driven, not
  a variant axis).
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
  **Portal-using primitives skip ThemeMatrix.** Sheet, Popover,
  and any future Modal portal their content to document.body,
  escaping the per-row `dataSet={{theme}}` scope. The trigger
  themes correctly but the open content inherits Storybook's
  global theme. For these, theme verification falls to the
  Storybook toolbar's global theme switcher (one theme at a
  time on web), or the dev page's `<ThemePicker />` on native
  (where `data-theme` is set globally and portals inherit
  correctly). Each story file carries an in-file comment
  documenting this.

Indicative shapes by primitive:

- Button → Default · Variants · Sizes · States · Shapes ·
  ThemeMatrix.
- Sheet / Popover → Default · States · ThemeMatrix.
- Input / Textarea → Default · Sizes · States · ThemeMatrix.
- Select → Default · Variants (segment / radio / dropdown render
  modes per [`patterns/forms.md`](./patterns/forms.md#auto-derivation-cascade))
  · States · ThemeMatrix (partial — segment + radio covered;
  dropdown skipped per the portal-skip rule because the open
  content escapes per-row dataSet scoping). No Sizes section: the
  `<Select>` dispatcher has no size axis. `SelectPrimitive.Trigger`
  has a `default | sm` size prop for power consumers, but that's
  primitive-layer internal — not exposed through the dispatcher.
- Switch / Checkbox / Radio → Default · States · ThemeMatrix.
- Icon → Default · Sizes · ThemeMatrix.
- Skeleton → Default · Sizes.
- Spinner → Default · Sizes · ThemeMatrix.

Patterns get the same treatment when they reach Storybook in
phase 3.

### Density coverage

Primitives that consume density-aware tokens (per
[`spacing.md → Density toggle`](./foundations/spacing.md#density-toggle))
get a **Density** story — one row per `compact` / `regular` /
`comfortable` value. Storybook's toolbar gains a global Density
dropdown (sister to the Theme dropdown) for ad-hoc swapping
during development.

The Density story is **separate from ThemeMatrix** — both axes
matter, but a 3 × 10 = 30-cell matrix is overkill. Per-axis
isolation suffices: ThemeMatrix tests theme-divergent slots at a
single density; Density story tests sizing-divergent slots at a
single theme. The toolbar density+theme dropdowns let
maintainers switch axes interactively when they need a
combination not in the rendered stories.

## Testing — verification surfaces per primitive

Two surfaces; each covers what the other doesn't:

- **Storybook stories** — visual and composition behavior. Variants
  across themes, sizes, prop combinations, accessibility states.
  Catches token-resolution bugs, layout regressions, theme-divergent
  rendering. **Mandatory for every primitive shipped.**
- **Vitest** — Aventuras-specific runtime logic. The third category
  of code in a reshaped primitive's file: domain logic that's neither
  thin rn-primitives wrapping nor variant-to-className mapping.
  Examples: Button's `SPINNER_SLOT_BY_VARIANT` resolution with
  native-vs-web theme-color reading, custom hooks composing focus
  management with save-session guards, drag-to-dismiss threshold
  math we own (vs. gesture-handler defaults).

What stays untested deliberately:

- **Variant → className wiring.** Fragile against token renames,
  low-value (wrong color or class shows up immediately in Storybook
  ThemeMatrix).
- **rn-primitives behavior we delegate to.** Already battle-tested
  upstream — focus trap, scroll lock, dismiss-on-outside, anchor
  positioning.
- **Composition glue.** Forwarding children, spreading props,
  context-providing wrappers — visible in Storybook the moment a
  consumer uses them.

Existing Vitest scope (in [`lib/`](../../lib/)) matches the
third-category boundary: theme registry shape, color contrast
math, CSS generator output, theme-hook state machine, themes-audit
logic. No tests in
[`components/ui/`](../../components/ui/) at the close of phase 1
because Button and Text are mostly thin wrappers; phase 2's
overlay primitives expect the same. Tests land when an
Aventuras-runtime fragment emerges that warrants one (Button's
spinner-color resolution is a candidate to backfill if it ever
breaks).

## Future additions

This doc collects baseline component-construction conventions as
they emerge. Likely future entries: slot-naming conventions,
primitive-vs-pattern boundary heuristics, accessibility-test
expectations per primitive shape. Add a section when the convention
is load-bearing across two or more primitives; until then, leave it
to per-primitive design passes.
