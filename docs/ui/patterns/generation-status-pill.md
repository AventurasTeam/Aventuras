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

Used by: every in-story surface — reader-composer, world, plot,
chapter-timeline, story-settings — as universal chrome per
[`principles.md → Universal in-story chrome`](../principles.md#universal-in-story-chrome).
App-level surfaces (story-list, app-settings, vault, diagnostics)
do not render this pill since they sit outside the per-story
pipeline context.

## Why a compound, not screen-side composition

The pill renders on every in-story top bar (Reader, World, Plot,
Story Settings, Chapter Timeline). Three concerns travel together
and must stay in lockstep across consumers:

- **Priority machine** — `blocking phase > error > background phase >
hidden` (see [Priority resolution](#priority-resolution)). The
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
type GenerationPhase =
  | 'reasoning'
  | 'recalling-memory'
  | 'generating-narrative'
  | 'classifying'
  | 'updating-memory'
  | 'closing-chapter'
  | 'refreshing-suggestions'

// `memory-incomplete` names the observable state, not a cause: the pill fires
// off a non-zero stale-row count, which an available embedder can produce too.
// `swap-paused` is separate because staging CLEARS embedding_stale as it goes,
// so a half-finished swap drives the count toward zero — the story most in need
// of a signal is the one least likely to raise one.
type ErrorState =
  | { code: 'memory-incomplete'; pendingRows: number }
  | { code: 'swap-paused' }
  | { code: 'classifier-offline' }

type GenerationStatusPillProps = {
  activePhase?: GenerationPhase
  error?: ErrorState
  // Optional: ignored for phases `cancelCopy` marks cancel-less, so a caller
  // that cannot tell which phase is up may pass it unconditionally.
  onCancel?: () => void
  onErrorTap: (code: ErrorState['code']) => void
}
```

Both `activePhase` and `error` are caller-derived. The consumer
collapses simultaneous errors to one — `swap-paused` outranks
`memory-incomplete`, because a paused swap drives the stale count
toward zero and would otherwise be hidden by the very signal it
suppresses — and hands the result in. The compound imports no router;
tap-handling is a consumer concern, surfaced via `onErrorTap`.

## Priority resolution

```
if (activePhase is blocking)          → render active variant
else if (error != null)               → render error variant
else if (activePhase != null)         → render active variant  (background phase)
else                                  → return null            (idle-hide)
```

A **blocking** phase is one the user is waiting on, and it also owns the
cancel affordance — replacing it with a warning would take away the only
way to stop a running generation, so it keeps the slot unconditionally.
A **non-blocking** phase (see [below](#non-blocking-phases)) yields to
any error: nothing is lost by waiting for background work, and the error
may be the thing waiting on the user. `swap-paused` is the case that
forces this — its remedy is a decision, not waiting, so a periodic
classifier pass blanking it on a cadence is the failure mode this rule
exists to prevent.

Deliberately a blocking/non-blocking split rather than a rank on
`ErrorState`. The two resolve identically in every combination except
one — a self-clearing error (`memory-incomplete`)
during a background phase — and that cell is arguably miscast anyway:
"N rows pending" is a drain reporting progress, not a fault. Revisit as
an error-severity axis only if that cell reads wrong in practice.

Returning `null` when both inputs are absent matches
[`principles.md → Universal in-story chrome`](../principles.md#universal-in-story-chrome)'s
"hides when idle." Parent chrome reserves no space; adjacent chrome
shifts into the gap on transitions.

## Copy mapping

The compound owns phase → copy and error → copy:

| Phase                    | Label                     |
| ------------------------ | ------------------------- |
| `reasoning`              | `reasoning…`              |
| `recalling-memory`       | `recalling memory…`       |
| `generating-narrative`   | `generating narrative…`   |
| `classifying`            | `classifying…`            |
| `updating-memory`        | `updating memory…`        |
| `closing-chapter`        | `closing chapter…`        |
| `refreshing-suggestions` | `refreshing suggestions…` |

| Error code           | Label                                              |
| -------------------- | -------------------------------------------------- |
| `memory-incomplete`  | `Memory incomplete — {{count}} row(s) pending`     |
| `swap-paused`        | `Embedder switch paused — waiting on you`          |
| `classifier-offline` | `Classifier offline — retrieval coverage thinning` |

`memory-incomplete` is pluralised (`_one` / `_other`), so the count is
`{{count}}` rather than a named field.

Periodic-classifier
[config pre-flight failures](../../generation-pipeline.md#config-pre-flight-validation)
— a broken provider or profile reference caught at the scheduled fire
time — currently surface through `classifier-offline` alongside
transient runtime failures: different cause, same consequence framing.
Splitting them into their own codes is unbuilt.

## Active variant

```tsx
<Tag tone="accent" leading={<Spinner size="sm" />} onPress={openPopover}>
  {phaseCopy[activePhase]}
</Tag>
```

Tap opens a `Popover` anchored to the tag. Body is a single button:

- `Cancel generation` — for `reasoning` / `recalling-memory` /
  `generating-narrative` / `classifying`.
- `Cancel chapter close` — for `closing-chapter`.
- `Cancel suggestion refresh` — for `refreshing-suggestions`.
- None — for `updating-memory`. The phase is cancel-less, so the tag
  carries no popover trigger and a passed `onCancel` is ignored.

Clicking the button fires `onCancel()` and closes the popover.
Esc / outside-tap closes the popover without firing `onCancel`.

### Non-blocking phases

`updating-memory` — the periodic classifier's background pass — is the
only phase that doesn't hold the turn up. It drops the accent fill for
`tone="default"` (the header's own `bg-base` plus a border) and a
`--fg-muted` spinner, and it yields the slot to any error per
[Priority resolution](#priority-resolution). Copy alone can't carry the
distinction, because the phone variant is icon-only.

It is deliberately a separate phase from `classifying`, which is the
per-turn piggyback fallback: same work, opposite answer to "can I keep
writing?".

Blocking is tracked per phase rather than inferred from a phase having
no cancel label. The two coincide today only because the one background
phase is also the one nothing can cancel; a blocking phase that is
uncancellable for its own reasons (a committing transaction, say) would
otherwise inherit the wrong priority.

Pill dimensions stay stable — the popover is an overlay, never an
inline expansion. The active label renders regardless of popover
open state.

## Error variant

```tsx
<Tag tone="warning" onPress={() => onErrorTap(error.code)}>
  {errorCopy[error.code]}
</Tag>
```

No popover. Tap fires `onErrorTap(error.code)` directly and the
consumer decides what a code is worth routing to. Per
[`reader-composer.md → Persistent state — top-bar status pill error variant`](../screens/reader-composer/reader-composer.md#persistent-state--top-bar-status-pill-error-variant):

| Error code           | Consumer response                                 |
| -------------------- | ------------------------------------------------- |
| `memory-incomplete`  | Route to Story Settings · Memory.                 |
| `swap-paused`        | Route to Story Settings · Memory.                 |
| `classifier-offline` | No route — the pass retries on its own next fire. |

`classifier-offline` is deliberately inert: it reports a background
pass that will retry unprompted, so routing the user somewhere to act
on it would imply an action that is not theirs to take.

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

None. The active variant's Popover is uncontrolled — the compound
holds a `triggerRef` and calls `triggerRef.current?.close()` after a
cancel rather than mirroring open/closed into React state. The error
variant has no popover at all, and `activePhase` / `error` come from
props on every render.

## Open items

- **Pipeline orchestrator wiring.** Real `activePhase` source from
  the per-turn / chapter-close pipelines per
  [`generation-pipeline.md → Orchestrator topology`](../../generation-pipeline.md#orchestrator-topology).
  The compound takes `activePhase` as a prop; consumers wire it from
  the orchestrator state via a derived selector on `txState`
  (foreground-first heuristic). **Done for the reader**, whose
  `components/reader/generation-phase.ts` maps the running phase's
  node name to a `GenerationPhase` — exhaustively over the per-turn
  phase-name union, so a phase added to that pipeline fails the
  build until it is labelled, and with a generic-label fallback so an
  unmapped name never blanks the pill mid-run. Story Settings still
  derives its phase from the run's _kind_, and the remaining in-story
  surfaces are unwired.
- **Memory error observation.** Surface `memory-incomplete` from
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
