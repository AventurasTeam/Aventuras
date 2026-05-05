# Components

Component-construction conventions for Aventuras' UI primitives and
patterns. Sister to [`principles.md`](./principles.md) (philosophy
and architecture rules) and [`patterns/`](./patterns/README.md)
(pattern visual / interaction specs); this file holds the **how we
build** rules — sourcing, story conventions, anything else that
applies across every primitive and pattern shipped to Storybook.

## Directory layout

Components fan out across four buckets under `components/`. Layer
determines folder; folder determines Storybook `title:` prefix.

| Bucket           | Folder                  | Storybook `title:`          | What lives here                                                                                                                                                                                                           |
| ---------------- | ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primitives       | `components/ui/`        | `Primitives/<Name>`         | Single semantic role, generic, domain-agnostic. May internally compose sub-parts via slots / `asChild` / adornments, but exposes itself as one unit. Examples: Button, Input, Sheet, AlertDialog, Select, Tabs.           |
| Compounds        | `components/compounds/` | `Compounds/<Name>`          | Stable arrangement of **peer** primitives, each carrying its own semantic role. Generic (SwitchRow, FormRow) and Aventuras-specific (ListRow, Toolbar, SaveBar, JSONViewer, Importer) live together here.                 |
| Domain compounds | `components/<domain>/`  | `Compounds/<Domain>/<Name>` | Compound shape + vocabulary tied to one slice of the data model (entity kinds, branch shape, story fields, delta-log ops, etc.). Mirrors `docs/ui/screens/` granularity. Examples: KindIcon (entity), EntryCard (reader). |
| Shells           | `components/shells/`    | `Shells/<Name>`             | Top-level layout primitives that compose a screen route. Examples: MasterDetailLayout, ScreenShell, ListPane, DetailPane.                                                                                                 |

Decision rule when classifying a new component:

1. **Single semantic role, exposed as one unit?** → primitive (`components/ui/`), even when it internally composes sub-parts via slots / `asChild` / adornments. Heuristic: the public API is one component name; sub-parts (Title, Description, Trigger, Content, leading / trailing) are implementation, not the contract.
2. **Peer composition of multiple primitives, each carrying its own semantic role?** → compound. Heuristic: callers reason about each peer independently (e.g. SwitchRow's label + description text + the toggle are three peers; AlertDialog's Title + Action are sub-parts of one consent gate).
3. **Compound only — is it tied to exactly one slice of the data model** (entity, story, reader, etc.)? Yes → `components/<domain>/`. Otherwise (domain-agnostic _or_ touching multiple domains with no single owner) → `components/compounds/`. Earlier drafts split this into "generic" vs "cross-domain" buckets; the line was too thin to be useful and was collapsed.
4. **Does it shape a whole screen route** (header + body + footer envelope, master/detail split, list-pane container)? → shell (`components/shells/`).

Foundations explorers (`components/foundations/`) are an exception: they're Storybook-only documentation surfaces, not consumer-facing components, and use `Foundations/*` titles.

Hooks-only utilities (e.g. NavGuard) live in `hooks/`, not `components/`.

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
- **SwitchRow as the canonical boolean-setting shape**
  ([`components/compounds/switch-row.tsx`](../../components/compounds/switch-row.tsx),
  Phase 2 Group D). The pattern, not the standalone Switch, is the
  canonical cross-platform shape for boolean settings — same row-
  tappable interaction on every tier, no fork between mobile and
  desktop. Standalone Switch stays exported as a building block
  for non-row cases. Contract + cross-platform rationale live in
  the [SwitchRow pattern](./patterns/forms.md#switchrow-pattern).
- **Density-bound dimensions on Switch + Checkbox**
  ([`components/ui/switch.tsx`](../../components/ui/switch.tsx),
  [`components/ui/checkbox.tsx`](../../components/ui/checkbox.tsx),
  Phase 2 Group D). Track + thumb dimensions on Switch and box +
  check-icon on Checkbox read `useDensity()` and pick from a
  per-density map. Phone defaults to regular density (touch-
  friendly sizes); desktop defaults to compact (mouse-tight).
  Initial design called these "fixed, symbolic affordances" —
  mobile testing surfaced that fixed sizes felt miniscule on
  touch, so the decision was reversed and recorded with a
  SUBTRACTED note in each file's header.
- **Icon variant-prop sizing API + cssInterop color pipe**
  ([`components/ui/icon.tsx`](../../components/ui/icon.tsx),
  Phase 2 Group E). `size` accepts the iconography sizing tokens
  (`'sm' | 'md' | 'lg'` → 16/20/24 per
  [`iconography.md → Sizing scale`](./foundations/iconography.md#sizing-scale))
  with a numeric escape hatch for the rare non-canonical case.
  Replaces the partial Icon's NativeWind `size-N`-via-cssInterop
  path; callsites previously passed `size={20} className="size-5"`
  redundantly, all converted to `size="md"`. cssInterop on the
  underlying Lucide component pipes `style.color` → `color` prop on
  native, so `text-fg-muted` etc. apply (Lucide-RN's default
  `currentColor` only inherits via CSS, which RN doesn't have).
  `strokeWidth` defaults to 2 per the locked stroke contract.
- **Avatar size scale tied to v1 wireframe use sites**
  ([`components/ui/avatar.tsx`](../../components/ui/avatar.tsx),
  Phase 2 Group E). Reshaped from the react-native-reusables
  baseline (a single fixed `size-8` Radix-style triad). Sizes:
  `xs` (24 px, members-here mini-rows), `sm` (40 px, default row
  leading), `md` (96 px, compact peek head + mobile portrait
  reflow per
  [`world.md → Mobile expression`](./screens/world/world.md#mobile-expression)),
  `lg` (220 px, desktop overview hero portrait). Convenience shape
  takes inline `src` + `fallback` since most v1 sites render
  image-with-fallback; compositional `AvatarRoot / AvatarImage /
AvatarFallback` exports stay available for custom layouts.
  Fallback uses `bg-bg-sunken` + `border-border` for shape
  definition. Two slots ruled out along the way: `bg-bg-sunken`
  alone is invisible on themes where sunken sits within ~1-3 % of
  `bg-base` (cyberpunk, fallen-down, parchment, catppuccin-latte);
  `bg-fg-muted` (Switch's off-track slot) is visible everywhere
  but takes on theme tint where `fg-muted` is colored rather than
  achromatic — Royal goes purple, Aventuras Signature goes gold,
  Parchment goes brown — too prominent for a large avatar circle.
  `border-border` is calibrated by the registry to be visible
  against `bg-base` in every theme (it's the separator slot), so
  it crisps up the shape independent of fill contrast. Fallback
  content (initials, kind glyph) inherits `text-fg-secondary` via
  `TextClassContext` for a quiet-disc reading.
- **Spinner per-platform dispatch + slot-driven color**
  ([`components/ui/spinner.tsx`](../../components/ui/spinner.tsx),
  Phase 2 Group F). Web renders an SVG ring with `animate-spin` +
  `currentColor`; native delegates to RN's `<ActivityIndicator>`.
  Same dispatch shape as Sheet/Popover via `NativeOnlyAnimatedView`
  — the cross-cutting "NativeWind transition-\* on native"
  followup stays open because per-platform routes side-step it.
  Color is driven by a typed `colorSlot` prop (defaulting
  `--fg-primary`) rather than className: native's
  ActivityIndicator can't pick up `text-*` via CSS cascade (no
  DOM on RN) and there's no cssInterop hook into its `color`
  prop, so a className-color contract would silently no-op on
  native. Slot-based API keeps both platforms symmetric.
  Retrofit: Button's loading branch swapped from inline
  `<ActivityIndicator>` + manual `var(--*)`/`activeTheme.colors`
  plumbing to `<Spinner colorSlot={spinnerSlot} />`; the
  variant→slot table stays in Button.
- **Skeleton per-platform animation + className-driven dimensions**
  ([`components/ui/skeleton.tsx`](../../components/ui/skeleton.tsx),
  Phase 2 Group F). Web uses Tailwind's `animate-pulse` (CSS
  keyframes 1 → 0.5 → 1 over 2 s); native uses a reanimated
  `withRepeat` + `withTiming` opacity loop matching the same
  cadence. The web/native branch split happens at module
  boundary (the native branch lives in a sub-component so
  reanimated's worklet imports don't run on RN-Web). Dimensions
  are className-driven, not variant-prop — skeleton blocks
  compose to mimic real loading layouts (avatar-sized circles,
  line-of-text bars, multi-line stacks), and a fixed variant set
  would force consumers to compose multiple atoms anyway.
  Background uses `bg-fg-muted` (theme-tint acceptable here —
  the pulse animation carries the loading semantic regardless of
  color), same precedent as Switch's off-track.

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
