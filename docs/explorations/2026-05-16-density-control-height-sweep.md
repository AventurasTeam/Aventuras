# Density-aware control height sweep

Closes the "Density-aware input component height sweep" followup
(removed from `docs/followups.md` in the same commit that lands this
exploration). The forcing function was a Toolbar build-pass observation:
filter chips and the Sort dropdown sit on the same row at narrow tiers
and read as different control types because Chip's padding-driven
natural height (~34 px at regular density) didn't align with any named
`h-control-*` token, forcing Toolbar.Sort to reach for raw Tailwind
`h-9` (36 px) as the closest match. That mismatch is the visible
symptom; the underlying gap is a missing primitive-height contract for
chrome rows.

This design pass produces the contract and audits every density-aware
primitive against it. No code changes — code follow-ons listed under
[Integration](#integration) land in a separate commit after the
canonical docs settle.

## Scope

The audit covers every density-aware interactive primitive currently
in [`components/ui/`](../../components/ui/):

- **Labeled chrome controls** consuming `h-control-*` tokens:
  Input, Textarea (content-driven, no `h-control-*`), Select Trigger,
  Button, Chip.
- **Square icon-button affordances** consuming `h-icon-action-*`
  tokens: IconAction (and Button's `size="icon"` shape — separate).
- **Shape-distinct controls** with inline per-density visual tables:
  Switch, Checkbox.
- **Wrapper primitives** that inherit from a wrapped primitive:
  Autocomplete (wraps Input), TagInput (wraps Input and Tag).

Tag is excluded — it's content-sized, not part of the control-h system
([Section 1](#chips-tier-rule)).

## Decisions

### Chip's tier rule

Chip is fixed at `h-control-xs`. No `size` prop. The identity is
"dense chrome control" — the
[`h-control-xs`](../ui/foundations/spacing.md#component-internal-sizing-tokens--density-aware)
tier name was written for exactly this role. Consumers wanting a
larger interactive pill reach for Button; consumers wanting a smaller
labeled pill reach for Tag. Chip occupies one slot in the taxonomy
and that slot is dense-chrome.

**API impact** — none visible to consumers. The current Chip surface
(toggleable via `selected` + `onPress`, static via children-only) stays
unchanged. Both interactive and static Chip use cases — documented at
[`chips.md → Chip — square, toggleable`](../ui/patterns/chips.md#chip--square-toggleable)
and exercised by current consumers (Toolbar, StoryCard, CalendarPicker,
CollisionResolveDialog) — fall under the same height rule.

**Padding implications.** The current Chip class composes
`px-row-x-sm py-row-y-xs` (padding-driven natural height ~34 px at
regular density). Once height is enforced explicitly:

- `h-control-xs` becomes the canonical height token, replacing the
  padding-driven path.
- `py-row-y-xs` becomes dead code (height wins over content
  padding-y on a fixed-height flex-centered control). Drop it.
- `px-row-x-sm` stays — horizontal padding is an independent concern
  (compactness for chip-cluster density).
- Inner content (text-xs, 12 px) plus 1 px border fits cleanly within
  the 36 px envelope at regular density. Tight at compact density
  (32 px), but the existing density doc accepts that as an explicit
  user opt-in.

**Doc home.** `patterns/chips.md` gets a new `## Height` section
between the existing `## Chip — square, toggleable` and
`## Tag — pill, labeled content` sections. Codifies the tier choice +
the Chip vs Button vs Tag taxonomy distinction (height-fixed dense
chrome / height-variant control / content-sized tag-shape) explicitly,
and confirms the height rule applies to interactive and static Chip
alike.

### Chrome-row contract — primary input vs secondary chrome cluster

A new section in
[`patterns/toolbar.md`](../ui/patterns/toolbar.md), inserted between
`## Compound API` and `## Cross-tier overflow rule`, with heading
`## Height contract — primary input vs secondary chrome cluster`.

**The rule.** A Toolbar instance has two height roles, and consumers
don't pick the tier — the role does.

- **Primary input** — zero or more focal labeled controls consumers
  actively type into. In Toolbar today this is `Toolbar.Search`.
  Renders at `h-control-md` (44 px at regular density). HIG-clean on
  mobile by construction; visually taller signals "this is the focal
  interactive surface; the rest modify it."
- **Secondary chrome cluster** — labeled affordances that modify or
  filter the primary input's behavior. In Toolbar today:
  `Toolbar.FilterChips` (Chip children) and `Toolbar.Sort`. All
  render at `h-control-xs` (36 px regular). Mutually height-uniform
  by construction — Chip is fixed at xs per
  [Section 1](#chips-tier-rule); `Toolbar.Sort` uses `Select size="xs"`
  per [Section 3](#selectsize-public-exposure).

**Why two heights, not one.** The "same height feels right for
adjacent controls" lean is satisfied **within** the secondary cluster
(Chip + Sort mutually align). It is **not** extended across
primary↔secondary — that would force Search below HIG
(36 px < 44 pt), which the density doc explicitly preserves as a v1
invariant per
[`spacing.md → Tap-target on native`](../ui/foundations/spacing.md#tap-target-on-native).
Real-world chrome-row designs (browser address bars dwarfing icon
clusters; macOS toolbars; Slack channel headers) all do this two-tier
split. The Chip-vs-Sort mismatch the original followup documented was
about two **secondary** affordances reading as different control
types — the contract fixes that without touching primary-input
sizing.

**Cross-tier composition** stacks with the existing overflow rule:

- **Desktop (≥ 1024 px)**: single horizontal row, two heights — Search
  at md, Chips and Sort at xs. The 8 px height delta reads as visual
  hierarchy, not inconsistency.
- **Tablet / phone (< 1024 px)**: Search on its own row at md; Chips
  and Sort overflow into a secondary row, both at xs. The overflow row
  **is** the secondary cluster; everything in it is height-uniform.

**Out of scope of the contract.**

- **IconAction in Toolbar.** IconAction uses its own
  [`h-icon-action-*`](../ui/foundations/spacing.md#component-internal-sizing-tokens--density-aware)
  token system (28 / 32 / 36 px at regular for sm / md / lg),
  intentionally smaller than control-h tokens. If a future Toolbar
  adds an IconAction to the chrome cluster (e.g., a "clear filters"
  trash icon), it doesn't height-align with the labeled controls —
  square icon buttons are shape-distinct by design. The contract
  applies only to labeled chrome controls.
- **Toolbar without a primary input.** Pure-chrome Toolbar (Chips +
  Sort, no Search) collapses to one height — the secondary cluster at
  xs. No special case; the rule just doesn't have a primary role to
  apply.
- **Other chrome-row compounds.** The contract is **local to
  Toolbar** for v1. Promote to
  [`principles.md`](../ui/principles.md) when the next consumer
  (DeltaLogRow's badge+controls adjacency, StoryCard's status-strip)
  needs the same rule.

### `Select.size` public exposure

The internal Trigger in
[`components/ui/select.tsx`](../../components/ui/select.tsx) has a
private `size: 'default' | 'sm'` prop, resolving `default →
h-control-md` and `sm → h-control-sm`. The public `<Select>`
dispatcher doesn't expose `size`. **No `xs` size exists internally
either** — that's why `Toolbar.Sort` reached for raw `h-9` instead of
a named token.

**Proposed shape.**

- Add `xs` to the internal Trigger size variants, resolving to
  `h-control-xs`.
- Expose `size?: 'xs' | 'sm' | 'md'` on the public `<Select>` props,
  default `'md'` (unchanged from today).
- **No `lg`** — Select-as-hero-CTA isn't a v1 shape. If a consumer
  surfaces (unlikely; CTAs are Button-shaped), add later.
- **Internal rename** `'default'` → `'md'` so the variant names match
  the public API and the underlying token names. One-touch refactor
  inside select.tsx; no consumer-visible impact since `default`
  wasn't public.

**Phone Sheet branch unaffected.** Sheet sizes (`short | medium`) come
from option-count derivation per the existing cardinality cascade.
Trigger size only affects the trigger button itself.

**Doc home.** `patterns/forms.md → Select primitive`. Add a new
`### Trigger sizes` subsection after
[`### Chrome carve-out`](../ui/patterns/forms.md#chrome-carve-out)
(natural placement since chrome rows are the actual consumer of
non-default sizes). Brief: name the three variants, point at
`Toolbar.Sort` as the `xs` exemplar per the chrome-row contract,
cross-link to the inventory in spacing.md.

### Switch + Checkbox envelope verification

Audit result: **code matches the doc.**

- Switch
  ([`switch-visual.tsx`](../../components/ui/switch-visual.tsx)):
  compact `h-[1.15rem] w-8`, regular `h-6 w-11`, comfortable
  `h-7 w-12`. Thumb and translate values match the table at
  [`forms.md → Switch — visual contract`](../ui/patterns/forms.md#switch--visual-contract).
- Checkbox ([`checkbox.tsx`](../../components/ui/checkbox.tsx)):
  compact `size-4`, regular `size-5`, comfortable `size-6`. Matches
  [`forms.md → Checkbox — visual contract`](../ui/patterns/forms.md#checkbox--visual-contract).

**Should these values be tokenized into `spacing.md`? No — leave
inline.**

Three reasons:

1. **No reusability case.** `h-control-*` earns tokenization because
   every labeled chrome control reads from the same slot. Switch and
   Checkbox each have a unique anatomy (track and thumb for Switch;
   box for Checkbox) that no other primitive composes from. Tokens
   here would be 1-consumer indirections.
2. **Multi-dimensional values.** Switch's per-density bundle is four
   values (track-h, track-w, thumb-size, thumb-translate-x).
   Tokenizing requires either four parallel tokens per density (12
   tokens for one primitive) or a composite token model. Both are
   heavier than the inline lookup tables currently in
   `switch-visual.tsx`.
3. **Discoverability already covered.** The forms.md per-primitive
   visual contract tables host the values canonically. Future
   audits read those tables, not the code.

**No doc changes** to canonical patterns. The audit result + the
"stay inline" decision are recorded here; the
[primitive height inventory](#primitive-height-inventory-in-spacingmd)
includes Switch + Checkbox with a "shape-distinct; not part of
control-h system" annotation so the choice surfaces from the
inventory's perspective.

**Tap-target sanity.** Switch at regular = 24 h × 44 w — width meets
HIG 44 pt; height doesn't, but Switch is always paired with a label
in the
[`SwitchRow` pattern](../ui/patterns/forms.md#switchrow-pattern) whose
row-shaped tap target handles the SLA. Checkbox at regular = 20 × 20
relies on either SwitchRow-style row wrap or `hitSlop` for standalone
use. Neither is broken by this design; noted for completeness.

### `tailwind-merge` config

Audit result: **the custom config already exists and is correct.** The
followup text — and the comment block above `Toolbar.Sort`'s
`className={cn('h-9', className)}` call in
[`components/compounds/toolbar.tsx`](../../components/compounds/toolbar.tsx)
("`h-control-sm` is a custom token tailwind-merge doesn't recognize as
conflicting with `h-control-md`") — is **stale.**

Evidence:
[`lib/utils.ts`](../../lib/utils.ts) registers
`control-{xs,sm,md,lg}` and `icon-action-{sm,md,lg}` under the `h`,
`w`, and `min-h` class groups via `extendTailwindMerge`. Row padding
tokens (`row-x-*`, `row-y-*`) are registered under every relevant
padding class group. `cn('h-control-md', 'h-9')` correctly dedupes to
keep only the consumer override; `cn('h-control-md', 'h-control-xs')`
correctly dedupes to keep `h-control-xs`.

The toolbar.tsx code path the followup pointed at is exactly what
[Section 2](#chrome-row-contract--primary-input-vs-secondary-chrome-cluster)
and [Section 3](#selectsize-public-exposure) retire: `Toolbar.Sort`
migrates from `className={cn('h-9', className)}` to
`<Select size="xs">`, and the stale comment + escape hatch both
delete in the consumer-migration commit.

**Produced changes.**

- No new tailwind-merge config — existing extension covers this
  design.
- The stale `Toolbar.Sort` comment block deletes with the consumer
  migration (code follow-on, not a doc change).
- **One small doc-discoverability addition** in `spacing.md`: a
  one-liner near the
  [Component-internal sizing tokens](../ui/foundations/spacing.md#component-internal-sizing-tokens--density-aware)
  table cross-linking lib/utils.ts ("custom token families are
  registered with tailwind-merge in
  [`lib/utils.ts`](../../lib/utils.ts); mirror new families there
  when adding to `tailwind.config.js`"). Keeps the policy
  discoverable from the canonical token doc.

### Primitive height inventory in `spacing.md`

A new `### Primitive height inventory` subsection sits in
[`spacing.md`](../ui/foundations/spacing.md), inserted right after the
[Component-internal sizing tokens](../ui/foundations/spacing.md#component-internal-sizing-tokens--density-aware)
token tables and before `### Tap-target on native`. Logical
grouping — token definitions immediately above; consumer enumeration
immediately below.

Short prose intro above the table:

> Density-aware primitives consume the tokens defined above, plus
> their own per-primitive size variants. The table below enumerates
> each primitive's tier source, default size, and publicly-exposed
> size variants — the canonical reference when composing chrome rows
> or auditing height consistency.

The table:

| Primitive            | Height source             | Default     | Sizes exposed      | Notes                                                       |
| -------------------- | ------------------------- | ----------- | ------------------ | ----------------------------------------------------------- |
| Input                | `h-control-*`             | `md`        | `sm` / `md` / `lg` | —                                                           |
| Textarea             | content-driven            | —           | —                  | `rows` + `maxRows`                                          |
| Select Trigger       | `h-control-*`             | `md`        | `xs` / `sm` / `md` | `xs` added by this design                                   |
| Button (label)       | `h-control-*`             | `md`        | `sm` / `md` / `lg` | —                                                           |
| Button (`size=icon`) | `h-control-* w-control-*` | square `md` | `icon`             | square primary-action icon shape at control-h-md            |
| IconAction           | `h-icon-action-*`         | `md`        | `sm` / `md` / `lg` | own token family — distinct from `Button size="icon"`       |
| Chip                 | `h-control-xs` (fixed)    | `xs`        | none               | dense-chrome identity per [Section 1](#chips-tier-rule)     |
| Switch               | inline per-density tables | —           | —                  | shape-distinct; track + thumb tables in `switch-visual.tsx` |
| Checkbox             | inline per-density tables | —           | —                  | shape-distinct; box dimensions in `checkbox.tsx`            |
| Autocomplete         | inherits Input            | inherits    | inherits           | wraps Input                                                 |
| TagInput             | inherits Input            | inherits    | inherits           | wraps Input + Tag                                           |

Short prose note below the table covering the two boundaries readers
will need:

> **Button `size="icon"` vs IconAction.** Both render as square icon
> buttons but at different scales: `Button size="icon"` is a primary
> action shape at `h-control-md` (44 px regular); IconAction is the
> row-nestled secondary affordance at `h-icon-action-md` (28 px
> regular). Not interchangeable — pick by role.
>
> **Switch + Checkbox stay inline.** Their per-density values aren't
> tokenized into spacing.md because each has a multi-dimensional
> per-density bundle (track-h + track-w + thumb-size + thumb-tx for
> Switch; box-size for Checkbox) used by exactly one primitive. The
> [forms.md visual contract](../ui/patterns/forms.md#switch--visual-contract)
> tables remain canonical for their values.

**Maintenance discipline.** Two surfaces:

- A self-policing footnote inside the inventory subsection: "Update
  this table when a primitive's tier source or exposed sizes change.
  The table is the canonical reference; drift makes future audits
  more expensive than the per-PR upkeep."
- A one-line cross-link in
  [`components.md → Density coverage`](../ui/components.md#density-coverage)
  pointing readers to the inventory and naming the update obligation.
  Components.md hosts component-authoring conventions, so it's the
  natural surface for "when adding a primitive, here's what else to
  update."

**No CI gate proposed.** A code-vs-doc consistency check is
technically possible but over-engineered for v1; if the inventory
drifts within a few months, revisit with a lighter mechanism (e.g.,
extending `pnpm lint:docs` to grep-check primitive files against the
table).

## Adversarial findings

Adversarial pass surfaced one wording amendment (incorporated above in
[Section 2](#chrome-row-contract--primary-input-vs-secondary-chrome-cluster)
— "zero or more focal labeled controls" instead of "the focal labeled
control"); otherwise the design holds.

- **Load-bearing assumption** "Chip is interactive-only" tested and
  ruled false. `chips.md:41` explicitly documents `<Chip>label</Chip>`
  as a static read-only use case. The lock-at-xs decision applies to
  both interactive and static Chip uses. Confirmed in
  [Section 1](#chips-tier-rule)'s doc-home note.
- **Edge case** Chip at compact density on mobile (32 px) sits below
  HIG 44 pt. Not new — the existing density doc already accepts the
  trade-off for compact density. Not a blocker.
- **Edge case** Chip with future leading-icon slot — current API has
  no such slot; if added, vertical breathing room gets tight at
  compact density. Surface if Chip's API ever grows a `leading` slot.
- **Read-site impact** Four real Chip consumers verified: Toolbar,
  StoryCard, CalendarPicker, CollisionResolveDialog. All four
  currently render at the padding-driven natural ~34 px; lock-at-xs
  moves them to 36 px regular (+2 px). Visual delta minimal;
  functional impact zero.
- **Doc-integration cascades** All anchor placements verified — every
  new section inserts between existing siblings without breaking
  inbound refs. Drift-pass subagent (run between
  [staging and commit](#integration)) double-checks against the
  staged diff.
- **Verified vs assumed** Tailwind-merge config correctness, Chip's
  four consumers, the single `h-9` escape hatch in toolbar.tsx, and
  the static-Chip use case were all verified by reading code or
  canonical docs. Chip's "~34 px natural" was assumed (not measured);
  the assumption is non-load-bearing — the lock-at-xs decision is the
  right shape regardless of the exact natural value.

## Integration

### Canonical doc changes

- [`docs/ui/patterns/chips.md`](../ui/patterns/chips.md): add `## Height`
  section between `## Chip — square, toggleable` and
  `## Tag — pill, labeled content`. Codifies the tier choice,
  taxonomy distinction (Chip vs Button vs Tag), and the
  applies-to-interactive-and-static clarification.
- [`docs/ui/patterns/toolbar.md`](../ui/patterns/toolbar.md): add
  `## Height contract — primary input vs secondary chrome cluster`
  between `## Compound API` and `## Cross-tier overflow rule`.
- [`docs/ui/patterns/forms.md`](../ui/patterns/forms.md): add
  `### Trigger sizes` under `## Select primitive`, after
  `### Chrome carve-out`.
- [`docs/ui/foundations/spacing.md`](../ui/foundations/spacing.md):
  add `### Primitive height inventory` after the
  density-aware-tokens tables and before `### Tap-target on native`.
  Plus the one-line cross-link to `lib/utils.ts` near the same
  tables.
- [`docs/ui/components.md`](../ui/components.md): add a one-line
  cross-link in `### Density coverage` pointing at the spacing.md
  inventory and naming the update obligation.
- [`docs/followups.md`](../followups.md): **remove** the
  "Density-aware input component height sweep" entry. Resolution
  narrative in the commit message.

### Code follow-ons (separate commit, after canonical docs settle)

These are not part of this design's commit. Listed for tracking so
they don't drift loose:

- [`components/ui/chip.tsx`](../../components/ui/chip.tsx): replace
  `py-row-y-xs` with `h-control-xs` in the chip class composition.
- [`components/ui/select.tsx`](../../components/ui/select.tsx): add
  `xs` to internal `TriggerSize`; rename internal `'default'` →
  `'md'`; expose `size?: 'xs' | 'sm' | 'md'` on the public `<Select>`
  dispatcher.
- [`components/compounds/toolbar.tsx`](../../components/compounds/toolbar.tsx):
  migrate `Toolbar.Sort` from `cn('h-9', className)` to
  `<Select size="xs">`; delete the stale multi-line comment block
  above that call.
- Storybook coverage for `<Select size="xs">` — tracked under the
  existing
  [Storybook design-rules pattern setup](../followups.md#storybook-design-rules-pattern-setup)
  followup.

### Wireframes

No wireframe touches needed. Pattern docs in this project don't carry
HTML wireframes (those are screen-scoped). The chrome-row contract
is purely textual; the only existing visual mock that touches it is
inside `patterns/toolbar.md`'s ASCII layout snippets, which already
render the two-height pattern implicitly and need no update.

### Followups closed

- "Density-aware input component height sweep" resolves in full
  (entry removed from `docs/followups.md` in the same commit). All
  six audit questions named in the original entry get answered:
  Chip's tier choice (locked at xs), chrome-row
  shared-height question (per-cluster, not per-row), token-winner
  question (xs for secondary cluster, md for primary input),
  outliers-rework question (Chip; Switch and Checkbox stay inline by
  design), new-tier question (no — `h-control-xs` already existed),
  tailwind-merge config (already correct, comment was stale).

### Followups generated

None for `docs/followups.md`. The code follow-ons listed above are
implementation work, not deferred-design items.
