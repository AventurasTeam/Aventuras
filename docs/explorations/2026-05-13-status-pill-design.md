# 2026-05-13 — StatusPill design: extend Tag + ship GenerationStatusPill

Implementation design for the needs-design compound at
[`component-inventory.md → Compounds — needs design`](../ui/component-inventory.md#compounds--needs-design).
The feature spec is fragmented across
[`principles.md → Universal in-story chrome`](../ui/principles.md#universal-in-story-chrome),
[`principles.md → Affordance loci`](../ui/principles.md#affordance-loci),
[`reader-composer.md → Persistent state — top-bar status pill error variant`](../ui/screens/reader-composer/reader-composer.md#persistent-state--top-bar-status-pill-error-variant),
[`mobile/touch.md → Status pill on phone`](../ui/foundations/mobile/touch.md#status-pill-on-phone),
and the row-status usage in
[`entity.md`](../ui/patterns/entity.md) +
[`plot.md`](../ui/screens/plot/plot.md). This doc settles the
**implementation** (extend an existing primitive, factor the
compound, fix the API contract).

## Outcome

Two shipped pieces:

1. **Extend the existing `Tag` primitive** with four new tones
   (`success`, `warning`, `danger`, `accent`) and an optional
   `leading` slot for indicators. Existing `default` / `soft`
   callsites stay untouched.
2. **Ship `GenerationStatusPill` as a compound** that consumes
   `Tag`, owns the principles-published priority machine
   (`active generation > error state > hidden`), maps phase /
   error enums to copy, renders tier-aware (icon-only on phone),
   and owns the click-to-cancel `Popover` for the active variant.

Row-status callsites (entity rows, plot threads) use `Tag`
directly with the new tones — no thin wrappers. The principles
doc's call-out that the error variant is "not new vocabulary —
reuses the existing gen-pill chrome with error-tinted styling
instead of the active animation" maps cleanly onto a single
compound with two render branches sharing the same `Tag` shell.

## Why extend `Tag` instead of a new primitive

`components/ui/tag.tsx` already provides:

- Rounded-full pill shape (`rounded-full border` with row padding)
- Optional `onPress` → makes the whole tag a `Pressable` with
  `cursor-pointer` / `hover:bg-tint-hover` / focus-visible ring
- `TextClassContext` cascade so children render in the right
  text color
- Tone slot (`default` / `soft`) and `disabled` opacity

What's missing for status-pill duty:

- Tone palette is narrow (`default` + `soft`); status pills need
  semantic tones (success / warning / danger / accent).
- No slot for a leading indicator — the active gen variant needs
  a `<Spinner>` (or future animated icon) before the label.

Adding tones + a leading slot extends a primitive that already
matches the visual contract instead of duplicating it. The
existing `Tag` consumers (`TagInput`, inline entity refs, the
collision dialog's tag-deselect grid) use `default` or `soft`
and are unaffected by additive changes.

## File layout

```
components/ui/
  tag.tsx                         MODIFY — add tones + leading slot
  tag.stories.tsx                 MODIFY — extend the matrix

components/compounds/
  generation-status-pill.tsx              NEW — view + tier dispatch + popover
  generation-status-pill.stories.tsx      NEW

docs/ui/component-inventory.md    MODIFY — shipped row + remove needs-design
docs/followups.md                 MODIFY — add GenerationStatusPill section
```

No new pure module / reducer file. The compound's "state" is
two props the consumer derives elsewhere; the compound itself is
pure render plus a single local `useState` for popover open.

## `Tag` primitive extension

### Tone vocabulary

| Tone                   | Visual intent                | Row + chrome uses                                      |
| ---------------------- | ---------------------------- | ------------------------------------------------------ |
| `default` _(existing)_ | outline + muted text         | active entity row, Active thread, neutral              |
| `soft` _(existing)_    | `bg-region` tint             | inline entity refs, tag chips                          |
| `success` _(new)_      | green-tinted (success token) | staged entity, Resolved thread                         |
| `warning` _(new)_      | amber-tinted (warning token) | retired entity, Pending thread, **error-pill variant** |
| `danger` _(new)_       | red-tinted (danger token)    | Failed thread                                          |
| `accent` _(new)_       | accent-tinted                | gen pill **active phase** (with leading animation)     |

Concrete colors source from existing project theme tokens:

- `success` → `bg-success` translucent + `text-success` border (whatever the project's success token pair is — see existing usage in `delta-log-row.tsx` or `entry-card.tsx` if a precedent exists; if not, mirror the warn-tint overlay pattern used in `CollisionListRow` with the success token).
- `warning` → reuse the `bg-warning opacity-[.12]` overlay pattern from `components/compounds/save-bar.tsx:116` + `border-warning` + `text-warning`. This is the project's established warn-tint shape.
- `danger` → `bg-danger` translucent + `text-danger-fg` per `delta-log-row.tsx:55`'s `delete` styling.
- `accent` → `bg-accent` translucent + `text-accent-fg`. The active animation lives in the `leading` slot, not on the body.

Each new tone follows the same template: translucent tint
background, colored text via `TextClassContext`, matching
border. No tone changes the pill's geometry — same
`rounded-full border` body, same `px-row-x-xs py-row-y-xs`
padding.

### Leading slot

```ts
type TagProps = {
  // …existing
  /**
   * Optional element rendered before the label, separated by the
   * existing `gap-1`. Used by GenerationStatusPill to inject a
   * Spinner during active phases; available to any future
   * consumer that needs a small leading indicator.
   */
  leading?: React.ReactNode
}
```

Renders inside the tag body, before `children`, via the existing
flex-row + `gap-1`. Stays inside the `TextClassContext` so child
text colors continue to cascade. The slot is optional — existing
callers don't pass it; behavior is unchanged.

`removable` (with `×`) and `dashed` props stay as-is.
StatusPill use cases don't need them; tag-input use cases
do; no conflict.

## `GenerationStatusPill` compound

### Props

```ts
type GenerationPhase = 'reasoning' | 'generating-narrative' | 'classifying' | 'closing-chapter'

type ErrorState = { code: 'embedder-offline'; pendingRows: number } | { code: 'classifier-offline' }

type GenerationStatusPillProps = {
  activePhase?: GenerationPhase
  error?: ErrorState
  onCancel: () => void
  onErrorTap: (code: ErrorState['code']) => void
}
```

Both `activePhase` and `error` are caller-derived. `activePhase`
comes from the pipeline orchestrator; `error` comes from memory
health observations. The consumer collapses simultaneous errors
to one (likely embedder > classifier — bigger blocker first) and
hands the result in.

### Priority resolution

```
if (activePhase != null)      → render active variant
else if (error != null)       → render error variant
else                          → return null   (idle-hide)
```

Returning `null` when both inputs are absent matches the
principles spec: _"hides when idle, shows during active pipeline
phases"_. Parent chrome reserves no space; adjacent chrome shifts
into the gap on transitions.

### Copy mapping

The compound owns phase → copy and error → copy. Centralizing the
strings here means principle-published copy lives in one place
and consumers don't reinvent the labels.

| Phase                  | Desktop / tablet copy   |
| ---------------------- | ----------------------- |
| `reasoning`            | `reasoning…`            |
| `generating-narrative` | `generating narrative…` |
| `classifying`          | `classifying…`          |
| `closing-chapter`      | `closing chapter…`      |

| Error code           | Copy                                               |
| -------------------- | -------------------------------------------------- |
| `embedder-offline`   | `Embedder offline — {pendingRows} rows pending`    |
| `classifier-offline` | `Classifier offline — retrieval coverage thinning` |

### Active variant render

```tsx
<Tag tone="accent" leading={<Spinner size="sm" />} onPress={openPopover}>
  {phaseCopy[activePhase]}
</Tag>
```

Clicking the pill opens a `Popover` anchored to the tag. The
popover body is a single button:

- `Cancel generation` for `reasoning` / `generating-narrative` /
  `classifying`
- `Cancel chapter close` for `closing-chapter`

Clicking the button fires `onCancel()` and closes the popover.
Esc / outside-tap also closes the popover without firing
`onCancel`.

Pill dimensions stay stable per the principles call-out — the
popover is an overlay, never an inline expansion. Active label
renders regardless of popover open state.

### Error variant render

```tsx
<Tag tone="warning" onPress={() => onErrorTap(error.code)}>
  {errorCopy[error.code]}
</Tag>
```

No popover. Tap fires `onErrorTap(error.code)` directly; the
consumer routes (per
[`reader-composer.md` → `embedder-offline` routes to Story
Settings · Memory's resolution panel, `classifier-offline` routes
to Story Settings · Memory · Classifier panel](../ui/screens/reader-composer/reader-composer.md#persistent-state--top-bar-status-pill-error-variant)).

The compound does **not** import any router. Routing is a
consumer concern; the compound's only public contract for error
state is the tap callback with the error code.

### Tier-aware render

Uses `useTier()` from `hooks/use-tier.ts` (existing project
hook).

- **Desktop / tablet** — full text label + leading spinner.
- **Phone — active variant** — leading spinner only, no
  children label. Tap opens the same `Popover` content (single
  Cancel button). Pill width is icon-sized; phone chrome can't
  fit the text label (per
  [`mobile/touch.md → Status pill on phone`](../ui/foundations/mobile/touch.md#status-pill-on-phone)).
- **Phone — error variant** — keeps its text. Error copy is the
  action prompt itself; collapsing it to an icon loses the
  meaning. Acceptable width because the error pill is sticky and
  the phone chrome accommodates short error sentences.

Popover primitive (`@/components/ui/popover`) is the same on
both tiers — `touch.md` mandates "Popover, not Sheet" and "Same
primitive on every tier" because the popover content is tiny
(single Cancel button) and fits the ≤ 200 px tiny-popover
threshold.

### Local state

```ts
const [popoverOpen, setPopoverOpen] = React.useState(false)
```

Only the active variant uses this. Error variant has no popover.
The compound has no other internal state — `activePhase` /
`error` come from props on every render.

## Storybook coverage

### `tag.stories.tsx` additions

Existing tag stories stay untouched. Add:

| Story                | Demonstrates                                       |
| -------------------- | -------------------------------------------------- |
| `ToneSuccess`        | `tone="success"` with `staged` label               |
| `ToneWarning`        | `tone="warning"` with `retired` label              |
| `ToneDanger`         | `tone="danger"` with `Failed` label                |
| `ToneAccent`         | `tone="accent"` with `reasoning…` label            |
| `WithLeading`        | `tone="accent"`, `leading={<Spinner size="sm" />}` |
| `TonesInThemeMatrix` | Each new tone × all four themes                    |

### `generation-status-pill.stories.tsx`

`title: 'Compounds/GenerationStatusPill'`. No autodocs tag —
controlled-state pattern doesn't render meaningfully on the docs
page (same constraint as embedder-download + collision-resolve).

| Story                       | Demonstrates                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `Hidden`                    | both props undefined → returns null; story renders a placeholder caption explaining the absence |
| `ActiveReasoning`           | `activePhase="reasoning"`                                                                       |
| `ActiveGeneratingNarrative` | `activePhase="generating-narrative"`                                                            |
| `ActiveClassifying`         | `activePhase="classifying"`                                                                     |
| `ActiveClosingChapter`      | `activePhase="closing-chapter"` — popover button copy becomes `Cancel chapter close`            |
| `ErrorEmbedder`             | `error={{ code: 'embedder-offline', pendingRows: 142 }}`                                        |
| `ErrorClassifier`           | `error={{ code: 'classifier-offline' }}`                                                        |
| `ActivePlusError`           | both set — verifies active wins                                                                 |
| `PhonePopover`              | fixed-width 360 px wrapper coerces phone-tier; icon-only render                                 |
| `ThemeMatrix`               | All four themes × one active variant                                                            |

Stub handlers: `onCancel = () => console.log('cancel')`,
`onErrorTap = (code) => console.log('route', code)`. No
Promise / async pattern — these are fire-and-forget. The real
consumer wires routes / cancel action.

## Test surface

No vitest module. The compound is pure render with two derived
booleans (active / error) plus a `useState` for popover open;
the behavior is exercised through Storybook stories. Same
pattern as `CollisionListRow` (pure-presentation compound, no
test file).

If popover dismissal / focus-trap / gesture handling later grows
complexity, a colocated `.test.tsx` lands at that point. Not now.

## Out of scope

- **Real pipeline event subscription.** The compound takes
  `activePhase` as a prop; the consumer derives it from the
  orchestrator state. Wiring is followup work, not part of this
  ship.
- **Real memory observability for `error`.** The consumer
  derives `error` from memory health observations (embedder
  staleness, classifier failure state). Followup.
- **Story Settings · Memory routing target.** Compound calls
  `onErrorTap(code)`; the consumer translates that to a router
  navigation. Followup at the consumer.
- **Animation polish on the active-phase spinner.** Uses the
  existing `Spinner` primitive at `size="sm"` (the smallest the
  primitive ships with; xs would need a Spinner change first).
  Visual-identity work (pulse cadence, custom indicator shape) is
  later.
- **Banner affordance for chapter-close pipeline.** Per
  [`principles.md → Affordance loci`](../ui/principles.md#affordance-loci)
  a sticky banner appears below the top bar during chapter-close.
  That's a separate compound, not the pill.
- **Top-bar chrome integration.** Wiring the pill into the
  Reader / World / Plot / Story Settings / Chapter Timeline
  top-bar layouts is consumer work that depends on those shells
  existing first.

## Followups

Adds `### GenerationStatusPill` section to
[`docs/followups.md`](../followups.md):

- **Pipeline orchestrator wiring** — real `activePhase` source
  from the per-turn + chapter-close pipelines per
  [`architecture.md`](../architecture.md).
- **Memory error observation** — surface `embedder-offline`
  from staleness detection per
  [`memory/model-management.md → Staleness UI`](../memory/model-management.md#staleness-ui),
  `classifier-offline` from failed-persistent classifier state
  per
  [`memory/classifier.md → Pill priority`](../memory/classifier.md#pipeline-framing).
- **Top-bar consumer wiring** — render the pill on Reader,
  World, Plot, Story Settings, Chapter Timeline per
  [`principles.md → Universal in-story chrome`](../ui/principles.md#universal-in-story-chrome).
- **World top-bar `⚠ N need review` pill** — deferred from the
  collision-resolve work; now unblocked since `Tag tone="warning"`
  is available. Sits beside (not inside) the generation pill —
  separate slot on the top bar.

## Inventory delta

Lands in same commit as the shipped code per the
`feedback_inventory_double_entry` memory rule (recurring
oversight that has needed three chore-commit followups):

1. **Compounds — shipped** — add `GenerationStatusPill` row
   (alpha position between `FormRow` and `ImporterMenu`).
2. **Compounds — needs design** — remove the `StatusPill` row.
   The needs-design section retains `Importer` only (still
   deferred per its own note).

The `Tag` primitive's existing inventory row in
`Primitives — shipped` stays as-is (no row rewording — the
description doesn't enumerate tones).
