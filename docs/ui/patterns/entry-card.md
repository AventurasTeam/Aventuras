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
  sceneEntities?: readonly string[] // this entry's scene, in order; ids, resolved through entityNames
  currentLocationId?: string | null
  entityNames?: readonly { id: string; name?: string }[] // resolution pool for EVERY id the panel mentions, not just the scene; name absent renders the unknown-entity chip
  stateReport?: EntryMetadata['stateReport'] // ids inside are resolved by the card against the two props above
  summary?: string
  onEditScene?: (next: {
    sceneEntities: string[]
    currentLocationId: string | null
  }) => Promise<SceneSaveResult> // desktop/tablet Dialog Save; presence also gates the edit control, so the host passes it on the tail entry only, and only where the row has metadata to edit
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
  onCommitEditAndRegen?: () => void // presence renders the third button; host passes it on the head turn's user_action only
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

`stateReport` records what the model emitted **and** what `apply.ts`
did with it. Two fields can disagree with the absolute triple, and the
panel shows the disagreement rather than hiding it:

- **Location rejected.** `apply.ts` refuses a `currentLocation` that
  does not resolve to a `kind='location'` entity and inherits the
  previous location instead. The panel renders the rejected value
  struck through beside the location that was actually applied, keyed
  on `stateReport.currentLocationRejected`.
- **Delta clamped.** A negative or non-finite `worldTimeDelta` clamps
  to zero, and one that would push `worldTime` past the renderable
  ceiling clamps to the remaining headroom. The panel renders the
  emitted value with `worldTimeDeltaApplied` beside it whenever the
  two differ, which covers all three clamp causes.

The panel keys on the recorded decisions rather than comparing
`stateReport` against the absolute triple. The report is immutable
provenance while the triple is user-editable, so a comparison labels
every scene edit as a model rejection; and the panel has no access to
the previous entry's `worldTime`, so it cannot recover the applied
delta by subtraction.

**Resolution uses one pool, not the scene list.** A transfer's counterparty
and a rejected location routinely sit outside the current scene, so
scoping name lookup to scene members would render them as unknown. The
host passes `entityNames` covering every id the panel can mention, and
`sceneEntities` separately as the ordered membership the chips render.

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
invalidate. Promotion is shared with the generation fold rather than
reimplemented: a staged entity the edit names in the scene is promoted
exactly as the classifier would promote it. On any non-tail entry the panel renders the same fields
with **no edit control at all**, not a disabled one: a control present
everywhere but effective only at the tail repeats the failure mode
the panel exists to remove. The same holds for a row whose `metadata`
column is NULL: there is no absolute triple to edit, the action layer
refuses it, so the host offers no control rather than one that fails.

**A refusal says which one it was.** `SceneSaveResult` carries the
action layer's rejection code back across the bridge, and the overlay
maps it to copy. Only `deltaFailed` is worth retrying; `notTailEntry`,
`noMetadata` and `notFound` are terminal, and a generic "try again"
sends the user round a loop the action layer refuses identically every
time. The overlay stays open on failure so the edit is never silently
discarded.

The world-time footer is unaffected and stays interactive on every
entry — `worldTime` is a no-cascade scalar and its own monotonicity
indicator already surfaces the only way to get it wrong.

**The editor is an overlay; its controls are not.** The editor itself is
an overlay because it must survive the reader document scrolling under
it. Its two controls are rendered **inline inside it** — a checkbox
list for scene membership, a radio list for the location.

That is a hard constraint, not a preference. Every pick-from-a-list
primitive here — `Select`, `MultiSelect`, `SearchableOverlayList` —
presents as a bottom Sheet on phone, and the editor is itself a Sheet
on phone, so any of them nested inside it would be Sheet-over-Sheet,
which [`layout.md → Stacking`](../foundations/mobile/layout.md#stacking)
prohibits. `MultiSelect` therefore contributes
[`MultiSelectList`](./forms.md), its list body without the trigger and
overlay, and the location field forces `Select`'s inline `radio` mode
rather than letting the auto-derivation pick `dropdown`.

Tier split and hosting otherwise follow the world-time overlay: at
desktop and tablet the card hosts a Dialog itself; at phone it renders
no Sheet and calls a request handler, with the host presenting the
native Sheet outside the document per
[`reader-document.md → Bridge contract`](./reader-document.md#bridge-contract).
The phone Sheet takes a **fixed detent**, not `auto` — `auto` wraps its
content in a `BottomSheetView` that captures vertical pan and starves
the scroll region the lists need.

**Save / Cancel only — no "Save and regen".** Regenerating the entry
re-runs piggyback, which emits a fresh `<state>` and overwrites the
scene edit that was just saved, so the pairing is self-defeating here.
The affordance belongs to content editing on a `user_action`, where
the reply genuinely answers text that no longer exists — see
[Save and regenerate](#save-and-regenerate).

**The prose is not touched.** A scene correction rewrites the absolute
triple and nothing else, so an entry whose text still narrates the
character just removed now says one thing and records another. The
overlay says so, and the tail is the one row where both halves are
editable, so the remedy is one control away:

> This doesn't change the entry's text. If the prose still names
> someone you removed, edit it too.

Its mirror on the content editor is specced under
[Divergence notices](#divergence-notices).

**Unconditional, not matched against the prose.** The line renders
whenever the overlay does. Firing it only when a removed entity's name
still appears in the entry text would reuse `matchTerms`
([`name-index.ts`](../../../lib/retrieval/name-index.ts)) rather than add
a matcher, but that predicate tests whether the name is present, not
whether the text contradicts the removal. Mentioned-but-absent is a legal
scene — "Kael wondered where Mira had gone" names Mira, and removing her
is the correct edit — so it fires on edits that are already right. It
also misses most in-scene references, which are pronouns and epithets
rather than names, and never fires at all for CJK, whose lack of word
delimiters defeats the boundary lookarounds by design. Wrong in both
directions is worse than always on: the standing line is always true and
claims nothing about the particular edit, and its repetition cost is a
placement and styling problem — a quiet inline line, not a banner.

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

### Divergence notices

Editing `content` never updates the scene metadata recorded from it. The
classifier reads prose only — its window carries `promptProse(entry)`
and no metadata — so a rewrite leaves the scene triple standing on text
that is gone, and on an earlier entry nothing can be done about it
either, because the [scene editor](#scene-editor) refuses every row but
the tail. So the editor states it, and what it states depends on where
the row sits.

**The happening layer splits on the same axis.** Inside the head turn a
content edit reverses the happenings, involvements and awareness derived
from the entries it invalidates, and clamps the classifier watermark so
the next pass rebuilds them from the new text — the two notices below are
therefore not symmetric about what survives. Below the head turn none of
that runs: the clamp would force a re-read of every entry above it, whose
facts survive, and the duplicates would land in already-closed chapters
that chapter-close dedup never revisits
([`data-model.md → Entry mutability & rollback`](../../data-model.md#entry-mutability--rollback)).
So on a frozen row the recorded state genuinely does not follow, in either
direction, and the notice is the only thing standing between the user and
silent drift.

**On the tail** both halves are editable, so the notice is a nudge:

> This doesn't change the scene details recorded for this entry.
> Update them separately if the rewrite changes who was present.

**The `user_action` whose reply is the tail takes the same nudge**, even
though the row is not itself the tail. Its scene fields are inherited
rather than authored — `inheritedEntryMetadata` carries `sceneEntities`,
`currentLocationId` and `worldTime` forward onto every row, including
`user_action`s that generated nothing
([data-model → Entry metadata shape](../../data-model.md#entry-metadata-shape))
— so there is nothing entry-specific to correct on it, and the
authoritative scene for the current moment is the tail reply's, which the
scene editor does edit. [Save and regenerate](#save-and-regenerate) is
offered on this row for the reply half. A structural warning naming
rollback while both of those sat beside it would be wrong twice over.

**On any earlier entry** the scene is frozen and the only remedies are
structural. The notice says so rather than implying the edit is
equivalent:

> Only the newest entry's scene details can be updated. Rewording is
> safe — but if this changes who was present or what happened, the
> recorded world state won't follow. Branch from here, or roll back
> (which deletes this entry and everything after).

**"Branch from here" means branch, then rewrite.** Entry N is the new
branch's tail, so the rewrite lands on the head turn there and invalidates
normally. Done the other way round the fork copies the new text alongside
the facts derived from the old, and its
`processedThrough = min(parent.processedThrough, position(N))` marks the
entry processed, so nothing re-reads it
([data-model → Branch model](../../data-model.md#branch-model)). The
notice does not spell the order out — it is offered mid-edit, where
"branch" reads as "not here" — but the fork surface owns making the tail
obvious when it lands.

**The two branches of this notice are the behavioural boundary, not
commentary on it.** `resolveContentEditNotice` derives them from
`sceneEditable || hasSaveAndRegen`, which is exactly the head-turn
membership the action layer gates invalidation on. The two must move
together: a row that shows the nudge is a row whose edit self-heals, and a
row that shows the frozen copy is a row whose edit does not.

**An earlier `user_action` drops the branch clause.** That kind carries
no branch action ([Per-kind structure](#per-kind-structure)) and
branching from a user action is not planned, so rollback is the only
honest answer there — the heavier one, named as such:

> Only the newest entry's scene details can be updated. Rewording is
> safe — but if this changes who was present or what happened, the
> recorded world state won't follow. Rolling back is the only remedy,
> and it deletes this entry and everything after.

Naming rollback's blast radius in the notice is deliberate even though
the [rollback confirm](../screens/reader-composer/rollback-confirm/rollback-confirm.md)
already carries the cascade counts and the cannot-be-undone line. A
notice that recommended rollback without saying what it destroys would
send the user into that modal unprepared, which is the failure the
notice exists to prevent — as is naming a control the card does not
have.

**The opening drops the rollback clause.** It is the rollback floor —
the action layer rejects a rollback that targets it, and the card
renders no delete ([Per-kind structure](#per-kind-structure)) — so that
half of the remedy can never become true for it, unlike the branch
clause, which the fork surface will make good. Branching is the only
honest answer there:

> Only the newest entry's scene details can be updated. Rewording is
> safe — but if this changes who was present or what happened, the
> recorded world state won't follow. Branching from here is the only
> remedy — the opening can't be rolled back.

**Placement is edit mode, not the card.** The notice renders inside the
editor when the textarea opens, never as standing chrome on a non-tail
card. Most of a branch is non-tail; a permanent banner there is
wallpaper by the third entry.

**This does not extend to the reply divergence.**
[Save and regenerate](#save-and-regenerate) deliberately does not warn
that an edited `user_action` diverges from the reply below it. That
divergence is legitimate, visible in the prose itself, and has a remedy
on the same row. State divergence is none of the three: invisible on a
`user_action`, which renders no world-state panel at all
([Per-kind structure](#per-kind-structure)); expandable but easy to
miss elsewhere; and on an earlier row, unreachable short of rollback.

### Save and regenerate

Editing a `user_action` whose reply already exists diverges the story
silently: the reply answers text that no longer exists. That divergence is
legitimate — a user may want exactly it — so it is not detected or warned
about. A third button beside Save makes the alternative self-documenting:
`Cancel / Save & regenerate / Save`, with Save still primary.

**The head turn only.** The host passes `onCommitEditAndRegen` when the row
is the `user_action` whose reply is the branch tail, and on no other row.
Regenerating any earlier reply destroys every entry after it; a button
labelled as a save must not carry that, and the action cluster's `↻` already
owns the deliberate destructive path behind its
[cascade confirm](../screens/reader-composer/reader-composer.md#regenerate-confirmation).
So the button is absent on an `ai_reply` (regenerating it discards the edit
just saved), on the opening, on any earlier turn, and whenever the tail is a
standing `user_action` or a system entry — in each case there is no reply
the edit can be re-answered into.

**Both commit buttons gate on a dirty draft.** An untouched draft has nothing
to save, and saving it anyway is not free: on the head turn the write reverses
the entry's classifier facts and spends a pass rebuilding them identically, and
on any row it clears the global redo stack for nothing. `Save & regenerate`
disables alongside `Save` rather than degrading into a bare regenerate — that
path is the reply's own `↻`, behind its
[cascade confirm](../screens/reader-composer/reader-composer.md#regenerate-confirmation),
and a button that saved nothing must not route around it. `Cancel` stays live,
since backing out of an untouched draft has to stay reachable. The action layer
carries the same compare as a backstop for any other caller, returning `ok`
without writing.

**Commit, then run.** The two halves are sequential, not atomic: the
pipeline re-reads its prompt from the branch tail rather than from anything
threaded into the call, so the edit must be committed before the run starts
to be the text it reads. A refused write stops there — the draft stays open
and reports as it does for a plain Save, and no generation is spent on prose
the branch never took. Once the write lands the editor closes and the
regenerate goes through the same host path the `↻` takes, confirm gates
included.

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
edit mode (textarea, with and without `Save & regenerate`),
disabled state, world-time footer
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
