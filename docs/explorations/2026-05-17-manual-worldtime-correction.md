# Manual worldTime correction — direct entry-footer edit

Resolves the manual worldTime correction question previously
tracked in `followups.md`, removed by the commit that lands this
exploration. The followup framed the work around cascade-vs-jump
policies,
blast-radius previews, and monotonicity guardrails. The resolution
collapses that framing: the user gets direct edit on each entry's
world-time footer, no smarts. Soft-monotonicity becomes the only
new invariant claim, and the UI surfaces violations with an inline
indicator rather than blocking or auto-correcting.

## Invariants — three layers

The "monotonically non-decreasing within a branch" claim on
[`worldTime`](../data-model.md#entry-metadata-shape) splits into
three layers, each with different enforcement:

- **Storage invariant** (hard): `worldTime ≥ 0`. The integer is
  non-negative; the action layer rejects writes outside this
  range. Already true; this design doesn't change it.
- **Classifier invariant** (hard, newly explicit): the classifier
  emits per-entry deltas with `delta ≥ 0`. Flashbacks emit `0`.
  The classifier is structurally incapable of producing a
  non-monotonic cumulative sequence on its own. Pipeline-layer
  validation rejects classifier outputs with negative deltas; on
  rejection, re-roll, then clamp to `0` with a logged anomaly if
  re-roll also fails.
- **Cumulative monotonicity** (soft, demoted): the sequence
  `worldTime[1..N]` is monotonically non-decreasing **when written
  by the classifier**. User manual edits may produce non-monotonic
  sequences. Downstream consumers tolerate any non-negative value;
  the UI flags violations on the offending entry with a warning
  indicator.

The demotion is the key conceptual move. By treating cumulative
monotonicity as a preferred state rather than an enforced
invariant, the system removes the need for cascade automation,
blast-radius preview, and validation gates on user edits. The cost
is borne by downstream consumers (which read whatever is stored)
and by the user's visual workspace (which gets the indicator).

## Edit affordance — entry-footer click

**Surface.** The per-entry world-time footer on
[`EntryCard`](../ui/patterns/entry-card.md) — already drawn at
[`reader-composer.md → Per-entry world-time footer`](../ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer)
and
[`entry-card.md → World-time footer`](../ui/patterns/entry-card.md#world-time-footer)
as the future click-to-edit hook. Today: read-only. After this
design: interactive when the entry has authored worldTime
metadata.

**Gating rule.** Edit affordance fires on entries where
`metadata.worldTime` is authored — AI replies (classifier-authored),
openings (wizard-authored), and any future kind that produces
worldTime. User entries today have no authored worldTime; the
footer's `worldTimeLabel` is undefined for them, and the existing
"Hidden when `worldTimeLabel` undefined" rule
([`entry-card.md → World-time footer`](../ui/patterns/entry-card.md#world-time-footer))
already covers them. No new gating prop is needed.

**Interaction.** On editable entries, the footer text gets a
subtle hover-brighten + cursor pointer. Click opens a Popover
(desktop) or Sheet (phone) per the
[overlays decision tree](../ui/foundations/mobile/layout.md):

- **Content body** — `TierTupleInput` matching the active
  calendar's tier shape, pre-populated with the entry's current
  tier-tuple (computed by walking `metadata.worldTime +
worldTimeOrigin` through the calendar's tier stack). The
  primitive is the same one used by the wizard's
  `worldTimeOrigin` step and the Vault calendar editor — zero new
  primitives.
- **Header (conditional)** — when the
  [monotonicity indicator](#monotonicity-indicator) is present
  on this entry, the warning text renders at the top of the body
  (e.g., "⚠ Earlier than previous entry (Day 12 · 16:00)"). On
  mobile this is the only way the user sees the warning detail
  (no separate tap target — see below); on desktop it
  complements the inline tooltip.
- **Footer** — `Save` / `Cancel` buttons, right-aligned.

**Save flow.** Compute the new cumulative seconds from the edited
tier-tuple via the calendar's tier-stack (forward walk; symmetric
with how the wizard's `worldTimeOrigin` is resolved). The action
layer writes one `op=update` delta against `entries.metadata.worldTime`
(see [Delta-log behavior](#delta-log-behavior)). Popover / Sheet
closes; footer re-renders with the new label; the indicator
re-evaluates for this entry and its successor on the next render.

**Cancel flow.** Discard, close. No delta.

**Cross-tier.** Desktop: Popover anchored to the footer. Phone:
Sheet container with the same content. Tablet follows the standard
breakpoint rule in
[`foundations/mobile/layout.md`](../ui/foundations/mobile/layout.md).
The phone path inherits the Sheet primitive's keyboard contract —
resolved 2026-05-21, canonical at
[`patterns/overlays.md` → Sheet — Keyboard handling](../ui/patterns/overlays.md#sheet--keyboard-handling).
For this surface the body is non-scrollable (TierTupleInput is a
fixed-shape form), so `avoidKeyboard={true}` alone is sufficient
without a `KeyboardAwareScrollView` wrap.

**Edit-restrictions interaction.** When the entry is `disabled`
(in-flight generation, per
[`principles.md → Edit restrictions during in-flight generation`](../ui/principles.md#edit-restrictions-during-in-flight-generation)),
the footer click is also disabled — same gating as content edit,
regen, and delete. Reuses the existing principle; no new rule.

**EntryCard API additions.** Three new props:

```ts
onEditTime?: (nextWorldTime: number) => void  // host writes the delta
worldTimeRaw?: number                          // raw cumulative seconds (seeds TierTupleInput)
worldTimeMonotonicityBreak?: {
  previousLabel: string                        // formatted predecessor label (powers tooltip + Popover warning)
}
```

The host (`reader-composer`) supplies `onEditTime` and
`worldTimeRaw` only when the entry has authored worldTime, and
supplies `worldTimeMonotonicityBreak` only when the monotonicity
check fires. EntryCard stays calendar-agnostic — the host does the
formatting.

## Monotonicity indicator

**Visual.** A small warning glyph (triangle-exclamation icon at
footer-text size, `text-warning` color) rendered inline preceding
the entry's worldTime footer label ("⚠ Day 12 · 14:30").

**When it fires.** The indicator appears on an entry when:

- The entry has a worldTime footer rendered (not user / system /
  streaming with undefined label).
- The entry's `worldTime > 0` (flashbacks with `worldTime = 0`
  use the existing non-main-timeline convention and don't count
  as violations).
- The most recent preceding entry on the same branch with
  `worldTime > 0` has `worldTime` greater than this entry's.

In other words: walking backward from the entry, skip flashbacks
and entries with no authored worldTime, and compare to the first
main-timeline predecessor found. If that predecessor's worldTime is
greater than this entry's, fire the indicator.

**Persistence.** State, not event. The indicator persists as long
as the violation persists. Re-edits that restore order clear it on
the next render; edits to predecessors may relocate which entry
shows the indicator. No stored "dismissed" flag.

**Tooltip / hover (desktop only).** Hovering the indicator surfaces
a tooltip with the predecessor's rendered label — quick peek without
opening the Popover.

**Tap behavior (mobile + desktop click).** The entire footer is a
single tap target that opens the edit Popover or Sheet. When the
indicator is present, the Popover / Sheet body surfaces the warning
prominently above the TierTupleInput — same explanation as the
desktop tooltip, plus the input below for immediate correction.
This collapses two tap targets into one, avoiding the mobile clash
between "see warning detail" and "open edit."

**One color, one severity.** Cumulative monotonicity is the only
checked invariant at this layer. Indicators for downstream
consequences (happenings shifted, threads shifted) are
**not** added — those are accepted-silent per
[Downstream behavior](#downstream-behavior).

**Implementation cost.** Per-entry check is O(1) at render time,
fed by a host-level O(N) walk that maintains "running previous
main-timeline worldTime" once per list render. Virtualization keeps
the on-screen subset small; the full-list walk only runs when the
entries collection changes.

## Delta-log behavior

**Single delta per edit.** One `op=update` row in `deltas`
targeting `(table=story_entries, target_id=entry_id,
field_path=metadata.worldTime)` with `undo_payload = { worldTime:
<old_value> }`. No cascade means no `action_id` grouping is needed
— one user edit produces one delta.

**Standard CTRL-Z reverses.** The undo machinery already handles
single-field metadata edits (per
[`data-model.md → Metadata edits are delta-logged`](../data-model.md#entry-metadata-shape)).
The reversal writes the old worldTime back; the monotonicity
indicator re-evaluates on the next render.

**Delta-snapshot cache compatibility.** Per the unresolved
[delta diff cache followup](../architecture.md#delta-history-diff-resolution),
the cache stores per-field post-state. A worldTime edit is exactly
a per-field update — fits the cache shape with no special handling.

**History-surface display.** When `DeltaLogRow` consumes worldTime
edits (in the future World / Plot history tabs and the global
delta-log surface), the host formats prose as
`Changed in-world time on "<entry preview>" from <old> to <new>`,
with both labels rendered through the active calendar formatter.
No new pattern work; this is the
[existing host-renders-prose contract](../ui/patterns/delta-log-row.md).

**No coalescing on repeated edits.** Two edits in succession
produce two deltas; CTRL-Z walks back through both. The user can
freely iterate without the system collapsing intermediate states.

## Downstream behavior

The "no smarts" stance requires every consumer reading worldTime to
tolerate any non-negative value, including out-of-order sequences.
Each consumer class behaves as follows:

**Happenings derivation.** `happenings.occurred_at_entry` resolves
to the entry's current `worldTime` at read time (per
[`data-model.md → Happenings & character knowledge`](../data-model.md#happenings--character-knowledge)).
Editing an entry's worldTime silently shifts every happening
derived from it on the next read. This is correct under "no
smarts" — the user changed when the entry occurred, and derived
happenings inherit the change. The delta log entry on the entry's
metadata is the audit trail. World panel, Plot timeline, and any
other happenings-displaying surface re-render with the new time on
the next data fetch.

**Threads.** Same story — threads resolve via entry positions and
derive worldTime from the host entry (per
[`data-model.md → Happenings & character knowledge`](../data-model.md#happenings--character-knowledge)).
Silent shift on edit. Accepted.

**Branch era flips.** `branch_era_flips.at_worldtime` is captured at
trigger time (per
[`data-model.md → Era flips`](../data-model.md#era-flips)) — a stored
integer, not a derived value. Editing the entry whose worldTime was
the trigger value does NOT shift the flip. The flip stays at its
captured `at_worldtime`. This is pre-existing semantics of era
flips and is fine; era boundaries are calendar configuration, not
derived state.

**Chapter popover ranges.** The chapter popover renders each
chapter's time range. Today's prose at
[`reader-composer.md → Chapter popover rows`](../ui/screens/reader-composer/reader-composer.md#top-bar--in-world-time-display)
doesn't specify whether the range is first-entry → last-entry or
min → max. Under "no smarts," user edits can produce
`first > last` in narrative order, making a first-last range
render backward. **Range computation switches to `min` / `max`
across the chapter's entries** (excluding flashbacks with
`worldTime = 0`), making the display robust to any user edit.
Cheap — one walk per chapter at render time.

**Character ageing / scheduled-happening firing (future).** These
parked features must read each entry's worldTime independently and
not assume monotonic order. Sort by `position` (narrative order)
when iterating; use whatever worldTime each entry currently has.

**Memory retrieval recency.** The
[ranker](../memory/retrieval.md#the-ranker) uses entry worldTime as
a recency input. User edits can produce entries that score "older"
than their narrative-successor — this matches user intent (they set
worldTime backward because the corrected in-world time is earlier).
Acceptable.

## Doc-housekeeping cleanups

The design lands several small clarifications and invalidates
existing forward-looking hints.

**1. Top-bar earmark for manual correction → dropped.**
[`reader-composer.md → Time-chip popover`](../ui/screens/reader-composer/reader-composer.md#time-chip-popover)
currently earmarks the top-bar popover as the home for manual
worldTime correction. That earmark is invalidated: correction
happens at the entry being corrected, not at the top bar. The
passage drops the manual-correction line; the popover remains the
anchor for era flips and other future top-bar-anchored
affordances.

**2. EntryCard "Future hook" → today's behavior.**
[`entry-card.md → World-time footer`](../ui/patterns/entry-card.md#world-time-footer)
and
[`reader-composer.md → Per-entry world-time footer`](../ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer)
currently describe the click-to-edit affordance as a future hook.
Both passages rewrite to describe today's interactive behavior
(click → Popover desktop / Sheet phone → TierTupleInput → Save
writes one delta), reference the new EntryCard props, and reference
the [monotonicity indicator](#monotonicity-indicator) rule. The
EntryCard "What this design defers" list drops the manual-worldTime
and click-to-edit entries (both resolved).

**3. Flashback-edit wart.**
[`data-model.md → In-world time tracking`](../data-model.md#in-world-time-tracking)
gains a short paragraph noting that editing a flashback entry's
`worldTime` (away from `0`) effectively promotes it out of flashback
framing under the current convention. The entry becomes
indistinguishable from a regular main-timeline entry at the chosen
time. The future `sceneTime` exit, when it lands, restores the
distinction; until then, treat manual edits on flashback entries
as deliberate promotion. No new followup — `sceneTime` is already
a documented future direction with a clear trigger.

**4. Cumulative monotonicity language.**
[`data-model.md → In-world time tracking`](../data-model.md#in-world-time-tracking)
and the inline comment on `worldTime` in the entry metadata shape
(`data-model.md → Entry metadata shape`) rewrite from
"monotonically non-decreasing within a branch" to the three-layer
language from [Invariants](#invariants--three-layers). The
classifier-emits-delta-≥-0 contract also gets pinned in
[`architecture.md → Classifier contract — metadata fields`](../architecture.md#classifier-contract--metadata-fields),
a heading promoted out of inline bold prose to give the contract a
stable anchor target.

**5. Inbound anchor cleanup.** Eight inbound references to the
to-be-removed followup must update in the same commit:

| File                                             | Lines    | Treatment                                                |
| ------------------------------------------------ | -------- | -------------------------------------------------------- |
| `ui/screens/reader-composer/reader-composer.md`  | 161, 341 | rewrites as today's behavior (cleanups 1 and 2 above)    |
| `ui/patterns/entry-card.md`                      | 171, 233 | rewrites as today's behavior (cleanup 2 above)           |
| `explorations/2026-04-28-era-flip-affordance.md` | 57       | repoint to this exploration as the resolution breadcrumb |
| `explorations/2026-05-06-entry-card-compound.md` | 192, 275 | repoint to this exploration                              |
| `calendar-systems/spec.md`                       | 450      | repoint to this exploration                              |

`calendar-systems/spec.md:87` and `ui/principles.md:304` mention
manual worldTime correction in prose without anchor links; both
remain valid after the design lands and need no edit.

## Followups generated and resolved

**Resolved (removed from
[`followups.md`](../followups.md) in the integration commit):**

- **Manual worldTime correction — cascade vs. jump, downstream
  blast radius.** This design resolves it. The commit message
  carries the resolution narrative: classifier output is delta ≥ 0
  (hard); cumulative monotonicity is demoted to soft; user edits
  write a single delta with no cascade; UI surfaces breaks via a
  soft inline indicator; downstream consumers tolerate any
  non-negative worldTime; happenings / threads silently shift as
  accepted behavior; chapter popover ranges switch to min/max for
  robustness. The previously-listed sub-concerns (cascade vs jump,
  blast-radius preview, monotonicity guardrails, sceneTime
  interplay) are all answered.

**Generated (added to
[`followups.md → Data-model`](../followups.md) in the
integration commit):**

- **Classifier delta validation.** Pipeline-layer enforcement that
  the classifier never emits negative deltas. Today this is
  implicit; this design promotes it to a hard contract. The
  validator lands alongside the classifier output Zod schema when
  classifier output validation is next touched.
- **User-entry worldTime contract.** Today's docs are inconsistent:
  `entry-card.md`'s per-kind table lists the world-time footer as
  "shown" on user entries, but the classifier doesn't run on user
  actions and no other code path authors user-entry worldTime. The
  mismatch isn't fatal today (rendering rule "hidden when
  `worldTimeLabel` undefined" silently handles the empty case) but
  the contract should be explicit: is user-entry worldTime always
  undefined, does it inherit from the preceding entry, or will it
  eventually get classifier-tagged? This design is silent on the
  answer because the edit affordance gates on `worldTime` presence
  regardless. Lands before reader-composer integration ships.

**Not generated (deliberately):**

- `sceneTime` exit design — already a documented future direction
  with a clear trigger (real non-linear-narrative demand). The
  flashback-edit wart is a pointer at that existing trigger, not a
  new deferral.
- Blast-radius preview UX — actively rejected by this design.
- Cascade-correction mode — actively rejected.
- Monotonicity hard-block / validation guardrails — actively
  rejected.

## Integration plan

**Canonical docs that change:**

- `data-model.md`
  - Entry metadata shape: inline comment on `worldTime` rewrites to
    reference the three-layer invariants.
  - In-world time tracking: "monotonically non-decreasing" sentence
    rewrites; adds downstream-tolerance contract; adds flashback-edit
    wart paragraph.
- `architecture.md`
  - Promotes the bold-prose marker "Classifier contract — metadata
    fields" inside `## Agent orchestration` to a `###` heading for
    a stable anchor target.
  - That section then gets the "delta ≥ 0" promotion to hard rule
    with rejection / re-roll / clamp behavior.
- `ui/patterns/entry-card.md`
  - World-time footer section: rewrites "Future hook" as today's
    behavior. Adds the three new props to the Compound API. Updates
    the per-kind structure table to note interactivity. Removes
    resolved entries from "What this design defers."
- `ui/screens/reader-composer/reader-composer.md`
  - Time-chip popover: drops the manual-correction earmark.
  - Per-entry world-time footer: rewrites "Future affordance" as
    today's behavior; references the indicator.
  - Top-bar in-world time / Chapter popover rows: updates the
    range-computation prose to specify min/max.
- `calendar-systems/spec.md`
  - Inverse / parse section: repoints the anchor to this
    exploration.
- `explorations/2026-04-28-era-flip-affordance.md`,
  `explorations/2026-05-06-entry-card-compound.md`
  - Anchor refs repoint to this exploration.
- `ui/screens/reader-composer/reader-composer.html`
  - Wireframe gains an indicator on at least one entry's time
    footer and a sketch of the edit Popover open state.

**Followups file:**

- `followups.md` — removes "Manual worldTime correction" entry;
  adds "Classifier delta validation" and "User-entry worldTime
  contract" under `## Data-model`.

**Renames:** none.

**New patterns adopted on new surfaces:** none — the existing
TierTupleInput, Popover, Sheet, and icon-actions primitives are
reused; no new `Used by` updates needed.

**Intentional repeated prose:** none planned. The downstream-behavior
prose lives only in this exploration record and in the canonical
`data-model.md` integration; per-screen docs reference rather than
re-state it.

**Wireframe updates:** `reader-composer.html` only.
