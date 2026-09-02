# EntryCard pattern

The reader-composer narrative-row compound. Renders all five entry
kinds (`user_action`, `ai_reply`, `opening`, `system`, `streaming`)
as full-width bubbles with kind-keyed styling, conditional reasoning
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
- [`rich-entry-rendering.md`](./rich-entry-rendering.md) — the
  main content slot's rendering fork: entries exceeding the
  plainly-translatable subset render through a shadow-root rich
  host. The fork lives entirely inside the content slot; card
  chrome never enters the shadow root. The card itself renders in
  the [reader document](./reader-document.md) on every platform.

Used by:

- [Reader composer](../screens/reader-composer/reader-composer.md#per-entry-actions) —
  the narrative loop. Sole consumer in v1.

## Compound API

The `kind` prop takes the DB `story_entries.kind` values directly
(`StoryEntry['kind']`), widened with `streaming` — a transient
render state with no persisted row.

```ts
type EntryCardProps = {
  kind: StoryEntry['kind'] | 'streaming'
  content: string
  worldTimeLabel?: string

  onEdit?: () => void
  onDelete?: () => void // not for opening (block-delete) or system/streaming

  // World-time editing — see "World-time footer" below
  worldTimeRaw?: number // raw cumulative seconds; seeds the TierTupleInput in the edit overlay
  onEditTime?: (nextWorldTime: number) => Promise<boolean> // desktop/tablet Dialog Save; host writes the metadata.worldTime delta, resolves false on a failed write
  onRequestEditTime?: () => void // phone: the compound requests, the host presents the native Sheet
  worldTimeMonotonicityBreak?: MonotonicityBreak // presence fires the warning indicator + overlay banner
  worldTimeFrame?: CalendarFrame // active calendar + story origin; anchors the tuple ↔ seconds round-trip, stable reference required

  // World-state panel — see "World-state panel" below. AI / opening only.
  sceneEntityNames?: { id: string; name?: string }[] // resolved in the host's render pass; name absent renders the unknown-entity chip
  currentLocationName?: { id: string; name?: string } | null
  stateReport?: EntryMetadata['stateReport'] // ids inside are resolved by the card against the two props above
  summary?: string
  legacyStateRaw?: string // pre-strip rows only; host passes stripTrailingBlocks(content).stateRaw
  onEditScene?: (next: {
    sceneEntities: string[]
    currentLocationId: string | null
  }) => Promise<boolean> // desktop/tablet Dialog Save; presence also gates the edit control, so the host passes it on the tail entry only
  onRequestEditScene?: () => void // phone: the card requests, the host presents the native Sheet
  sceneOptions?: { characters: EntityOption[]; items: EntityOption[]; locations: EntityOption[] } // candidate pool for the editor's selects; required alongside either edit handler

  // AI / opening:
  meta?: Pick<EntryMetadata, 'tokens'> // the top line renders tokens.completion (+ tokens.reasoning when set)
  reasoning?: string
  onRegen?: () => void // ai only
  onBranch?: () => void // ai, opening
  onFlipEra?: () => void // user, ai, opening — host hides when eras: null

  // Streaming-only:
  streamingPhase?: 'reasoning' | 'reply'

  // System-only:
  detail?: string
  fixAction?: { label: string; onPress: () => void } // kind-specific recovery route (e.g. "Fix profile" → settings); precedes Retry
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

| Slot                       | user_action                      | ai_reply                                  | opening                                | system                                                              | streaming                             |
| -------------------------- | -------------------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Top line                   | `You` badge                      | meta line (glyph, brain, tokens)          | meta line                              | `System` with warn glyph                                            | meta line (brain pulses, trailing → ) |
| Reasoning body             | —                                | conditional (`reasoning` set, expanded)   | conditional                            | —                                                                   | live-streaming on `streamingPhase`    |
| World-state panel          | —                                | conditional (expanded)                    | conditional                            | —                                                                   | —                                     |
| Content                    | prose (or textarea if `editing`) | prose                                     | prose                                  | error description with inline buttons (`fixAction`, retry, dismiss) | partial prose tokens                  |
| Action cluster (top-right) | edit, `[flip era]`, delete       | edit, regen, branch, `[flip era]`, delete | edit, branch, `[flip era]` (no delete) | — (uses inline buttons)                                             | —                                     |
| World-time footer          | shown                            | shown                                     | shown                                  | hidden                                                              | hidden                                |
| Bubble styling             | `bg-bg-sunken border-border`     | `bg-bg-raised border-border`              | same as ai_reply                       | `bg-bg-base border-warning`                                         | same as ai_reply                      |

Streaming is deliberately not visually distinguished: the swap to
the committed `ai_reply` row should not re-frame the card.

`opening` renders identically to `ai_reply` for visual treatment;
the discriminator only affects available actions. See
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
never pin its own height; the parent list owns keeping the
viewport stable through the shift. The
[reader narrative anchor preservation](../screens/reader-composer/reader-composer.md#anchor-preservation-under-shifts)
section covers the parent's mechanic.

## World-state panel

**Data source:** `story_entries.metadata` — the absolute scene triple
(`sceneEntities`, `currentLocationId`, `worldTime`) plus
`metadata.stateReport` for what this turn reported (see
[data-model.md → Entry metadata shape](../../data-model.md#entry-metadata-shape)).
Globe icon in the meta line toggles the panel, mirroring the brain
toggle's anatomy.

**The toggle renders on every `ai_reply` and `opening`, not only where
a report exists.** The editable fields are the absolute triple, which
every entry carries; gating the panel on `stateReport` would make the
scene editor reachable only when a parse happened to succeed — an
affordance whose availability depends on something the user cannot
see, which is the failure mode this panel exists to remove.
`stateReport` governs the panel's contents, never its existence.

`user_action` gets no panel. Its scene metadata is inherited and
identical to the entry above it, so a panel there renders the same
facts twice. Accepted consequence: when the tail is a `user_action`
(a failed generation) the scene editor is unreachable — the recovery
there is Retry, not scene surgery.

**State:** internal `stateExpanded: boolean`, default `false`. No
external override prop, same as reasoning expansion.

### Panel anatomy

| Group                 | Source                                     | Rendered when                    | Editable  |
| --------------------- | ------------------------------------------ | -------------------------------- | --------- |
| **Scene**             | absolute triple, ids resolved to names     | always                           | tail only |
| **Changes this turn** | `stateReport.visualChanges` / `.transfers` | either is non-empty              | never     |
| **Reported delta**    | `stateReport.worldTimeDelta`               | present                          | never     |
| **Summary**           | `metadata.summary`                         | present                          | never     |
| **Parse failure**     | `stateReport.failedFields` / `.raw`        | `failedFields` non-empty         | never     |
| **Legacy block**      | `stripTrailingBlocks(content).stateRaw`    | no `stateReport`, markup present | never     |

The panel header carries the producing layer as a muted badge
(piggyback or classifier fallback) whenever `stateReport` is present.
This is the whole of the fix for the previously invisible fallback:
before it, a fallback-classifier turn wrote metadata and deltas but
touched no `content`, so its work was structurally unobservable.

**Scene** renders in-scene entities as name chips and the location as
a single resolved name; an empty scene list and a null location each
render an em-dash rather than collapsing the row, so the fields stay
in the same place across entries.

**Changes this turn** renders one line per reported mutation: a visual
change as name, category and its full-replace text; an item transfer
as item, recipient and prior holder when tracked; a stackable as key,
amount and the same holders. These exist nowhere else once the block
is stripped from `content` — deltas carry the applied effect, not the
narration of it.

**Reported delta** renders `worldTimeDelta` raw, in seconds, exactly
as emitted. Deliberately not formatted as a duration: no duration
formatter exists — [`formatWorldTime`](../../data-model.md#in-world-time-tracking)
renders an absolute instant through the calendar's display template,
and a duration needs a separate tier-walking, vocabulary-aware
formatter. Raw seconds is also the honest rendering for a provenance
field, since it is the number the model actually emitted.

### Emitted vs. applied

`stateReport` records what the model emitted; the absolute triple
records what survived validation. Two fields can disagree, and the
panel shows the disagreement rather than hiding it:

- **Location rejected.** `apply.ts` refuses a `currentLocation` that
  does not resolve to a `kind='location'` entity and inherits the
  previous location instead. The panel renders the rejected value
  struck through beside the location that was actually applied.
- **Delta clamped.** A negative or non-finite `worldTimeDelta` clamps
  to zero, and one that would push `worldTime` past the renderable
  ceiling clamps to the remaining headroom. The panel renders the
  emitted value with the applied value beside it.

Both cases currently reach only the `classifier.current_location_rejected`
and `classifier.delta_clamped` logs. Surfacing them is a side effect
of persisting the emitted values, and is the point of doing so.

**Unresolvable ids render as an "Unknown entity" chip carrying the raw
id.** `stateReport` is immutable while entities are deletable and
rollback-able, so a dangling id is a permanent state, not a transient
one. Never a crash, and never a bare UUID in the reader per
[data-model.md → ID shape](../../data-model.md#id-shape--kind-prefixed-uuids-throughout).

### Scene editor

**Restricted to the last story entry**, and _applied_ to world state
rather than merely recorded. `sceneEntities` and `currentLocationId`
drive materialized derived state — per-character `current_location_id`,
`lastSeenAt`, staged promotion — which is a fold over entries, so
editing the tail re-folds one step with nothing downstream to
invalidate. On any non-tail entry the panel renders the same fields
with **no edit control at all**, not a disabled one: a control present
everywhere but effective only at the tail repeats the failure mode
the panel exists to remove.

The world-time footer is unaffected and stays interactive on every
entry — `worldTime` is a no-cascade scalar and its own monotonicity
indicator already surfaces the only way to get it wrong.

**The editor is an overlay, not inline.** A multi-select over entities
plus a single-select location are overlay-shaped controls; nesting
them inside an expanded panel inside the scrolling
[reader document](./reader-document.md) reintroduces exactly the
collision problems the world-time overlay was shaped to avoid. Tier
split and hosting follow the world-time overlay verbatim: at desktop
and tablet the card hosts a Dialog itself; at phone it renders no
Sheet and calls a request handler, with the host presenting the native
Sheet outside the document per
[`reader-document.md → Bridge contract`](./reader-document.md#bridge-contract).

**Save / Cancel only — no "Save and regen".** Regenerating the entry
re-runs piggyback, which emits a fresh `<state>` and overwrites the
scene edit that was just saved, so the pairing is self-defeating here.
The affordance belongs to content editing on a `user_action`, where
the reply genuinely answers text that no longer exists; it is tracked
separately in [`followups.md`](../../followups.md#ux).

Failure handling matches the world-time overlay: a rejected or failed
write keeps the overlay open with the edit intact and reports inline;
the controls disable and Save shows its loading indicator while
pending; only a successful write closes it; a Save with nothing
changed takes the cancel route without writing a delta.

**The edit is the first ungated second writer to entry metadata**, so
it inherits the writer-serialization fix — see
[`followups.md`](../../followups.md#ux). Both pipeline writers run
behind the hard gate today, which is the only reason the interleave is
currently unreachable.

### Legacy rows

Rows written before the strip retain their markup in `content` and
carry no `stateReport`. The panel falls back to today's rendering for
those — the raw block in monospace, read-only — rather than migrating
them. Their absolute triple is intact, so a legacy tail entry still
edits normally.

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
interactive when the host supplies `worldTimeRaw`, `worldTimeFrame`
(the calendar paired with the story origin), and at least one edit
handler — in practice on
AI, opening, and user entries (classifier-authored,
wizard-authored, or inherited-at-write `worldTime`; see
[`data-model.md → In-world time tracking`](../../data-model.md#in-world-time-tracking)).
Hover-brighten + cursor pointer signal the affordance. Click opens
an edit overlay: **centred Dialog on desktop, bottom Sheet on
phone** (per [`patterns/overlays.md`](./overlays.md) and the
[mobile decision tree](../foundations/mobile/layout.md)). Tablet
follows the standard breakpoint rule.

**The desktop overlay is deliberately not anchored to the footer.**
The trigger lives in a scrolling entry list, so an anchored Popover
tracks a footer that moves under it and overlaps the chrome framing
the list — a centred modal sidesteps the whole class of problem
rather than chasing it with collision detection.

**Overlay hosting splits by tier** since the single-document reader
pivot. At desktop and tablet breakpoints EntryCard hosts the Dialog
itself — pure DOM, so it works inside the
[reader document](./reader-document.md) on every platform. At phone
breakpoint the compound renders no Sheet: it calls
`onRequestEditTime`, and the host presents the native bottom Sheet
outside the document (the document requests, native presents — see
[`reader-document.md → Bridge contract`](./reader-document.md#bridge-contract)).
The breakpoint is the one the card itself lays out in, which is the
reader document rather than the device. A host that supplies only
`onRequestEditTime` gets the request path at every tier, not just
phone — the card will not host a Dialog whose Save has nowhere to
report, since that would discard the edit silently. Both overlays
mount the same edit form, so the user-visible shape below is
identical on either tier.

The overlay body hosts a `TierTupleInput` matching the active
calendar's tier shape (the same primitive the wizard's
`worldTimeOrigin` step uses), pre-populated by walking
`worldTimeRaw` from the frame's origin through the calendar's tier
stack. Save
computes the new cumulative seconds and invokes `onEditTime(next)`
(phone: the host's Sheet save); the host writes one `op=update`
delta against `entries.metadata.worldTime`. Cancel discards.

A rejected or failed write keeps the overlay open with the typed
tuple intact, on both tiers. The form reports the failure inline, in
the same rendering realm as the editor, so the user retries or
cancels without retyping. While Save is pending, the tuple controls
and Cancel are disabled, Save carries its loading indicator, and
the Dialog or Sheet cannot be dismissed. Only a write that reports
success closes the overlay; `onEditTime` resolving `false` and
`onEditTime` rejecting are both treated as failures.

A Save whose tuple is unchanged never reaches the write path at
all: no delta, no edit callback, and the overlay closes through the
same cancel route an explicit Cancel takes. The check is tuple
equality, not a comparison of the recomputed seconds — on a
coarse-grain calendar (`secondsPerBaseUnit` above one) the tuple
can't express a sub-base-unit remainder, so a seconds-level test
would read an untouched Save as a change and rewrite `worldTime` to
the truncated value.

On phone the Sheet variant carries a non-scrollable body
(TierTupleInput is a fixed-shape form), so the Sheet's default
`avoidKeyboard={true}` alone is sufficient — no
`KeyboardAwareScrollView` wrap needed, per the consumer rule in
[`overlays.md → Sheet — Keyboard handling`](./overlays.md#sheet--keyboard-handling).

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

## Action cluster

Per-kind action sets:

| Kind        | edit                                                  | regen | branch | flip-era    | delete            |
| ----------- | ----------------------------------------------------- | ----- | ------ | ----------- | ----------------- |
| user_action | yes                                                   | —     | —      | conditional | yes               |
| ai_reply    | yes                                                   | yes   | yes    | conditional | yes               |
| opening     | yes                                                   | —     | yes    | conditional | no (block-delete) |
| system      | (inline buttons inside content; no top-right cluster) |
| streaming   | (no actions; cancel via composer)                     |

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

The reader narrative anchor-preservation concern is the parent
list's responsibility, not EntryCard's. EntryCard ships
compatible.

## Storybook (EntryCard)

Live demos for: user kind, ai kind (with reasoning expanded /
collapsed), opening kind (no delete action), system kind (with
detail expanded), streaming kind (reasoning-phase, reply-phase),
edit mode (textarea), disabled state, world-time footer
shown/hidden by kind, world-state panel (reported, fallback-layer
badge, rejected location, clamped delta, parse failure with raw
block, legacy row, unknown-entity chip), scene editor (tail entry
editable, non-tail read-only). Belongs in
`Patterns/Reader composer/EntryCard` when component
implementation begins.

## What this design defers

- **Reasoning text in search scope** — provenance, not narrative
  content; lean: don't include. Revisit on demand.
- **Reasoning text in export / backup** — yes by default;
  confirms with the export-shape pass when it lands.
