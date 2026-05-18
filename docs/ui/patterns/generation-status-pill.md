# GenerationStatusPill

Universal in-story top-bar pill (per
[`principles.md → Universal in-story chrome`](../principles.md#universal-in-story-chrome))
that surfaces two distinct states from one slot: **active pipeline
phase** (with click-to-cancel popover) and **sticky memory error**
(tap-to-route). Hides when idle.

The compound consumes the [`Tag`](./chips.md#tag--pill-labeled-content)
primitive directly — no new visual surface; only behavior, priority,
copy mapping, and tier-aware reshape live here. The error variant is
deliberately the same chrome as the active variant with a warning
tone instead of accent + animation.

## Why a compound, not screen-side composition

The pill renders on every in-story top bar (Reader, World, Plot,
Story Settings, Chapter Timeline). Three concerns travel together
and must stay in lockstep across consumers:

- **Priority machine** — `active phase > error > hidden`. The
  consumer derives both inputs from different sources (pipeline
  orchestrator + memory health observations); the compound owns the
  resolution.
- **Copy mapping** — phase / error enums → user-visible label
  strings. Centralizing here means principle-published copy lives in
  one place; consumers don't reinvent labels and drift apart.
- **Tier-aware reshape** — phone collapses the active variant to
  icon-only per
  [`mobile/touch.md → Status pill on phone`](../foundations/mobile/touch.md#status-pill-on-phone)
  while keeping the error variant's text (the error copy is the
  action prompt itself).

## Compound API

```ts
type GenerationPhase = 'reasoning' | 'generating-narrative' | 'classifying' | 'closing-chapter'

type ErrorState =
  | { code: 'embedder-offline'; pendingRows: number }
  | { code: 'classifier-offline' }
  | { code: 'classifier-no-profile' }
  | { code: 'classifier-profile-provider-missing' }
  | { code: 'classifier-default-provider-missing' }

type GenerationStatusPillProps = {
  activePhase?: GenerationPhase
  error?: ErrorState
  onCancel: () => void
  onErrorTap: (code: ErrorState['code']) => void
}
```

Both `activePhase` and `error` are caller-derived. The consumer
collapses simultaneous errors to one (embedder > classifier — bigger
blocker first) and hands the result in. The compound imports no
router; routing is a consumer concern, surfaced via `onErrorTap`.

## Priority resolution

```
if (activePhase != null)  → render active variant
else if (error != null)   → render error variant
else                      → return null   (idle-hide)
```

Returning `null` when both inputs are absent matches
[`principles.md → Universal in-story chrome`](../principles.md#universal-in-story-chrome)'s
"hides when idle." Parent chrome reserves no space; adjacent chrome
shifts into the gap on transitions.

## Copy mapping

The compound owns phase → copy and error → copy:

| Phase                  | Label                   |
| ---------------------- | ----------------------- |
| `reasoning`            | `reasoning…`            |
| `generating-narrative` | `generating narrative…` |
| `classifying`          | `classifying…`          |
| `closing-chapter`      | `closing chapter…`      |

| Error code                            | Label                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `embedder-offline`                    | `Embedder offline — {pendingRows} rows pending`                                |
| `classifier-offline`                  | `Classifier offline — retrieval coverage thinning`                             |
| `classifier-no-profile`               | `Classifier has no profile — retrieval coverage thinning`                      |
| `classifier-profile-provider-missing` | `Classifier profile's provider is missing — retrieval coverage thinning`       |
| `classifier-default-provider-missing` | `Classifier default model's provider is missing — retrieval coverage thinning` |

The three `classifier-*-missing` / `classifier-no-profile` variants
come from periodic-classifier
[config pre-flight failures](../../generation-pipeline.md#config-pre-flight-validation)
— a broken provider/profile reference that the periodic classifier
pre-flight catches at its scheduled fire time. Distinct from
`classifier-offline` (transient runtime failure) — different cause,
same consequence framing.

## Active variant

```tsx
<Tag tone="accent" leading={<Spinner size="sm" />} onPress={openPopover}>
  {phaseCopy[activePhase]}
</Tag>
```

Tap opens a `Popover` anchored to the tag. Body is a single button:

- `Cancel generation` — for `reasoning` / `generating-narrative` /
  `classifying`.
- `Cancel chapter close` — for `closing-chapter`.

Clicking the button fires `onCancel()` and closes the popover.
Esc / outside-tap closes the popover without firing `onCancel`.

Pill dimensions stay stable — the popover is an overlay, never an
inline expansion. The active label renders regardless of popover
open state.

## Error variant

```tsx
<Tag tone="warning" onPress={() => onErrorTap(error.code)}>
  {errorCopy[error.code]}
</Tag>
```

No popover. Tap fires `onErrorTap(error.code)` directly; the
consumer routes per
[`reader-composer.md → Persistent state — top-bar status pill error variant`](../screens/reader-composer/reader-composer.md#persistent-state--top-bar-status-pill-error-variant):

- `embedder-offline` → Story Settings · Memory's resolution panel.
- `classifier-offline` → Story Settings · Memory · Classifier panel.
- `classifier-no-profile` → App Settings · Profiles · Assignments
  (classifier row).
- `classifier-profile-provider-missing` → App Settings · Profiles
  (the broken profile's edit dialog).
- `classifier-default-provider-missing` → App Settings · Default
  models (classifier row).

## Tier-aware render

Uses `useTier()` from `hooks/use-tier.ts`.

- **Desktop / tablet** — full text label + leading spinner on
  active; full text label on error.
- **Phone — active variant** — leading spinner only, no children
  label. Tap opens the same Popover content. Pill width is
  icon-sized; phone chrome can't fit the text label.
- **Phone — error variant** — keeps its text. Error copy is the
  action prompt itself; collapsing it to an icon loses meaning.
  Acceptable width because the error pill is sticky and phone
  chrome accommodates short error sentences.

Same Popover primitive on every tier — `touch.md` mandates "Popover,
not Sheet" because the content is tiny (single Cancel button) and
fits the ≤ 200 px tiny-popover threshold.

## Local state

```ts
const [popoverOpen, setPopoverOpen] = React.useState(false)
```

Only the active variant uses this. Error variant has no popover.
The compound has no other internal state — `activePhase` / `error`
come from props on every render.

## Open items

- **Pipeline orchestrator wiring.** Real `activePhase` source from
  the per-turn + chapter-close pipelines per
  [`generation-pipeline.md → Orchestrator topology`](../../generation-pipeline.md#orchestrator-topology).
  The compound takes `activePhase` as a prop; consumers wire it from
  the orchestrator state via a derived selector on `txState`
  (foreground-first heuristic).
- **Memory error observation.** Surface `embedder-offline` from
  staleness detection per
  [`memory/model-management.md → Staleness UI`](../../memory/model-management.md#staleness-ui);
  `classifier-offline` from failed-persistent classifier state per
  [`memory/classifier.md → Pill priority`](../../memory/classifier.md#background-task-framing).
  Consumer collapses simultaneous errors to one (embedder >
  classifier).
- **Top-bar consumer wiring.** Render the pill on Reader, World,
  Plot, Story Settings, Chapter Timeline per
  [`principles.md → Universal in-story chrome`](../principles.md#universal-in-story-chrome).
- **World top-bar `⚠ N need review` pill.** Deferred from
  collision-resolve work; now unblocked since `Tag tone="warning"`
  is available (see
  [`chips.md → Tag tone vocabulary`](./chips.md#tag--tone-vocabulary)).
  Sits beside (not inside) the generation pill — its own slot on
  the top bar.
