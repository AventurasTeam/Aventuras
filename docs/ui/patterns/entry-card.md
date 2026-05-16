# EntryCard pattern

The reader-composer narrative-row compound. Renders all five
entry kinds (`user`, `ai`, `opening`, `system`, `streaming`) as
full-width bubbles with kind-keyed styling, conditional reasoning
body, in-place edit, and a muted world-time footer.

Sister patterns:

- [`icon-actions.md`](./icon-actions.md) — the per-entry action
  cluster (top-right, opacity 0.55 → 1.0 on hover) follows this
  pattern.
- [`save-sessions.md`](./save-sessions.md) — host-level save bar
  for the in-place edit flow; EntryCard exposes
  `onCommitEdit / onCancelEdit` for the host to bind.
- [`forms.md → Textarea primitive`](./forms.md#textarea-primitive) —
  the in-place edit textarea.

Used by:

- [Reader composer](../screens/reader-composer/reader-composer.md#per-entry-actions) —
  the narrative loop. Sole consumer in v1.

## Compound API

```ts
type EntryCardProps = {
  kind: 'user' | 'ai' | 'opening' | 'system' | 'streaming'
  content: string
  worldTimeLabel?: string

  onEdit?: () => void
  onDelete?: () => void // not for opening (block-delete) or system/streaming

  // World-time editing — see "World-time footer" below
  worldTimeRaw?: number // raw cumulative seconds; seeds the TierTupleInput in the edit Popover
  onEditTime?: (nextWorldTime: number) => void // host writes the metadata.worldTime delta
  worldTimeMonotonicityBreak?: { previousLabel: string } // presence fires the warning indicator + Popover banner

  // AI / opening:
  meta?: { tokens: { reply: number; reasoning?: number } }
  reasoning?: string
  onRegen?: () => void // ai only
  onBranch?: () => void // ai, opening
  onFlipEra?: () => void // user, ai, opening — host hides when eras: null

  // Streaming-only:
  streamingPhase?: 'reasoning' | 'reply'

  // System-only:
  detail?: string
  onRetry?: () => void
  onDismiss?: () => void

  // Edit-restrictions (uniform with principles):
  disabled?: boolean
  disabledReason?: string

  // Edit mode (host-controlled):
  editing?: boolean
  onContentChange?: (next: string) => void
  onCommitEdit?: () => void
  onCancelEdit?: () => void

  className?: string
}
```

Two structural choices:

1. **Edit mode is controlled.** `editing` boolean plus
   controlled `content` value plus
   `onContentChange / onCommitEdit / onCancelEdit` callbacks.
   Host owns dirty-state machinery (delta-log writes); compound
   relays keystrokes and renders textarea-or-prose.
2. **`worldTimeLabel` is pre-formatted.** Calendar formatting
   lives in the host's render pass via the active calendar's
   renderer. EntryCard renders the string opaque — same
   contract the top-bar chip uses.

## Per-kind structure

| Slot                       | user                             | ai                                        | opening                                | system                                       | streaming                             |
| -------------------------- | -------------------------------- | ----------------------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Top line                   | `You` badge                      | meta line (glyph, brain, tokens)          | meta line                              | `System` with warn glyph                     | meta line (brain pulses, trailing → ) |
| Reasoning body             | —                                | conditional (`reasoning` set, expanded)   | conditional                            | —                                            | live-streaming on `streamingPhase`    |
| Content                    | prose (or textarea if `editing`) | prose                                     | prose                                  | error description with inline action buttons | partial prose tokens                  |
| Action cluster (top-right) | edit, `[flip era]`, delete       | edit, regen, branch, `[flip era]`, delete | edit, branch, `[flip era]` (no delete) | — (uses inline buttons)                      | —                                     |
| World-time footer          | shown                            | shown                                     | shown                                  | hidden                                       | hidden                                |
| Bubble styling             | `bg-bg-sunken border-border`     | `bg-bg-raised border-border`              | same as ai                             | `bg-bg-base border-warning`                  | ai styling plus `border-dashed`       |

`opening` renders identically to `ai` for visual treatment; the
discriminator only affects available actions. See
[data-model.md → Opening entry](../../data-model.md#opening-entry)
for the underlying invariant.

## Reasoning expansion

**Data source:** `props.reasoning`, sourced from
`story_entries.metadata.reasoning?: string` (see
[data-model.md → Entry metadata shape](../../data-model.md#entry-metadata-shape)).
Brain icon renders only when `reasoning` is present, or when
`streamingPhase === 'reasoning'`.

**State:** internal `expanded: boolean`, default `false`. Click
brain toggles. No external override prop.

**Animation (deferred to a polish pass):**

The v1 implementation toggles render via `display: none` — instant
show/hide. The animation specs below are the target for the polish
pass; the contract for parent virtualization (deterministic layout
transition, measurable) holds either way because instant is also
deterministic.

- Web: `transition: max-height 200ms ease-out` with
  measured-height clamp.
- Native: reanimated worklet on a shared `expanded` value with
  `withTiming(expanded ? measured : 0, { duration: 200 })`.
- Reasoning body uses `display: none` when collapsed so it
  doesn't take layout space and doesn't measure.

**Scroll-anchor concern (parent's responsibility, not
EntryCard's).** The reasoning body sits above content; expanding
above the viewport top would shift the user's view. EntryCard's
contract: emit a measurable, deterministic layout transition;
never pin its own height; let the parent's `measureElement`
(web) or `maintainVisibleContentPosition` (native) track the
shift. The
[reader narrative scroll-anchoring](../../followups.md#reader-narrative-scroll-anchoring-on-prepend)
followup covers the parent's mechanic.

## Edit mode

When `editing === true`:

- Content slot renders [`<Textarea>`](./forms.md#textarea-primitive)
  instead of prose `<Text>`.
- Textarea seeded with current `content`.
- `onContentChange(next)` fires on each keystroke.
- **Inline Save / Cancel buttons** render right-aligned below the
  textarea, wired to `onCommitEdit` / `onCancelEdit`. Esc-to-cancel
  also bound on the textarea.
- The full [`<SaveBar>` compound](./save-sessions.md) is NOT
  rendered inside EntryCard — that's the page-level sticky
  pattern, not a per-entry control. A host that needs cross-entry
  dirty-state tracking can mount its own SaveBar at detail-pane
  level in parallel.
- Brain, reasoning body, and action cluster are hidden during
  edit. The entry is in edit-mode focus.
- Reasoning text is NOT editable. Only `content`. Reasoning is
  generation provenance.

**Cross-tier:** identical on phone and desktop. Textarea spans
full content width. Mobile keyboard pushes the textarea up via
existing form-row patterns. No sheet, no modal — keeps the edit
in narrative flow.

**Mobile contract:** the host's `<ScrollView>` MUST set
`keyboardShouldPersistTaps="handled"`. Without it, the first tap
on Save / Cancel only dismisses the soft keyboard and the user
needs a second tap to fire the button — RN's default
`"never"` consumes the dismissal tap. The compound can't fix this
on its own; the behavior is owned by the parent ScrollView.

## World-time footer

- Muted small text, bottom-right of bubble (`text-fg-muted text-xs`).
- Renders `props.worldTimeLabel` opaque.
- Hidden for `kind` ∈ { `system`, `streaming` } — system is
  generation-meta, streaming has no committed worldTime yet.
- Hidden when `worldTimeLabel` undefined (host's choice — e.g.,
  formatter failure, calendar omits this entry, or the entry has no
  authored worldTime metadata).

**Click-to-edit (interactive when editable).** The footer becomes
interactive when the host supplies `onEditTime` + `worldTimeRaw` —
in practice on AI, opening, and user entries (classifier-authored,
wizard-authored, or inherited-at-write `worldTime`; see
[`data-model.md → In-world time tracking`](../../data-model.md#in-world-time-tracking)).
Hover-brighten + cursor pointer signal the affordance. Click opens an edit overlay anchored to the footer:
**Popover on desktop, Sheet on phone** (per
[`patterns/overlays.md`](./overlays.md) and the
[mobile decision tree](../foundations/mobile/layout.md)). Tablet
follows the standard breakpoint rule.

The overlay body hosts a `TierTupleInput` matching the active
calendar's tier shape (the same primitive the wizard's
`worldTimeOrigin` step uses), pre-populated from `worldTimeRaw +
worldTimeOrigin` walked through the calendar's tier stack. Save
computes the new cumulative seconds and invokes `onEditTime(next)`;
the host writes one `op=update` delta against
`entries.metadata.worldTime`. Cancel discards.

When `worldTimeMonotonicityBreak` is present, the overlay's body
prepends a warning banner ("⚠ Earlier than previous entry
(<previousLabel>)") above the input — this is the sole way the user
sees the violation detail on mobile (the inline indicator has no
own tap target there). Desktop hovering the indicator surfaces the
same string as a tooltip without opening the overlay.

**Monotonicity indicator.** When `worldTimeMonotonicityBreak` is
present, a small warning glyph (`text-warning` color) renders
inline preceding the footer label. The host computes the prop by
walking entries once per list render, comparing each entry's
`worldTime` against the most recent preceding entry with
`worldTime > 0` (flashbacks with `worldTime = 0` are skipped — they
use the existing non-main-timeline convention). The indicator
persists as state, not event — present whenever the violation
holds, cleared on next render when the user fixes it.

**Edit-restrictions interaction.** Footer click respects the
`disabled` prop (per
[`principles.md → Edit restrictions during in-flight generation`](../principles.md#edit-restrictions-during-in-flight-generation))
— same gating as content edit, regen, and delete. No new mechanism.

Full design rationale and the downstream-consumer tolerance
contract: [`explorations/2026-05-17-manual-worldtime-correction.md`](../../explorations/2026-05-17-manual-worldtime-correction.md).

## Action cluster

Per-kind action sets:

| Kind      | edit                                                  | regen | branch | flip-era    | delete            |
| --------- | ----------------------------------------------------- | ----- | ------ | ----------- | ----------------- |
| user      | yes                                                   | —     | —      | conditional | yes               |
| ai        | yes                                                   | yes   | yes    | conditional | yes               |
| opening   | yes                                                   | —     | yes    | conditional | no (block-delete) |
| system    | (inline buttons inside content; no top-right cluster) |
| streaming | (no actions; cancel via composer)                     |

`flip-era` is conditional: host passes `onFlipEra` only when
active calendar has eras. Same gating as the
[per-screen doc](../screens/reader-composer/reader-composer.md#per-entry-actions).

Position: absolute top-right of bubble; opacity 0.55 default,
1.0 on hover or focus per the
[icon-actions pattern](./icon-actions.md). Cluster gap and
density-aware sizing inherit from icon-actions.

## Variable-height plus virtualization compatibility

EntryCard's contract for parent virtualized lists:

- **No fixed height.** Bubble height is content-driven.
- **No key shenanigans.** Same key across re-renders (host
  passes `entry.id`).
- **Deterministic layout transitions.** Reasoning expand/collapse
  uses height-auto with predictable timing; parent's
  `measureElement` (web) or `FlatList`'s native layout (mobile)
  reacts naturally.
- **No layout effects fighting the parent.** EntryCard doesn't
  measure itself or apply scroll fixes.

The reader narrative scroll-anchoring concern is the parent
list's responsibility, not EntryCard's. EntryCard ships
compatible.

## Storybook (EntryCard)

Live demos for: user kind, ai kind (with reasoning expanded /
collapsed), opening kind (no delete action), system kind (with
detail expanded), streaming kind (reasoning-phase, reply-phase),
edit mode (textarea), disabled state, world-time footer
shown/hidden by kind. Belongs in
`Patterns/Reader composer/EntryCard` when component
implementation begins.

## What this design defers

- **Reasoning text in search scope** — provenance, not narrative
  content; lean: don't include. Revisit on demand.
- **Reasoning text in export / backup** — yes by default;
  confirms with the export-shape pass when it lands.
