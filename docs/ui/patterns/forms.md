# Form-control patterns

Input primitives reused across settings, entity forms, and any
"pick a value" interaction. Sister patterns to
[`entity.md`](./entity.md) (entity detail-pane composition rules
that consume these), [`lists.md`](./lists.md), and
[`data.md`](./data.md).

Used by:

- [App Settings](../screens/app-settings/app-settings.md)
  (Select primitive across providers / profiles / story defaults;
  Input primitive for the API-key field with trailing show/hide
  eye; Switch primitive for appearance + behavior toggles)
- [Story Settings](../screens/story-settings/story-settings.md#generation-tab--definitional-fields--authoring-aids)
  (Select primitive across mode / narration / generation knobs;
  Autocomplete-with-create on the model field; Input + Textarea
  for prose definition fields; Switch primitive for per-story
  toggles)
- [Wizard](../screens/wizard/wizard.md#step-1--frame)
  (Select primitive in segment mode for mode / narration; calendar
  picker integration cite; Input + Textarea for genre / tone /
  setting fields, narrow numeric for year / day fields)
- [Reader composer](../screens/reader-composer/reader-composer.md#per-entry-actions)
  (Autocomplete-with-create primitive in entity / lore creation;
  Input + Textarea for entity / lore detail fields)
- [Onboarding](../screens/onboarding/onboarding.md)
  (Select primitive in initial setup flow)
- [Vault calendars](../screens/vault/calendars/calendars.md)
  (Select primitive in the calendar editor; narrow numeric Inputs
  for era year / day fields)
- [World](../screens/world/world.md#mobile-expression)
  (Select primitive on the list-pane category dropdown and as the
  detail-pane tab navigation when the desktop tab strip overflows
  on narrow tiers; Input + Textarea for entity edits)
- [Plot](../screens/plot/plot.md#mobile-expression)
  (Select primitive on the Threads / Happenings segment toggle and
  as the detail-pane tab navigation on phone)

---

## Select primitive

One primitive, three render modes. Component used everywhere a
"pick one of N values to commit" interaction surfaces in the app.

### Render modes

- **`segment`** — horizontal bordered button group. Best for ≤3
  options, label-only.
- **`dropdown`** — collapsed picker. Best for ≥4 options, or any
  cardinality where horizontal space is scarce (chrome carve-out
  below).
- **`radio`** — vertical list with explanatory copy per option.
  Triggered by content shape, not cardinality — when each option
  carries a `description` the segment/dropdown can't surface.

### Auto-derivation cascade

```
1. Explicit `mode` prop → use as-is.
2. Any option has a description field → radio.
3. Else if option count ≤ 3 (≤ 2 on mobile) → segment.
4. Else → dropdown.
```

Trigger for radio is **content shape**; trigger for segment vs
dropdown is **cardinality**. Independent axes.

**Cardinality threshold of 3** is the default for desktop; **bumps
to 2 on mobile** where horizontal real estate is tighter. Pinned
in [`mobile/foundations` Group C](../../explorations/2026-05-01-mobile-group-c-master-detail.md#tab-strip-overflow-rule)
alongside the tab-strip overflow rule.

**Phone-tier dropdown surface.** When the cascade picks `dropdown`
on phone, the trigger renders inline (chip / pill / select-shaped
button) and **opens via Sheet** — bottom sheets are the native
mobile pattern for value-pick from a list; web-style anchored
popovers are absent from native mobile UIs. Native-idiom rationale
in [`docs/explorations/2026-05-03-select-primitive.md → Why Sheet on phone, not Popover`](../../explorations/2026-05-03-select-primitive.md#why-sheet-on-phone-not-popover).

Sheet size auto-derives from option shape:

- **Sheet (short)** for flat lists of short labels (≤ ~6 options,
  no `group` field, no `description`). Default for the dropdown
  branch on phone.
- **Sheet (medium)** for grouped lists or option counts where short
  feels cramped (~7+ options, or any options carrying a `group`
  field). Auto-applied; `sheetSize` prop overrides. The
  [calendar picker pattern](./calendar-picker.md) is the canonical
  Sheet (medium) consumer — its richer rows + tail action go
  beyond Select's contract per the [open-shape followup](../../followups.md#calendar-picker-primitive--open-shape-decisions).

Tablet keeps the desktop anchored Popover — no edge-clipping risk
at tablet widths. Segment and radio render modes are unchanged at
every tier (segment is inline; radio is vertical list).

If a list outgrows Sheet (medium) — typeahead-shaped or genuinely
long (200+ rows like provider model lists) — the right primitive
is **Autocomplete**, not a richer Select. Same per-tier
idiomatic mapping applies to Autocomplete: anchored popover on
desktop, Sheet (tall) with input pinned at top + suggestions list
below on phone (see
[Autocomplete-with-create primitive](#autocomplete-with-create-primitive)).

The underlying Sheet and Popover primitive contracts (API surface,
rn-primitives mapping, slot reshape) live in
[`overlays.md`](./overlays.md). The phone-tier Sheet bridge is
implemented in-Select via `useTier()`; the
[`<ResponsiveOverlay>` helper question](../../followups.md#calendar-picker-primitive--open-shape-decisions)
stays parked for Phase 3 consumers (calendar picker, actions menu)
whose popover branch uses our Popover primitive — Select's popover
branch uses `@rn-primitives/select`'s own machinery, so a generic
helper can't host it. See [Implementation contract](#select--implementation-contract).

### Chrome carve-out

The cardinality rule applies in the **content area** — list panes,
detail panes, settings tabs, dialogs, drawers, form fields.

**In chrome** — top bars, sub-headers, toolbars, breadcrumbs —
**dropdown is allowed regardless of cardinality**, because
horizontal space is genuinely scarce.

The boundary is concrete: top of screen vs body. Story-list's sort
dropdown sits in the toolbar above the grid (chrome → dropdown OK
even at 3 options). Plot's segment toggle sits in the list-pane
controls (body → cardinality rule applies).

For genuinely ambiguous cases, **default to the primary cardinality
rule**; the carve-out is for clear chrome cases (top-bar, breadcrumb-
line dropdowns), not "anywhere wide-ish."

### What stays separate

- **Autocomplete-with-create primitive** — its own pattern, see
  [below](#autocomplete-with-create-primitive). Same conceptual
  family as Select but different surface area: typeahead against a
  list with a tail-create affordance.
- **Filter chips** — own primitive (rounded, wrap-capable layout,
  often paired with `All` accordion behavior). Filtering-centric
  concern, not "pick a value to commit." Folding into Select as a
  `chips` render mode is a possible future move; deferred until
  enough chip-using surfaces converge.
- **Preset+custom hybrid** — pattern used by chapter token
  threshold on
  [Story Settings → Memory](../screens/story-settings/story-settings.md#mobile-expression)
  and
  [App Settings → Memory](../screens/app-settings/app-settings.md#mobile-expression):
  three preset chips plus a `Custom…` chip that reveals a
  numeric input below. Doesn't fit Select's three render modes
  cleanly (cardinality 4 would route to dropdown, but the user
  needs to compare presets at a glance). Implemented as
  `.chip-row` with `.add-chip` cells — wraps naturally at narrow
  tiers. Not yet abstracted into its own primitive; if more
  preset+custom hybrids surface (e.g., recent buffer size,
  timeout windows), promote it to a named pattern.

### Storybook (Select)

Live demos of each render mode + the auto-derivation rule belong in
a `Patterns/Form controls/Select primitive` MDX page when component
implementation begins. The page cites this principle as canonical
and embeds component stories — no prose duplication. See
[`followups.md → Storybook design-rules pattern setup`](../../followups.md#storybook-design-rules-pattern-setup).

### Select — implementation contract

Phase 2 Group B locked the implementation shape per
[`docs/explorations/2026-05-03-select-primitive.md`](../../explorations/2026-05-03-select-primitive.md).
Highlights:

- **Two-layer architecture.** Public exports are `<Select>`
  (options-driven dispatcher resolving the cascade above) and
  `SelectPrimitive.*` namespace (reshaped reusables baseline, used
  by power consumers — calendar picker, future rich-row pickers).
- **Baseline source.** `react-native-reusables` Select scaffold
  reshaped over [`@rn-primitives/select`](https://www.npmjs.com/package/@rn-primitives/select)
  per [`components.md` reshape rules](../components.md#sourcing--react-native-reusables-as-baseline).
- **Phone-tier Sheet bridge.** `SelectPrimitive.Content` dispatches
  on `useTier()`: phone renders sheet-style chrome (bottom-anchored
  panel with drag handle visual, scrim, slide-in animation) inside
  `SelectBase.Portal` + `SelectBase.Overlay`, with
  `SelectBase.Content disablePositioningStyle` overriding the
  baseline anchor-positioning math. The phone branch can't reuse
  our `<Sheet>` primitive directly because Sheet's portal bridges
  Dialog's RootContext, not Select's; items inside would throw
  "compound components rendered outside the Select component".
  Tablet / desktop renders the rn-primitives select Portal /
  Overlay / Content (anchored popover, reusables baseline).
  Phone Sheet dismisses via tap-outside (Overlay), back-press,
  and drag-down — the gesture pattern is duplicated locally
  rather than shared with Sheet because the unmount-safety
  property each pattern relies on (fresh dragOffset per open) is
  satisfied independently by each primitive's portal returning
  null on close. A future Sheet refactor could extract the
  gesture+animation pattern into a shared portal-less shell.
- **Native scroll wrap.** Reusables baseline ships scroll-free on
  native (Viewport is a Fragment); reshape wraps it in
  `<ScrollView>` with viewport-fraction max-height. Web inherits
  baseline `max-h-52` + ScrollUpButton / ScrollDownButton.
- **Virtualization stays deferred** to Autocomplete's
  implementation pass per the
  [virtual-list followup](../../followups.md#virtual-list-library-choice).

---

## Input primitive

Single-line text input. The thinnest of the form primitives;
consumers compose label and helper text externally per the
project's compose-don't-encapsulate principle.

### Input — variants

- **`size`** — `sm`, `md` (default), `lg`. Resolves to the same
  `h-control-{sm|md|lg}` density tokens as Button.
- **`leading`** — adornment slot before the text. Typical content:
  a non-interactive `<Icon>` (search magnifying-glass, lock).
- **`trailing`** — adornment slot after the text. Typical content:
  an interactive press target (password show/hide eye,
  search-syntax info popover trigger, clear-x).

There is no `narrow` size for numeric fields. Width is a layout
decision — consumers pass `className="w-24"` (or similar) for
year / day-number inputs. Conflating height (density) with width
(layout) into a single variant would couple two independent
axes.

### Error state via `aria-invalid`

The primitive doesn't expose a `state` prop. Error styling fires
off `aria-invalid={true}` on the input — consumers drive validity
through ARIA the same way form libraries surface it. Border swaps
to `--danger`, focus ring swaps to `--danger/20`. The same pattern
applies to Textarea below.

### Adornment layout

When neither slot is set the primitive renders as a bare
`TextInput` (single-node tree, no wrapper). When either slot is
set, the primitive wraps the `TextInput` in a row View; the
border + focus ring move to the wrapper. On web,
`focus-within:border-accent` fires when the inner input is
focused; on native, an `onFocus`/`onBlur` state pair on the
wrapper drives the same class. Consumer concerns:

- **Trailing buttons own their own press affordance.** The slot
  wrapping View has padding only; interactive children
  (`Pressable`, `Button`) handle their own hit area and press
  state.
- **Trailing tap doesn't blur the input.** RN's TextInput keeps
  focus through sibling presses by default — password-eye toggles
  don't need `blurOnSubmit`-style workarounds.

### Input — implementation contract

Phase 2 Group C locked the implementation shape per
[`docs/explorations/2026-05-03-input-textarea-primitives.md`](../../explorations/2026-05-03-input-textarea-primitives.md).
Highlights:

- **Baseline source.** `react-native-reusables` Input scaffold
  reshaped over RN's `TextInput` per
  [`components.md` reshape rules](../components.md#sourcing--react-native-reusables-as-baseline).
- **NativeWind 4 variant bridges.** `placeholder:` resolves to
  `placeholderTextColor` on RN; `aria-invalid:` honors the ARIA
  attribute on both platforms.
- **Selection color** uses `--accent` / `--accent-fg` (web only —
  RN doesn't surface text-selection colors).

---

## Textarea primitive

Multi-line text input. Same upstream primitive as Input
(`TextInput` with `multiline`), but split for clarity and to keep
multiline-specific props off the single-line surface.

### Textarea — variants

- **`rows`** — initial / minimum visible line count. Default `3`.
- **`maxRows`** — line count past which the textarea scrolls
  internally. Default `10`.
- **`aria-invalid`** — same error contract as Input.

There is no `size` prop; Textarea height is content-driven via
`rows` and `maxRows`. There are no adornment slots; multiline
content doesn't compose visually with leading / trailing icons,
and no v1 wireframe needs it.

### Auto-grow across platforms

- **Web** — `field-sizing: content` (modern CSS) handles
  content-driven height with no JS. The `min-h` / `max-h` envelope
  bounds it.
- **Native** — `onContentSizeChange` updates a measured-height
  state, applied as inline `height` clamped to the
  `[minHeight, maxHeight]` envelope derived from
  `rows × line-height + padding × 2` and
  `maxRows × line-height + padding × 2` respectively. Padding
  reads from the active density's `--row-py-md` token; line-height
  is fixed at NativeWind's `text-sm` default (20px).

User-driven vertical resize (drag the corner) is web-only via
`resize-y`. Native has no resize handle.

### Textarea — implementation contract

- **Baseline source.** Same as Input — `react-native-reusables`
  scaffold reshaped over `TextInput`.
- **Pure envelope math** lives in
  `components/ui/textarea-envelope.ts` so the unit tests can
  import it without dragging in NativeWind / RN / density-context.
  Vitest's unit project has no `@/` alias; keeping the math
  dependency-free is the cheapest path to test isolation.

---

## Switch primitive

Boolean toggle for binary settings. Single visual axis: on / off.
No size prop — Switch dimensions are intentionally fixed (not
density-token-driven). Switches are symbolic affordances whose
perceived size stays constant across densities; the label adjacent
to a Switch (consumer-composed) does follow density.

### Switch — visual contract

- **Track.** `bg-bg-sunken` when off; `bg-accent` when on. Always
  rounded-full; `border border-transparent` reserves layout space
  for the focus ring without shifting the layout.
- **Thumb.** Always `bg-bg-base` (provides contrast on both track
  states across light + dark themes). Translates from
  `translate-x-0` (off) to `translate-x-3.5` (on).
- **Disabled.** `opacity-50` on the entire control.
- **Web focus ring.** Standard `focus-visible:border-accent
focus-visible:ring-focus-ring/50`.

### Switch — implementation contract

- **Baseline source.** `react-native-reusables` Switch scaffold
  reshaped over `@rn-primitives/switch` (Root + Thumb).
- **Required props.** `checked`, `onCheckedChange`. Storybook
  static states pass a no-op handler.

---

## Checkbox primitive

Boolean affordance distinct from Switch — used for multi-select
lists and "I agree" gating. v1 surfaces using it: the multi-select
group pattern (entity bulk-edit, tag-pickers).

### Checkbox — visual contract

- **Box.** `size-4` square with `rounded-[4px]`, `border
border-border bg-bg-base`. Border swaps to `border-accent`
  when checked, `border-danger` when invalid.
- **Indicator.** Filled `bg-accent` rectangle inside, with a
  `Check` icon in `text-accent-fg`. Indicator is rendered only
  when checked.
- **Hit slop.** `hitSlop={24}` on native — boosts the tap-target
  past the 16px visual without growing the box.
- **Disabled.** `opacity-50`.
- **Web focus ring.** Standard `focus-visible:border-accent
focus-visible:ring-focus-ring/50`.

### Checkbox — implementation contract

- **Baseline source.** `react-native-reusables` Checkbox scaffold
  reshaped over `@rn-primitives/checkbox` (Root + Indicator).
- **Error styling driven from JS** via `aria-invalid` prop reading
  rather than the CSS `aria-invalid:` Tailwind variant. Same
  reliability strategy as Input + Textarea — RN-Web doesn't
  always forward arbitrary aria-\* attributes from rn-primitives
  wrappers, so the CSS attribute selector silently misses.

---

## Autocomplete-with-create primitive

Single text input with a live filtered dropdown and a tail-create
option. Used wherever the user picks from a known list **OR**
contributes a new entry to the same field — narrative free-text
fields where canonical suggestions exist but coverage is open.

**First user**: era flip's `era_name` input (per
[era-flip design](../../explorations/2026-04-28-era-flip-affordance.md)).
Likely future users: tag pickers, entity-link pickers when an
ad-hoc entity is acceptable, entry-ref pickers.

### Anatomy

- **Text input** — always present, focused on open in modal
  contexts.
- **Dropdown surface — per-tier idiomatic.** On desktop / tablet,
  the suggestions render in an anchored popover below the input.
  On phone, the input + suggestions render inside a bottom Sheet
  (tall, ~95vh) with the input pinned at the top, the keyboard
  below, and the filtered list scrolling between. Mirrors the iOS
  Mail recipient-picker / Spotlight idiom; matches Select's
  Sheet-on-phone shape so the two primitives stay visually
  consistent within each tier. Phase 2 ships Select with this
  contract; Autocomplete's own implementation pass lands later.
- **Dropdown content** — appears below the input on focus / typing.
  Two zones:
  - **Suggestions** (top) — entries from the source list filtered
    by the typed value (case-insensitive substring match by
    default; short lists don't need fuzzy matching). Up to ~7
    visible; scroll within the dropdown beyond that.
  - **`+ Add new: "<typed>"` row** (bottom) — appears only when
    the typed value doesn't exactly match any source entry
    (case-insensitive comparison). Visually distinct from
    suggestions (e.g., separator above + muted "+ Add new" label
    prefix).

### Source list semantics

- **Empty / absent source** — no suggestions; the dropdown shows
  only the `+ Add new` row when the user has typed something.
  Component degrades cleanly to a free-form input with consistent
  UI.
- **Casing normalization** — exact case-insensitive match against a
  source entry **commits in the source's canonical case**. Typing
  `"reiwa"` against `['Reiwa']` commits `Reiwa`. Preserves the
  intent of curated source lists; users don't have to nail casing
  to hit a known value.
- **Match on whitespace-trimmed value** — leading/trailing
  whitespace ignored for matching; commit value is also trimmed.

### Default Enter behavior

- **Has matching suggestions** → pick the first match (commit in
  canonical casing).
- **No matching suggestions** → treat as `+ Add new` and commit
  the trimmed typed text.

Empty input is a no-op on Enter — the consuming form decides
whether the field is required (and disables its submit button
accordingly per the standard form pattern).

### Configurability per use site

Use-site config props (informative; finalize at component
implementation):

- `sourceList: string[]` — the suggestions; may be empty / absent.
- `casingNormalization: 'canonical' | 'as-typed'` — default
  `canonical`. Use `as-typed` when the source list is hint-only
  rather than canonical (e.g., tag lists where users may
  intentionally re-case).
- `createTailLabel: string` — copy for the tail row; `+ Add new:
"{value}"` is the default template.
- `placeholder: string`, `required: boolean` — standard form
  affordances.

### Interaction with edit-restrictions

The component disables uniformly during in-flight pipelines, per
[`principles.md → Edit restrictions during in-flight generation`](../principles.md#edit-restrictions-during-in-flight-generation).
Disabled state shows the typed value (no dropdown, no tail row),
hover/focus reveals the same uniform tooltip every other gated
control uses.

### Storybook (autocomplete)

Live demos for: source-list-with-presets (era flip pattern),
empty-source (free-form-only behavior), casing-normalization
in action, the tail-create-on-new-typed-value state. Belongs in
the same `Patterns/Form controls/` Storybook tree as the Select
primitive when component implementation begins.
