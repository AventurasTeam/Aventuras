# Diagnostics Hub · Tab 4 (Logs) — detail-pass close-out

Session record, 2026-05-27. Partially resolves the
[`Diagnostics hub — per-tab body design pass`](../followups.md#diagnostics-hub--per-tab-body-design-pass-for-tab-2)
followup — narrowed the active entry from "tabs 2-5" to "tabs 2, 3, 5"
once Tab 4 landed (subsequently narrowed further to "tab 2" once
Tabs 3 + 5 landed in the sibling 2026-05-27 close-out). Canonical spec changes land in
[`ui/screens/diagnostics/diagnostics.md`](../ui/screens/diagnostics/diagnostics.md);
the Subsystem multi-select decisions promote to a new
[`ui/patterns/multi-select.md`](../ui/patterns/multi-select.md);
this file is the frozen reasoning trail.

## Problem

[`diagnostics.md`](../ui/screens/diagnostics/diagnostics.md) shipped
as a hub-level surface inventory. Its wireframe renders the Logs tab
body as the **representative example** of what a tab body looks like
— filter chip row + 5-column log list. The wireframe is real, but
the body wasn't spec'd at detail-pass fidelity. Specifically open:

- Row-expand behavior (the `.md` says "click expands to show full
  `fields` JSON" — no expansion state was wireframed, the expand UX
  not designed, no per-tier dispatch decided).
- Phone-tier filter row (the 5-column desktop grid doesn't fit phone
  widths; the wireframe had no phone-tier expression).
- Subsystem chip-row scalability — wireframe showed `+3 more` as a
  symptom that the chip-row doesn't scale as the `LogSubsystem` union
  grows.
- Cross-tab arrived state (the `.md` says actionId chip arrives as
  an implicit filter; visual + interaction not designed).
- Tab count badge color rule and count source ambiguous.
- State persistence across tab switches not pinned.
- Stale prose in the wireframe's `no-story-pane` referencing
  pre-canonical tab names (`Pipeline runs`, `HTTP calls`).
- `hub-no-story` mode hides the entire body even when the active
  tab is app-global (Logs / Call log) — should only gate
  story-anchored tabs.

This pass produces detail-pass spec for Tab 4 + extracts the
`MultiSelect` pattern that three other diagnostics tabs (2, 3, 5)
will inherit.

## Scope decision: close-out + pattern extraction

Two paths considered at scope time:

- **Close-out scope** — describe Tab 4's Subsystem multi-select
  behavior in `diagnostics.md`, defer the primitive. Tab 3 / 5 would
  later converge on similar shapes and extract a pattern.
- **Pattern extraction now** — the Subsystem use case is the
  cleanest template (fixed enum, no search yet); extracting from it
  now produces a clean pattern, not one biased by Logs-specific
  quirks. Four diagnostics tabs (2 source, 3 source/state/status
  range, 4 subsystem, 5 source/target_table) all use multi-select
  filters — past the rule of three.

Chose pattern extraction. The new `patterns/multi-select.md` becomes
the canonical primitive doc; Tab 4 cites it as its first consumer.

## Decisions and rationale

### Filter row composes the Toolbar pattern

The existing filter row was a bespoke flex layout (`.filter-row`
with custom flex-wrap). Logs has all three Toolbar slots: a primary
input (Kind substring), filter chips (Level), and a chrome-cluster
secondary control (Subsystem). Mapping into the canonical Toolbar
pattern at [`patterns/toolbar.md`](../ui/patterns/toolbar.md)
inherits its cross-tier overflow rule (search on own row at narrow
tiers; chips + chrome wrap below) and the
[height contract](../ui/patterns/toolbar.md#height-contract--primary-input-vs-secondary-chrome-cluster)
(Kind at `md`, chips + MultiSelect at `xs`) for free. No bespoke
mobile layout needed; no per-component height drift.

Logs becomes a new Toolbar consumer. Its filter row at desktop:

```
Kind: [filter by kind………]   Level [warn][error][debug]   [Subsystem: 4 of 8 ▾]
```

### Subsystem becomes MultiSelect (new pattern)

The existing chip-row approach didn't scale: the wireframe already
showed `+3 more` as the symptom. Chip-rows work for small N visible
at a glance; the `LogSubsystem` union is open and grows
(`classifier`, `retrieval`, `provider`, `embedder`, `pipeline`, …,
plus future). The project's [Group C cardinality cascade](../ui/foundations/mobile/layout.md)
(Tab strip → Select substitution) is precedent: growing-N enums move
from chips/segments → dropdown.

Level stays as chips (3 fixed values, color-coded by severity,
frequent toggling). Subsystem moves to a dropdown multi-select.
Treating them differently is honest — different cardinality profiles
deserve different shapes.

The new MultiSelect primitive picks up the load. Its shape:

- **Trigger**: `<prefix>: <state> ▾`. State auto-computes from the
  selection (`all` / `none` / `N of M`). Trigger renders at `xs`
  height — slots into the Toolbar secondary chrome cluster
  height-uniform with chips.
- **Selection policy is consumer-driven**. The primitive doesn't
  decide whether `none` is a reachable state or whether `all` should
  visually de-emphasize; those are policy decisions for each
  consumer. Primitive stays policy-neutral.
- **Live-commit semantics**. Each checkbox toggle fires `onChange`
  immediately. Matches every other filter affordance in the project.
- **Opening surface**: Popover (desktop / tablet) / Sheet medium
  (phone), per the existing primitive mapping at
  [`foundations/mobile/layout.md`](../ui/foundations/mobile/layout.md).
- **Overlay header**: two text-link buttons, `[Select all]` and
  `[Clear all]`, disabled-when-moot (`Select all` disabled when all
  selected, `Clear all` disabled when none). Lowest-novelty, no
  Checkbox-primitive extension needed (master-checkbox-with-
  indeterminate was the alternative but required extending Checkbox
  to surface a third state).
- **Row content**: Checkbox + label, whole row tappable per the
  SwitchRow precedent at [`forms.md`](../ui/patterns/forms.md#switchrow-pattern).
  First real consumer of the Checkbox primitive — the
  [`forms.md → Checkbox`](../ui/patterns/forms.md#checkbox-primitive)
  "Speculative — no v1 wireframe consumer" tag graduates with this
  change.
- **Search**: opt-in via `searchable: true` prop. Deferred until
  the first consumer needs it (current 8-item Subsystem list doesn't).

### Row expand splits by tier

The `.md` said "click expands to show full `fields` JSON" without
deciding the mechanism. Decisions:

- **Tablet+ (`≥ tablet`)**: inline accordion expansion. Each log row
  is an `AccordionItem` per [`patterns/accordion.md`](../ui/patterns/accordion.md).
  Left chevron column (24px) rotates from -90° → 0° on expand
  (per the accordion chevron rule). **Single-open** semantics
  (`type="single"`) — log inspection is per-entry, not section-
  grouping comparison; the multi-open default doesn't fit. Density
  matters: dense list with potentially 200+ rows would have
  measurable accordion-mount cost if multi-open lets the user
  expand many at once.
- **Phone**: no inline expand. Row tap opens the
  [raw JSON viewer Sheet](../ui/patterns/data.md#raw-json-viewer--shared-modal-pattern)
  at the existing data.md surface — bottom-anchored tall Sheet. Sheet
  header: `Log fields · <kind> · <time>` disambiguates which entry
  is open.

The expanded body on tablet+ uses a pretty-printed JSON block +
Copy icon-action at top-right. Same content shape as the raw JSON
viewer Sheet body, minus the drawer chrome (no `Raw JSON · <name>`
header inline). Promotes the inline-use variant as a named shape
within `data.md` — see [Integration](#integration-plan).

### Phone-tier row layout: two-line

Desktop 5-column grid + 24px chevron doesn't fit phone widths
(360-430px usable). Options considered:

- **Single-line truncated kind** — densest but truncates the most
  identifying field. Loses scanability.
- **Two-line** (time/level/actionId top, kind bottom) — kind always
  fully visible. ~72px per row, ~9 entries per phone viewport.
- **Stacked** (each field its own line) — most legible per row but
  ~85-90px each, ~6 entries per viewport. Overkill for scanning.

Chose two-line. Kind is the most-identifying field for what
happened; not truncating it costs vertical density but preserves
scanability. Phone is a fallback inspection surface anyway
(power-user diagnostics work happens on tablet+); the ~72px tradeoff
is acceptable.

No chevron on phone (whole row tappable; tap opens the JSON viewer
Sheet).

### Cross-tab arrived state

The `.md` committed to a deep-link `actionId` route param + auto-
focus on the appropriate row. Visual + interaction not designed.

**Arrival shapes** (two coexisting):

| Route param shape                                                                             | Behavior                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionId=X, focusEntryId=Y` (specific entry click from per-turn inspector)                   | Apply actionId filter. Nudge other filters minimally so entry Y is visible. Auto-scroll to Y; auto-expand it (single-open accordion).       |
| `actionId=X` only (broad nav: per-turn inspector overall, or Call log actionId chip — future) | Apply actionId filter. User's other filters preserved as-is — no specific entry to nudge for. If intersection is empty: inline empty-state. |

**Nudge rule splits by filter type**:

- Multi-select chips (Level, Subsystem): ADD focus entry's value to
  the selection if missing. Always additive, never removes.
- Free-text Kind input: does NOT auto-clear. If Kind would hide the
  focus entry, fall through to empty-state with `[Clear Kind]`
  button. Reasoning: clearing user-typed text is destructive —
  preserve their work, let them choose to clear.

**Visual**: a Tag chip (per [`patterns/chips.md → Tag`](../ui/patterns/chips.md#tag--pill-labeled-content))
appended to the secondary chrome cluster, accent-toned:
`Turn: tr_a3kf ×`. Uses the user-facing term "Turn" (per the hub
doc's tab table which anchors on "Story + turn"); the schema's
`actionId` term stays internal.

Tap × on the chip removes the actionId filter. Nudged-in filter
values stay (the user's filter state is their own once they're in
Logs; "undo the navigation arrival" wasn't worth the state-machine
complexity).

**Silent nudge** for v1. The Tag chip's presence is the explicit
indicator that filter state has been modified by the route. Toast
on every nudge would create noise on repeated cross-tab navigation;
inline notice with undo is heavier than needed. The visual-pulse
refinement (1-1.5s tint on the nudged chips) was considered but
ruled marginal — parked as a followup conditional on real-world
feedback.

Tag chip placement on phone-tier wrap-flow is positionally flexible
— accent tone provides the visual disambiguation, not spatial
pinning.

### Tab count badge: unfiltered count, max-severity color

Two semantically distinct decisions baked into the badge:

- **Count source**: unfiltered total of the in-memory buffer.
  Always rendered (even when 0 — that's informative too). Decouples
  the badge from the user's filter state; the badge is a buffer-level
  indicator, not a view indicator. User filtering to debug-only sees
  the filtered list but the badge reflects "30 things happened
  total; you're looking at 5 of them."
- **Color rule**: matches the chip color of the highest severity
  level present in the buffer. `error` > `warn` > `debug` (neutral).
  Empty buffer → neutral, count 0. Shares the severity-to-color
  palette with the Level chips (single source of truth for severity
  tones).

The wireframe's existing `warn-count` class — which made the badge
always warn-toned for Logs — was an unprincipled "Logs is special"
claim. The max-severity rule replaces it with content-driven color:
the badge tells the user "the worst thing in your buffer is at
level X." Honest, and naturally extends to Tab 3 (Call log: error
if any 5xx, warn if any 4xx) and Tab 2 (per-turn inspector: outcome
`failed > aborted > completed`). Tab 5 (Delta log) has no severity
dimension; stays neutral.

### State persistence: as long as master is on

The `.md` said "persists across tab switches within a hub session;
clears on master toggle-off." Refined: **persists as long as master
is on; clears on master toggle-off**. Closing the hub via back-arrow
doesn't end the "session" — the in-memory ring buffer survives hub
close (only master-off wipes it). Filter + expand state shares the
same lifecycle.

### Empty state — three flavors, not one

The empty pane in the wireframe had a single buffer-empty copy. The
tab has three distinct empty conditions:

- **Buffer empty** (master on, no logs captured yet): "No log
  entries captured yet — trigger a turn or wait for a background
  event to populate the log." (Existing wireframe copy.)
- **Filters hide all, no actionId**: "No entries match your filters
  · `[Clear filters]`."
- **Filters hide all, actionId arrival** (the broad-nav arrival
  shape): "No entries match your filters for Turn `tr_a3kf` ·
  `[Clear other filters]` `[Clear actionId]`."

All three render in the same area below the filter row; the active
copy selects on state.

### `hub-no-story` shouldn't gate app-global tabs

The wireframe's `body[data-mode="hub-no-story"] .body-wrap
{ display: none; }` is too broad. App-global tabs (Logs, Call log)
should render regardless of story selection. The `hub-no-story`
empty pane fires only when a story-anchored tab is active without
a story picked. Fix: gating becomes per-tab — story-anchored tabs
suppress their body and show the "Pick a story" pane; app-global
tabs render normally.

Also fixes the `no-story-pane` text drift: `Pipeline runs` →
`Per-turn inspector`, `HTTP calls` → `Call log`, and surface the
full story-anchored set (`Memory probe, Per-turn inspector, Delta
log`).

### Phone-tier chrome for Logs

The hub-level mobile-expression paragraph doesn't pin what happens
to the story selector when an app-global tab is active. Decision:
on phone with Logs (or Call log) active, both story selector and
branch picker hide entirely. Saves ~32px of phone chrome; the
app-global tabs don't care about story selection so showing them is
misleading chrome.

## Implementation notes for the eventual scaffolder

Not design decisions, but worth surfacing for whoever implements:

- **Log list needs virtualization** per [`patterns/lists.md`](../ui/patterns/lists.md)
  — buffer can grow to hundreds of entries during heavy inspection.
- **Single-open accordion state must live in a controlled
  `openItemId` ref** on the tab body (not per-AccordionItem state).
  Virtualized scroll unmounts off-screen rows; per-item state would
  lose expansion when the user scrolls out and back. Controlled
  state from above survives the unmount.
- **Cross-tab nav routing** uses the shared `actionId` deep-link
  param; the `focusEntryId` param is an additional optional
  parameter for the auto-focus arrival shape.
- **Filter state** is JS-side hub state; not persisted across
  app restarts. Lives in the same store as the in-memory ring
  buffers per the [observability contract](../observability.md).

## What this defers

- **Tabs 2, 3, 5 detail passes.** Tab 4 is the close-out; the
  parent followup narrows to tabs 2, 3, 5. Each gets its own pass.
- **MultiSelect `searchable: true`**. Parked until consumer demand:
  re-evaluate when the `LogSubsystem` union exceeds ~15 entries, or
  when a downstream MultiSelect consumer has a large enum. Parked
  in [`parked.md`](../parked.md).
- **Visual-pulse on nudged chips**. Parked as a refinement
  conditional on real-world feedback that the silent nudge is
  confusing. Parked in [`parked.md`](../parked.md).
- **Tab 4 in its own subdirectory** (`screens/diagnostics/logs/`).
  Not load-bearing for this close-out — Tab 4 stays as a sub-section
  in `diagnostics.md`. If later tab detail passes find the cross-doc
  reference structurally awkward, relocation can happen with `git mv`
  - anchor sweeps (consistent with the open
    ["Memory probe tab relocation"](../ui/screens/diagnostics/diagnostics.md#screen-specific-open-questions)
    question at the foot of the diagnostics doc).

## Integration plan

Per [`conventions.md → Exploration records`](../conventions.md#exploration-records),
the integration narrative lives in the commit message; this section
catalogues what changes.

**Canonical doc edits:**

- [`docs/ui/patterns/multi-select.md`](../ui/patterns/multi-select.md)
  — new file. Full primitive spec: trigger, overlay, header
  affordances, content rows, opening-surface dispatch, the
  policy-neutral selection contract, `searchable` opt-in, Used-by
  list (Logs Subsystem).
- [`docs/ui/screens/diagnostics/diagnostics.md`](../ui/screens/diagnostics/diagnostics.md)
  — Tab 4 section rewritten from sketch-level to detail-level:
  filter row composition (Toolbar pattern + MultiSelect), row-
  expand split by tier (accordion tablet+, JSON viewer Sheet
  phone), phone-tier row layout (two-line), cross-tab arrived
  state (nudge rule + Tag chip + empty states), badge spec
  (unfiltered count + max-severity color), state persistence rule,
  hub-no-story behavior for app-global tabs, phone-tier chrome
  rule. Plus the "Screen-specific open questions" Tab 4 entries
  resolved.
- [`docs/ui/screens/diagnostics/diagnostics.html`](../ui/screens/diagnostics/diagnostics.html)
  — wireframe updates: Toolbar-pattern filter row (Kind / Level
  chips / Subsystem multi-select trigger); expanded-row state
  with JSONBlock; cross-tab arrived state with Tag chip; phone-
  tier two-line row layout; phone-tier filter row with Toolbar
  overflow; fixed `no-story-pane` copy + per-tab gating; new
  empty-state modes (filter-hides-all, arrived-with-filter-
  conflict).
- [`docs/ui/patterns/data.md`](../ui/patterns/data.md) — add a
  named JSONBlock inline-use note to the Raw JSON viewer section.
  The drawer / Sheet body content (`<pre>` + Copy button) is the
  reusable shape; the drawer chrome is the wrapping layer.
- [`docs/ui/patterns/forms.md → Checkbox`](../ui/patterns/forms.md#checkbox-primitive)
  — graduate from speculative. Drop the "Speculative — no v1
  wireframe consumer" warning. Point to MultiSelect as the first
  consumer.
- [`docs/ui/patterns/toolbar.md → Used by`](../ui/patterns/toolbar.md)
  — add Diagnostics Logs filter row.
- [`docs/ui/patterns/accordion.md → Used by`](../ui/patterns/accordion.md)
  — add Diagnostics Logs row-expand (tablet+ only).
- [`docs/ui/patterns/chips.md → Used by`](../ui/patterns/chips.md)
  — add Diagnostics Logs Turn Tag chip (as a Tag, not a Chip).
- [`docs/followups.md`](../followups.md) — narrow the
  "Diagnostics hub — per-tab body design passes" entry from
  "tabs 2-5" to "tabs 2, 3, 5" (Tab 4 done).
- [`docs/parked.md`](../parked.md) — two new entries:
  `MultiSelect — searchable opt-in` (parked-until-signal), and
  `Cross-tab arrived state — visual-pulse refinement on nudged
chips` (parked-until-signal).

**No renames in this diff.** Heading slugs in `diagnostics.md` may
re-anchor as the Tab 4 section grows, but no headings rename — new
subsections add under the existing `### Tab 4 — Logs` heading.

**Repeated prose check.** The MultiSelect spec lives only in
`patterns/multi-select.md`; `diagnostics.md` cites the pattern
rather than restating its contract. Empty-state copies are
specific to Logs and don't duplicate other surfaces. No intentional
prose duplication.

**Followups in/out**:

- Resolved: nothing fully resolved (Tab 4 is part of the per-tab
  passes followup, which narrows but doesn't go away).
- Added: two parked entries above.
