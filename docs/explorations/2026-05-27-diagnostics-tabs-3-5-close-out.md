# Diagnostics Hub · Tabs 3 (Call log) + 5 (Delta log) — detail-pass close-out

Session record, 2026-05-27 (second pass of the day; sibling to
[`2026-05-27-diagnostics-tab4-logs-close-out.md`](./2026-05-27-diagnostics-tab4-logs-close-out.md)).
Partially resolves the
[`Diagnostics hub — per-tab body design pass for tab 2`](../followups.md#diagnostics-hub--per-tab-body-design-pass-for-tab-2)
followup — narrows the active entry from "tabs 2, 3, 5" to "tab 2"
once Tabs 3 and 5 land. Canonical spec changes land in
[`ui/screens/diagnostics/diagnostics.md`](../ui/screens/diagnostics/diagnostics.md);
this file is the frozen reasoning trail.

## Problem

[`diagnostics.md`](../ui/screens/diagnostics/diagnostics.md) ships
Tab 4 (Logs) at detail-pass fidelity after the first 2026-05-27
session. Tabs 3 (Call log) and 5 (Delta log) remain at "what's in
this tab" level — the body content is described in prose but pixel-
level interaction, row treatment, filter composition, and per-tier
expression aren't pinned.

Tabs 3 and 5 share enough structural ground with Tab 4 — single-list
with row-aware-of-state, Toolbar-composed filter row, MultiSelect
for growing-enum dimensions, cross-tab nav via shared `actionId`
substrate — that batching them produces less drift than sequencing.
Each adds distinct new wrinkles (Tab 3: in-flight row state; Tab 5:
unscoped DeltaLogRow composition + branch-expand toggle) that don't
overlap conceptually with each other, so the batching is honest
rather than forced.

## Scope decision: batch 3 + 5, defer Tab 2

Tab 2 (Per-turn inspector) embeds subsets of Tabs 3 and 4 inside
its detail pane (cross-cut HTTP calls + log entries filtered by
the inspected turn's `actionId`). Designing Tab 2 before Tabs 3
and 4 are detail-spec'd would force re-revisits when the embedded
row shapes change. Tab 2 lands last.

This pass closes out Tabs 3 + 5 batched in one session.

## Decisions and rationale

### "Range filter" framing collapses — no new substrate

Tab 3's HTTP status range and Tab 5's time range looked like they
might share a substrate. They don't — different shapes:

- **Status range (Tab 3)** — discrete buckets `1xx / 2xx / 3xx /
4xx / 5xx`. Multi-select-of-N (user may want `4xx + 5xx`
  together = "errors"). Reuses [MultiSelect](../ui/patterns/multi-select.md)
  (the new primitive extracted in the Tab 4 close-out).
- **Time range (Tab 5)** — continuous window relative to now.
  Single-active-at-a-time (you're in one window or another). Maps
  to the [Select primitive](../ui/patterns/forms.md#select-primitive)
  in dropdown mode with preset options: `All time / Last 5m /
Last 15m / Last 1h / Last 6h / Last 24h`.

Neither needs new substrate. The framing question was the only
shared shape decision; once answered, the rest is per-tab work.

### Tab 3 — Call log

#### Row state-aware visual (the novel piece)

The `.md`'s in-flight / completed / failed contract — row
identity stable across the transition — needed a row visual that
adapts without re-mounting. Canonical row + status-slot spec lives
at [`diagnostics.md → Row state-aware visual (Tab 3)`](../ui/screens/diagnostics/diagnostics.md#row-state-aware-visual-tab-3).

**Why dot-in-slot, not a separate spinner column.** A separate
spinner adds chrome that only applies to in-flight rows; the
slot-replacement keeps the column grid uniform regardless of
state and reads as "this row's status is currently 'in-flight'"
rather than "this row has a loading indicator."

**Specific status code, not bucket label.** Resolved rows show
`200` / `404` / `503` (specific) rather than `2xx` / `5xx`
(bucket). Once a call resolves, the user wants the specific code
for triage; the bucket-color tone keeps the at-a-glance severity
signal.

#### Expanded row content — split by state

The expanded JSONBlock adapts per state — Request section
always, plus `─── Response ───` (completed) or `─── Error ───`
(failed) sub-section divider. In-flight reads `Waiting for
response…` placeholder. Canonical spec at
[`diagnostics.md → Row expansion — tablet+ (Call log)`](../ui/screens/diagnostics/diagnostics.md#row-expansion--tablet-call-log).

Expand state survives the in-flight → resolved transition per
the `.md`'s stable-identity contract. The implementer wires the
expand toggle on row identity (ULID), not on row content, so the
response/error data slots in without re-mount.

#### Header redaction visual

Redacted headers per [`observability.md → Header redaction`](../observability.md#header-redaction)
render their literal mask value `'***'` in the JSONBlock. No
special chrome on the redacted header line — the `'***'` value
is the signal. No inline disclaimer, no banner. The redaction
contract list is short and known.

Unredaction-in-debug-mode is parked indefinitely — would require
unredacted upstream capture, separate design pass tied to
`debug_level_enabled`.

#### Filter row composition (Tab 3)

Four dimensions composing the Toolbar pattern: URL/body Search,
State chips, Source MultiSelect, Status range MultiSelect.
Canonical at [`diagnostics.md → Filters (Call log)`](../ui/screens/diagnostics/diagnostics.md#filters-call-log).

**Status range = MultiSelect, not chips.** Five buckets is at
the chip-vs-MultiSelect boundary established in Tab 4 (3 = chips,
8+ = MultiSelect). Tab 3 already has more filter dimensions than
Tab 4; adding 5 visible status chips on top of 3 state chips
would dominate the chrome cluster, especially on phone. The
severity-color dots inside the overlay rows compensate for the
lost at-a-glance signal.

**State stays chips.** Three fixed values, severity-color-coded
(in-flight neutral / completed success / failed danger). Reads
as the analog of Level chips in Tab 4.

#### Count badge

Unfiltered `httpCalls` buffer total, always rendered. Color by
max severity present (per the Tab 4 close-out's per-tab rule):

- Any failed (transport) OR any completed 5xx → danger.
- Any completed 4xx → warn.
- Else (in-flight, completed 2xx/3xx only) → neutral.

#### Phone-tier row layout

Two-line shape (per the Tab 4 precedent):

```
14:02:18  POST  [200]   1.84s   tr_a3kf
api.anthropic.com/v1/messages
```

Top line: time, method, status chip, duration, actionId chip.
Bottom line: URL (full, no truncate). Tap → Raw JSON viewer Sheet
with the request + response sections (or in-flight content per
the current state). Sheet header: `HTTP · <method> · <URL host>
· <time>`.

#### Cross-tab nav

Outbound: actionId chip on a row → per-turn inspector (existing).

Inbound from per-turn inspector clicking a specific HTTP call
row: `actionId=X, focusEntryId=Y_callId` arrival. Nudges per the
Tab 4 substrate — additive on Source/State/Status MultiSelects;
URL/body free-text does NOT auto-clear. Auto-scroll +
auto-expand the focused call. Turn Tag chip in filter row.

Inbound broad: `actionId=X` only. Apply filter, preserve other
filters, empty-state with `[Clear other filters]` / `[Clear
actionId]` if intersection is empty.

### Tab 5 — Delta log

#### Row body reuses DeltaLogRow as-is

The existing [DeltaLogRow pattern](../ui/patterns/delta-log-row.md)
accommodates the unscoped-across-rows variant cleanly: the host
supplies `targetDisplayName` opaquely. Tab 5 prefixes with table
type:

- `Entity · Kael`
- `Thread · Iron Pact`
- `Happening · The Bridge Collapse`
- `Lore · The Iron Pact (religion)`
- `Translation · entry #47 (es)`

The pattern doc's existing prose already documents this exact
shape — Tab 5 is the first consumer. No DeltaLogRow changes.

Diff cache pending fallback is built into the pattern (`summary:
string` stays unchanged in either state; cache miss → undo_payload
keys; cache populate → rich prose). Tab 5 inherits directly.

#### Row tap behavior — diverges from World/Plot

Tab 5 wires DeltaLogRow's `onPress` to "open Raw JSON viewer
Sheet for `undo_payload`" rather than "navigate to target detail
pane" (the World/Plot wiring). Three consumers, two semantics —
allowed per the host-wired contract. Canonical at
[`diagnostics.md → Row tap behavior`](../ui/screens/diagnostics/diagnostics.md#row-tap-behavior).

**Why Sheet, not navigate.** Tab 5 is an inspection surface
inside the hub; routing the user out to World/Plot detail panes
would break the inspection flow. The Sheet keeps the user in the
hub with the raw payload visible.

**Why no inline accordion.** DeltaLogRow is already 3-line.
Stacking a tall expanded body below dominates the list. Sheet
overlay is the right surface for the full `undo_payload`.

#### Filter row composition (Tab 5)

Six dimensions composing the Toolbar pattern: free-text Filter,
Source MultiSelect, Target MultiSelect, Branch segment, Time
range Select. Canonical at
[`diagnostics.md → Filters (Delta log)`](../ui/screens/diagnostics/diagnostics.md#filters-delta-log).

#### Branch segment — why 2-segment Select

Three candidates considered:

- **Chip toggle `[All branches]`** — single chip, off = current
  only. Compact but implicit off-state.
- **2-segment Select `[This branch | All branches]`** — explicit
  both-states-visible. Semantic two-option pick (not a boolean
  on/off — the [forms.md anti-pattern](../ui/patterns/forms.md#switchrow-pattern)
  bars `[off | on]` segments but permits "semantic two-option
  picks" by name).
- **Branch picker gains "All branches" option** — couples Tab 5
  logic into shared story-selector chrome. Tab 2 / Memory probe
  don't share this need.

Chose 2-segment Select. Explicit states, no chrome coupling.

#### Time range — wall-clock anchor (rationale)

The wall-clock-anchor decision matters because the alternative
("anchor to most recent story activity") was an easy assumption
to make and would have surprised users on reopen-after-days
flows. Wall-clock matches the literal-recency mental model.
Canonical spec at
[`diagnostics.md → Time range — wall-clock anchor`](../ui/screens/diagnostics/diagnostics.md#time-range--wall-clock-anchor).

Absolute date-range picker parked-until-signal.

#### Count badge — scope-respecting, no severity

Count = deltas in the current scope (branch toggle aware). Other
filters (source, target, time, free-text, actionId) are within-
scope filters and don't affect the count — same rule as Tab 4's
"unfiltered" but with scope-toggle as the scope boundary instead
of ring buffer.

No severity dimension; color stays neutral. Confirms the per-tab
note from the Tab 4 close-out.

#### Phone-tier row inherits DeltaLogRow

DeltaLogRow has no separate phone-tier shape — its 3-line layout
(op badge + target / summary / meta) is content-driven and
adapts naturally to narrow widths. Tab 5 inherits this; filter
row uses the Toolbar overflow rule.

Phone-tier secondary cluster (6 chrome elements - Source MS,
Target MS, Branch segment, Time Select, plus Turn Tag chip on
arrival) wraps to ~3 visual lines on phone. Tightest filter
chrome in the hub, but acceptable for Tab 5's inspection focus.

#### Cross-tab nav — Tab 5 specifics

Inherits the Tab 4 substrate. Tab 5-specific additions
(canonical at [`diagnostics.md → Cross-tab nav (Delta log)`](../ui/screens/diagnostics/diagnostics.md#cross-tab-nav-delta-log)):

- **Branch toggle nudge** — focus delta on a different branch
  silently expands the segment to "All branches" (additive
  scope-expansion mirroring the multi-select nudge).
- **Auto-emphasis without accordion** — since Tab 5 has no
  inline expand, focus-row emphasis is scroll-into-view +
  transient 1.5s tint that fades to normal. The substitute
  affordance for the auto-expand that Tab 4 uses.
- **Aged-out chip handling** — when the actionId's turn capture
  has aged out of the ring buffer, the chip becomes
  informational rather than navigational. Tab 4 / Tab 3 don't
  have this issue because their data sources (in-memory ring
  buffers) age out together with the turn capture; Tab 5's
  persisted `deltas` table outlives the in-memory turn data.

## Adversarial pass — folded refinements

The "feels right" check surfaced six items, all folded into the
spec rather than reopening decisions:

1. **Time range wall-clock anchoring** explicit in the spec.
2. **Tab 5 cross-tab arrived emphasis** = scroll-into-view +
   transient tint (substitute for accordion-expand).
3. **Tab 5 row-tap divergence** from World/Plot documented; spec
   tells implementer to wire `onPress` to open Sheet, not navigate.
4. **Tab 3 expand state survives transition** reiterated in spec
   body so the implementer can't miss the requirement.
5. **No min-selection enforcement on Source/Target/Status filters**;
   consumers allow 0-selected with the filters-hide-all empty state.
6. **Filter predicates apply to live row state** — implementation
   guidance for Tab 3's state-aware filtering. When State filter
   includes only `completed`, an in-flight row that completes
   mid-filter doesn't pop in/out via cached state; the predicate
   reads current state per render.

## What this defers

- **Tab 2 (Per-turn inspector) detail pass.** The remaining tab.
  Embeds subsets of Tabs 3 + 4 + 5 as cross-cut sub-views per
  the hub's `actionId` substrate. Owned by the next pass.
- **Date-range picker for Tab 5 time range.** Absolute `From [date]
To [date]` picker; power-user shape. Parked-until-signal.
- **Cross-hub-out detail-pane navigation from Tab 5.** A
  hover-revealed icon button on each Tab 5 row that jumps to the
  target's home in World/Plot/etc. Parked-until-signal.
- **DeltaLogRow inline-diff-expansion.** Already deferred at the
  pattern level. Tab 5 doesn't earn it; Sheet route covers
  inspection.
- **Streaming-partial-content visible during in-flight expand
  (Tab 3).** Currently the in-flight expanded body shows request
  only; streaming chunks visible mid-stream is parked alongside
  the existing
  [`progressCall`](../parked.md#observability--progresscall-for-streaming-live-byte-count)
  followup.

## Integration plan

**Canonical doc edits:**

- [`docs/ui/screens/diagnostics/diagnostics.md`](../ui/screens/diagnostics/diagnostics.md) —
  Tab 3 and Tab 5 sections grow from sketch to detail-pass
  fidelity. Tab 3: row state-aware visual + transition spec,
  expanded body sub-section split, filter row composition (4
  dimensions), header redaction visual, count badge, phone-tier
  two-line row, cross-tab nav variants (in + out), empty states.
  Tab 5: filter row composition (6 dimensions + branch segment +
  time range presets), branch-toggle scope semantics, row-tap
  → Sheet behavior, count badge scope-respecting rule, phone-tier
  inherited from DeltaLogRow, cross-tab nav with aged-out
  fallback, empty states. Plus the "Screen-specific open
  questions" Tab 3 / Tab 5 entries resolved.

- [`docs/ui/screens/diagnostics/diagnostics.html`](../ui/screens/diagnostics/diagnostics.html) —
  wireframe additions:
  - New mode buttons for Tab 3 default (collapsed), Tab 3 row-
    expanded with JSONBlock, Tab 3 in-flight state (pulsing
    dot + Waiting…), Tab 3 cross-tab arrived.
  - New mode buttons for Tab 5 default, Tab 5 row-tap state (or
    placeholder for the Sheet overlay), Tab 5 cross-tab arrived
    with branch-segment auto-toggle.
  - Phone-tier variants for both tabs.

- [`docs/ui/patterns/data.md`](../ui/patterns/data.md) — Used-by
  list gains Tab 3 (expanded row JSONBlock with sub-section
  Request/Response split + phone Sheet tap-open) and Tab 5 (row-
  body tap → Raw JSON viewer Sheet for undo_payload inspection).

- [`docs/ui/patterns/delta-log-row.md`](../ui/patterns/delta-log-row.md) —
  the Used-by entry for Tab 5 already exists; refine to mention
  the Sheet-tap-for-undo_payload host wiring and the table-type
  prefixing variant.

- [`docs/ui/patterns/multi-select.md`](../ui/patterns/multi-select.md) —
  Used-by list gains Tab 3 (Source + Status range) and Tab 5
  (Source + Target table). Tab 5's Source is also the first
  consumer with a "soft signal" inside the overlay (severity-
  color dots on Status range bucket rows) — note as a
  consumer-styling extension since the primitive remains
  policy-neutral.

- [`docs/ui/patterns/toolbar.md`](../ui/patterns/toolbar.md) —
  Used-by additions: Tab 3 (Search = URL/body, chips = State,
  MultiSelect secondary cluster = Source + Status), Tab 5
  (Search = name/field path, chips = none, secondary cluster =
  Source MS + Target MS + Branch segment + Time Select in Sort
  slot).

- [`docs/ui/patterns/chips.md`](../ui/patterns/chips.md) — Used-by
  additions: Tab 3 State chips (severity-color-coded), Tab 3
  Turn Tag chip on arrival, Tab 5 Turn Tag chip on arrival.

- [`docs/ui/patterns/forms.md`](../ui/patterns/forms.md) — Used-by
  list for the Select primitive gains Tab 5 (Time range Select
  in Sort slot; Branch segment as 2-option Select).

- [`docs/followups.md`](../followups.md) — narrow the
  "Diagnostics hub — per-tab body design passes for tabs 2, 3, 5"
  entry to "tab 2" (Tabs 3 + 5 done in this pass; pointer to
  this exploration record).

- [`docs/parked.md`](../parked.md) — three new entries:
  - `Tab 5 absolute date-range picker for time range` (parked-
    until-signal).
  - `Tab 5 cross-hub-out detail-pane navigation` (parked-until-
    signal).
  - `Tab 3 streaming-partial-content visible during in-flight
expand` (parked-until-signal; cross-references the existing
    `progressCall` entry).

**No renames in this diff.** New subsections under existing
`### Tab 3 — Call log` and `### Tab 5 — Delta log` headings; no
slug breakage.

**Intentional repeated prose check.** Both tabs cite shared
substrate (MultiSelect, Toolbar, JSONBlock, DeltaLogRow, Tab 4
cross-tab nav substrate) rather than restate. Empty-state copies
are per-tab. No intentional cross-doc duplication.

**Followups in/out**:

- Resolved: nothing fully resolved (Tabs 3 + 5 are part of the
  per-tab passes followup, which narrows to "tab 2"); no other
  followups intersect with this scope.
- Added: three parked-until-signal entries above.
