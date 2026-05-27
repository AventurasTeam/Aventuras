# Diagnostics Hub

Power-user / dev surface for inspecting what the AI pipeline did.
Tabbed page hosting the family of observability surfaces designed
around the contracts in
[`docs/observability.md`](../../../observability.md).

Gated by `app_settings.diagnostics.enabled` (master toggle). When
off, the hub entry is absent from the
[Actions menu](../../principles.md#top-bar-design-rule) — the
toggle itself is the discovery point.

Surface inventory plus Tabs 3, 4, 5 detail. **Per-tab body design
for Tab 2 lands in its own detail pass** when it's built; this
doc names the structural pieces (top-bar, tab strip, story-anchor
selector, cross-tab nav, empty states, mobile expression) plus the
full body spec for Tabs 3, 4, and 5 below.

## Top-bar

App-level chrome `[←] [Diagnostics] [⚲]`. No status pill, no
chapter chip, no story chrome — even when a tab body pivots into
per-story content. Tab body owns its own story context.

Hub entry point lives in the **Actions (⚲) menu** as
`Open Diagnostics Hub`, visible only when the master toggle is on.

## Story selector

Three of the five tabs are story-anchored. The hub renders a
**story selector strip** below the top-bar:

```
Story  [The Tower of Aria ▾]   Branch  [main ▾]
```

Single source of truth for "which story are we inspecting"; the
three story-anchored tabs subscribe to it. App-global tabs ignore
the selector.

When the user opens the hub from an in-story context, the
selector pre-fills with the current story + branch. When opened
from out-of-story chrome (App Settings, Story List), the selector
prompts a pick before the story-anchored tabs render content
(story-anchored tabs show an inline "Pick a story" empty state
until a selection is made).

Detail (selector mobile expression, switch confirmation when
unsaved diagnostic UI state exists, etc.) for the per-tab detail
passes.

## Tab strip

Five tabs, in order:

| #   | Tab                | Anchor                | Source                       | Status                                                         |
| --- | ------------------ | --------------------- | ---------------------------- | -------------------------------------------------------------- |
| 1   | Memory probe       | Story                 | `probe_captures` (persisted) | Existing — see [memory probe](../memory-probe/memory-probe.md) |
| 2   | Per-turn inspector | Story + turn          | `turnCaptures` (in-memory)   | New — detail pass forthcoming                                  |
| 3   | Call log           | App-global            | `httpCalls` (in-memory)      | New — detail pass forthcoming                                  |
| 4   | Logs               | App-global            | `logEntries` (in-memory)     | New — detail pass forthcoming                                  |
| 5   | Delta log          | Story (branch-scoped) | `deltas` (persisted)         | New — detail pass forthcoming                                  |

Tab strip renders via the
[Tabs primitive](../../patterns/tabs.md); optional per-tab count
badges render to the right of each label. Per-tab rules:

- Tab 3 (Call log): unfiltered buffer count, max severity color
  (5xx/transport-failed → danger, 4xx → warn, else neutral).
- Tab 4 (Logs): unfiltered buffer count, max severity color
  (error → danger, warn → warn, debug-only → neutral).
- Tab 5 (Delta log): scope-respecting count (branch-toggle aware),
  neutral color (no severity dimension on `deltas`).
- Tab 2 (Per-turn inspector): pins its own at its detail pass.

### Tab 1 — Memory probe

Existing tab content per
[`memory-probe.md`](../memory-probe/memory-probe.md). The hub doc
references rather than relocates the existing screen — keeps the
memory-probe design integrity intact. Tab anchored to the story
selector.

### Tab 2 — Per-turn inspector

Story + turn-anchored. Sources `turnCaptures` slice. Two-pane:

- **List pane** — recent turns, reverse-chronological by
  `startedAt`. Branch filter inherits from the story selector.
  Rows colored by outcome (`completed | aborted | failed`).
- **Detail pane** — selected turn's phase timeline + classifier
  raw output (JSON viewer per
  [`patterns/data.md`](../../patterns/data.md)) + cross-cut rows
  pulled from `httpCalls` and `logEntries` filtered by the
  turn's `actionId`.

Cross-tab nav: row-click on a referenced HTTP call → opens Call
log tab focused on that row; row-click on a log entry → opens
Logs tab focused on that entry. Both navigations preserve the
selected turn so the back-affordance returns intact.

Full detail (column choices, time-axis scale on the phase
timeline, copy-to-clipboard affordances, expand/collapse state on
the classifier JSON tree, edit-restrictions interaction during
in-flight generation) lands in this tab's detail pass.

### Tab 3 — Call log

App-global. Sources `httpCalls` slice. Single-list view,
reverse-chronological by `startedAt`.

#### Row shape — desktop and tablet (Call log)

Six-column grid: chevron, time, method, URL, status slot,
duration, actionId chip.

```
[▸] 14:02:18  POST  api.anthropic.com/v1/messages              [○]      ——        tr_a3kf
[▾] 14:02:17  POST  api.anthropic.com/v1/messages              [200]    1.84s     tr_a3kf
[▸] 14:02:16  POST  api.anthropic.com/v1/messages              [503]    12.3s     tr_a3kf
[▸] 14:01:58  POST  api.anthropic.com/v1/messages              [ERR]    8.42s     tr_92mp
```

Visual treatment:

- **Chevron** — left edge, 24px column. Rotates -90° collapsed →
  0° expanded per [`patterns/accordion.md → Chevron direction`](../../patterns/accordion.md#chevron-direction).
- **Time** — `ui-monospace`, `--fg-muted`, formatted `HH:MM:SS`.
- **Method** — short label (`GET`, `POST`, `PUT`, etc.),
  monospace, ~50px column.
- **URL** — host + path. `ui-monospace`, truncates with ellipsis
  at column width. Auth path segments unchanged (redaction
  applies to header values only, not URL).
- **Status slot** — focal state-aware visual. See
  [Row state-aware visual](#row-state-aware-visual-tab-3) below.
- **Duration** — `1.84s` or `——` for in-flight. Right-aligned.
- **ActionId chip** — same treatment as Tab 4: labeled box with
  `--info` tone when present, dashed-border placeholder when
  empty.

Whole row is the [accordion trigger](../../patterns/accordion.md);
ActionId chip is a distinct nested tap target.

#### Row state-aware visual (Tab 3)

The status slot adapts per `state`:

- **In-flight** — `[○]` pulsing dot, neutral tone. ~14-16px,
  1.5s ease-in-out opacity (0.4 → 1 → 0.4) + subtle scale
  (1 → 1.05 → 1). Replaces the chip slot during in-flight; same
  position, different visual. Duration column shows `——`.
- **Completed** — solid chip with specific status code (`200`,
  `404`, `503` — not the bucket label). Tone keyed to bucket:
  `2xx` success, `3xx` info, `4xx` warn, `5xx` danger.
- **Failed (transport)** — `[ERR]` chip, danger tone. No status
  code (fetch threw before response).

**Transition**: in-flight → completed/failed = ~200ms crossfade
in the status slot. Dot fades out, chip fades in. Duration
populates simultaneously. Row position stable (reverse-chrono by
`startedAt`); identity is ULID-keyed per the
[Row identity stability](#row-identity-stability-call-log)
contract below. No list re-sort, no React-key churn.

##### Row identity stability (Call log)

Per-row state (expand, hover) is keyed on the call's ULID, not
on its rendering state. Filter predicates evaluate against the
live row's current state (not a snapshot) — a completing
in-flight call doesn't pop in/out of a State-filtered view; it
just updates which predicate matches.

#### Row expansion — tablet+ (Call log)

Single-open accordion. Expanded body renders a
[`JSONBlock`](../../patterns/data.md#json-content-block--inline-use)
that adapts per state:

- **In-flight**: request section only (method, URL, headers with
  redaction, request body). Response section reads `Waiting for
response…` muted line.
- **Completed**: request section + `─── Response ───` divider +
  response section (status, response headers with redaction,
  duration, response body).
- **Failed**: request section + `─── Error ───` divider + error
  section (error message, error kind like `NetworkError` /
  `TimeoutError`, any partial response chunks if captured).

Expand state survives the in-flight → resolved transition per
the stable-identity contract: if the user expanded while
in-flight, response/error data appears inline on resolution
without collapsing.

##### Header redaction

Redacted headers per [`observability.md → Header redaction`](../../../observability.md#header-redaction)
render their literal mask value `'***'` in the JSONBlock. No
special chrome on the redacted line — `'***'` is the signal. No
inline disclaimer, no banner.

#### Row shape — phone (Call log)

Two-line shape, no chevron. Whole row tappable; tap opens the
[Raw JSON viewer Sheet](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
(bottom, tall ~95%). Sheet content adapts per state same as the
tablet+ inline body.

```
14:02:18  POST  [200]   1.84s   tr_a3kf
api.anthropic.com/v1/messages
─────────────────────────────────────────────
14:02:17  POST  [○]     ——      tr_a3kf
api.anthropic.com/v1/messages
```

Top line: time, method, status slot, duration, actionId chip.
Bottom line: URL (full, no truncate).

Sheet header for the opened entry: `HTTP · <method> · <URL host>
· <time>` (e.g., `HTTP · POST · api.anthropic.com · 14:02:17`).

#### Filters (Call log)

Four dimensions composing the [Toolbar pattern](../../patterns/toolbar.md):

- **URL/body** (free-text) — `Toolbar.Search` slot. Substring
  match against URL string + request body content.
- **State** (multi-select chips: `in-flight`, `completed`,
  `failed`) — fills `Toolbar.FilterChips`. Each chip uses the
  severity-coded [Chip primitive](../../patterns/chips.md):
  in-flight neutral, completed success, failed danger. Three
  fixed values → chips by the Tab 4 precedent.
- **Source** ([MultiSelect](../../patterns/multi-select.md)) —
  provider/embedder/etc. enum. Could grow (multiple providers +
  embedders ship). MultiSelect.
- **Status range** (MultiSelect) — five fixed buckets `1xx / 2xx /
3xx / 4xx / 5xx`. Five is at the chip boundary; chose
  MultiSelect to keep the chrome cluster manageable on phone.
  Inside the overlay, each row carries a small leading
  severity-color dot so the bucket-tone is visible when the
  overlay is open.

Desktop (≥ 1024px) renders as one horizontal row:

```
URL: [filter URL or body………]   State [in-flight][completed][failed]   [Source: 3 of 8 ▾]   [Status: 4 of 5 ▾]
```

Phone / narrow tablet (< 1024px) follows the
[Toolbar cross-tier overflow rule](../../patterns/toolbar.md#cross-tier-overflow-rule).

**No min-selection enforcement**: Source / State / Status filters
allow 0 selected. User toggling to clear-all-then-pick-one is a
normal mid-interaction state. Empty visible set → filters-hide-all
empty state fires naturally.

#### Cross-tab nav (Call log)

Outbound: actionId chip on a row → per-turn inspector for that
turn (when actionId present and turn capture is still in ring
buffer).

Inbound from per-turn inspector clicking a specific HTTP call:
`actionId=X, focusEntryId=Y_callId` arrival. Nudges per the
[Tab 4 nudge substrate](#nudge-rule):

- Multi-select chips and dropdowns (State, Source, Status) ADD
  the focus call's values to the selection if missing.
- URL/body free-text does NOT auto-clear. If it would hide the
  focus call, fall through to the empty-state with `[Clear URL]`
  button.

Auto-scroll + auto-expand the focused call. Turn Tag chip
appended to the filter row's secondary cluster.

Inbound broad (`actionId=X` only): apply filter, preserve other
filters, empty-state with clear-buttons if intersection is empty.

#### Count badge (Call log)

Unfiltered `httpCalls` buffer total, always rendered. Color by
max severity present:

- Any failed (transport) OR any completed 5xx → danger.
- Any completed 4xx → warn.
- Else (in-flight, completed 2xx/3xx only) → neutral.

Decoupled from filter state — same rule as Tab 4 with the
severity ladder mapped to HTTP outcome instead of log level.

#### Empty states (Call log)

Three flavors, mirroring Tab 4:

- **Buffer empty** (master on, no calls captured yet): "No HTTP
  calls captured yet — trigger a turn or wait for a background
  call."
- **Filters hide all, no actionId**: "No calls match your filters
  · `[Clear filters]`."
- **Filters hide all, actionId arrival**: "No calls match your
  filters for Turn `tr_a3kf` · `[Clear other filters]`
  `[Clear actionId]`."

#### State persistence (Call log)

Same as Tab 4: filter + expand state persist as long as master
is on; clear on master toggle-off.

#### Mobile expression (Call log)

Call log is app-global. On phone with Call log active, both
story selector and branch picker hide entirely (same rule as
Tab 4). Filter row follows the
[Toolbar cross-tier overflow rule](../../patterns/toolbar.md#cross-tier-overflow-rule).
Tab strip falls back to Select per the Group C cardinality
cascade.

#### Implementation notes (Call log)

- **Stable ULID-keyed identity** across the in-flight →
  completed/failed transition. Filter predicates evaluate live
  state per render, not snapshot.
- **Pulse animation**: web via CSS keyframes; native via
  Reanimated `withRepeat(withTiming(...))`. ~1.5s loop.
- **Crossfade transition**: simple opacity ease ~200ms on the
  status slot when state field updates.
- **Virtualization** per [`patterns/lists.md`](../../patterns/lists.md)
  for the call list; controlled `openItemId` ref for the
  single-open accordion state.
- **Header redaction** is sink-side per
  [`observability.md`](../../../observability.md#header-redaction);
  this surface just renders what it receives.

### Tab 4 — Logs

App-global. Sources `logEntries` slice. Single-list,
reverse-chronological by `emittedAt`.

#### Row shape — desktop and tablet

Six-column grid: chevron, time, level, kind, fields-preview,
actionId chip.

```
[▸] 14:02:18  warn  classifier.delta_clamped  { originalDelta: -1800, … }  tr_a3kf
[▾] 14:02:17  warn  provider.retry_succeeded  { attempt: 2, latencyMs: 1840 }  tr_a3kf
    └─ expanded JSON block (see below)
[▸] 14:02:16  error retrieval.knn_error       { reason: "vec0_index_corrupt", … }  tr_a3kf
```

Visual treatment:

- **Chevron** — left edge, 24px column. Rotates -90° collapsed →
  0° expanded per [`patterns/accordion.md → Chevron direction`](../../patterns/accordion.md#chevron-direction).
- **Time** — `ui-monospace`, `--fg-muted`, formatted `HH:MM:SS`.
- **Level** — uppercase short tag (`WARN`, `ERROR`, `DEBUG`), tone
  per severity. `warn` → `--warn`; `error` → `--danger`; `debug` →
  neutral.
- **Kind** — `ui-monospace`. Sub-namespace prefix (`classifier.`)
  renders muted; suffix (`delta_clamped`) renders at `--fg-primary`.
  Conveys the namespace/event split visually.
- **Fields preview** — `ui-monospace`, `--fg-muted`, truncates
  with ellipsis at column width.
- **ActionId chip** — labeled box, `--info` toned when present,
  `—` placeholder dashed-border when empty. Tap behavior: see
  [Cross-tab nav](#cross-tab-nav-logs).

Whole row is the [accordion trigger](../../patterns/accordion.md) —
tap anywhere on the row toggles expansion. ActionId chip is a
distinct tap target nested inside the row (per the
[SwitchRow tap-plumbing convention](../../patterns/forms.md#switchrow-pattern):
inner target takes its own tap, doesn't bubble to the row).

#### Row expansion — tablet+

Single-open accordion (`type="single"`). Opening a row collapses
any previously expanded row. Reasoning: log inspection is
per-entry; multi-open creates dense vertical noise on a list that
may carry hundreds of rows.

Expanded body renders a `JSONBlock` containing the full `fields`
JSON:

```
┌────────────────────────────────────────────────────┐
│ [▾] 14:02:17  warn  …                              │
├────────────────────────────────────────────────────┤
│                                          [📋 Copy] │
│ {                                                  │
│   "attempt": 2,                                    │
│   "latencyMs": 1840,                               │
│   "status": 200,                                   │
│   "source": "provider:anthropic-main"              │
│ }                                                  │
└────────────────────────────────────────────────────┘
```

Pretty-printed JSON, monospace, full-width within the row. Copy
icon-action at top-right. Reuses the
[Raw JSON viewer body content shape](../../patterns/data.md#json-content-block--inline-use)
(JSONBlock) — the inline use is the same content as the Sheet body,
sans drawer chrome.

**Empty fields case**: row still expandable; body renders `{}`
plus a muted line "No fields recorded for this entry." No special
row treatment.

#### Row shape — phone

Two-line row, no chevron. Whole row tappable; tap opens the
[Raw JSON viewer Sheet](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
(bottom, tall ~95%).

```
14:02:18  warn                                       tr_a3kf
classifier.delta_clamped
─────────────────────────────────────────────────────────────
14:02:17  warn                                       tr_a3kf
provider.retry_succeeded
```

Top line: time, level, actionId chip (right-aligned). Bottom line:
kind (full, no truncation). Fields preview is dropped on phone —
users tap to see the full payload in the Sheet, not a teaser in
the row.

Sheet header for the opened entry: `Log fields · <kind> · <time>`
(e.g., `Log fields · classifier.delta_clamped · 14:02:17`).
Disambiguates which entry the Sheet is for.

#### Filters — Toolbar composition

The filter row composes the [Toolbar pattern](../../patterns/toolbar.md).
Three filter dimensions slot in:

- **Kind** (free-text substring match against `kind`) — fills the
  `Toolbar.Search` slot. Primary input at `md` height.
- **Level** (multi-select chips: `warn`, `error`, `debug`) —
  fills `Toolbar.FilterChips`. Each chip uses the severity-coded
  [Chip primitive](../../patterns/chips.md) — warn-tone, danger-tone,
  neutral respectively. `debug` chip listed only when
  `debug_level_enabled` is on.
- **Subsystem** (multi-select against the
  [`LogSubsystem` union](../../../observability.md#kind-namespace)) —
  renders as a [MultiSelect](../../patterns/multi-select.md) trigger
  (`Subsystem: 4 of 8 ▾`) in the secondary chrome cluster. Replaces
  the chip-row treatment from the prior surface inventory: as the
  union grows, the trigger stays constant-width, the overlay
  scrolls.

Desktop (≥ 1024px) renders as one horizontal row:

```
Kind: [filter by kind………]   Level [warn][error][debug]   [Subsystem: 4 of 8 ▾]
```

Phone / narrow tablet (< 1024px) follows Toolbar's cross-tier
overflow rule: Kind on its own row at `md`, Level chips + Subsystem
trigger wrap below at `xs`.

#### Cross-tab nav (Logs)

Two arrival shapes coexist via the shared `actionId` deep-link
param:

| Route                                                                                         | Behavior                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actionId=X, focusEntryId=Y` (specific log entry clicked from per-turn inspector)             | Apply actionId filter. Nudge other filters to make Y visible (see [Nudge rule](#nudge-rule)). Auto-scroll to Y; auto-expand the row.                       |
| `actionId=X` only (broad nav: per-turn inspector overall actionId, or Call log actionId chip) | Apply actionId filter. User's other filters preserved as-is. If intersection is empty: arrived-empty empty-state (see [Empty states](#empty-states-logs)). |

##### Nudge rule

When `focusEntryId` is provided and existing filters would hide
the entry, nudge filters minimally to make the entry visible.
Splits by filter type:

- **Multi-select chips and dropdowns (Level, Subsystem)**: ADD the
  focus entry's value to the selected set if missing. Always
  additive — never removes from the selection.
- **Free-text Kind input**: does NOT auto-clear. If Kind would
  hide the focus entry, fall through to the
  [Filters-hide-with-Kind empty-state](#empty-states-logs) — user
  decides whether to drop their typed value.

Nudge is silent. The Turn Tag chip's presence (see below) is the
explicit signal that filter state was modified by the route. Toast
on every nudge would create noise on repeated nav; the chip is
enough.

##### Turn Tag chip

A [Tag](../../patterns/chips.md#tag--pill-labeled-content), accent-
toned, appended to the secondary chrome cluster of the filter row:

```
… Level [warn][error][debug]   [Subsystem: 4 of 8 ▾]   [Turn: tr_a3kf ×]
```

Uses the user-facing term "Turn" — the schema's internal `actionId`
maps to the hub's "Story + turn" anchor in the tab table.

Tap × removes the actionId filter. Nudged-in filter values stay
(the user's filter state is theirs once they're in Logs). No
"undo the nav arrival" behavior — explicit toggling is the floor.

Tag chip position on phone-tier wrap-flow is positionally flexible
— accent tone provides the visual disambiguation, not spatial
pinning.

##### Outbound nav

Tap the actionId chip on a Log row → open per-turn inspector
focused on that turn (per the cross-tab nav substrate).

#### Count badge (Logs)

Two semantically distinct decisions:

- **Count source**: unfiltered total of the in-memory `logEntries`
  buffer. Always rendered, even when 0. Decouples the badge from
  filter state — the badge is a buffer-level indicator. User
  filtering narrowly sees the filtered list, but the badge tells
  them how many entries are in the buffer overall.
- **Color rule**: matches the chip color of the highest severity
  level present in the buffer. `error` > `warn` > `debug` (neutral).
  Empty buffer → neutral, count 0. Shares the severity-to-color
  palette with the Level filter chips.

When the buffer has any `error` entries the badge is danger-toned
even if the user is filtered to debug-only — informing them that a
high-severity entry exists but is currently hidden by filters.

#### Empty states (Logs)

Three flavors:

- **Buffer empty** (master on, no logs captured yet): "No log
  entries captured yet — trigger a turn or wait for a background
  event to populate the log."
- **Filters hide all, no actionId**: "No entries match your filters
  · `[Clear filters]`."
- **Filters hide all, actionId arrival**: "No entries match your
  filters for Turn `tr_a3kf` · `[Clear other filters]`
  `[Clear actionId]`."

The last two render below the filter row, replacing the log list
area. `Clear filters` resets Level / Subsystem / Kind to their
defaults; `Clear actionId` removes the Turn Tag chip; `Clear other
filters` preserves the Turn chip while resetting the others.

#### State persistence

Filter state + single-open expand state **persist as long as
master is on**. Closing the hub via back-arrow preserves state;
reopening finds it intact. State clears on master toggle-off
(consistent with the in-memory ring-buffer wipe semantics from
[`observability.md → Wipe semantics`](../../../observability.md#wipe-semantics)).

#### Mobile expression (Logs)

Logs is app-global. On phone with Logs active, both the story
selector and branch picker hide entirely — Logs doesn't care about
story selection, and showing them would be misleading chrome.
Saves ~32px of phone chrome.

Filter row follows the [Toolbar cross-tier overflow rule](../../patterns/toolbar.md#cross-tier-overflow-rule)
(Kind own row, Level chips + Subsystem trigger wrap below). Row
layout follows the [phone two-line shape](#row-shape--phone). Tab
strip renders via the [Tabs primitive's](../../patterns/tabs.md)
phone substitution to Select at narrow tiers.

#### Implementation notes (Logs)

Not design decisions, but worth surfacing for the eventual
scaffolder:

- **Log list needs virtualization** per [`patterns/lists.md`](../../patterns/lists.md)
  — buffer can grow to hundreds of entries during heavy inspection.
- **Single-open accordion state lives in a controlled `openItemId`
  ref on the tab body**, not per-AccordionItem state. Virtualized
  scroll unmounts off-screen rows; per-item state would lose
  expansion when the user scrolls out and back. Controlled state
  from above survives the unmount.
- **Cross-tab nav routing** uses the shared `actionId` deep-link
  param; `focusEntryId` is an additional optional parameter that
  drives the auto-focus + auto-expand arrival shape.

### Tab 5 — Delta log

Story-anchored. Branch-scoped by default (inherits the story
selector's branch), with a scope-override toggle to expand to
all branches in the story. Sources the canonical `deltas` table
(persisted by design — see
[`data-model.md → Entry mutability & rollback`](../../../data-model.md#entry-mutability--rollback)).

#### Row shape — unscoped DeltaLogRow variant

Reuses the [DeltaLogRow pattern](../../patterns/delta-log-row.md)
as-is. Same primitive World and Plot per-entity History tabs
use; Tab 5 is the **unscoped-across-rows** consumer
(every delta in the story, not one entity's lineage). The host
prefixes `targetDisplayName` with table type to disambiguate
across kinds:

- `Entity · Kael`
- `Thread · Iron Pact`
- `Happening · The Bridge Collapse`
- `Lore · The Iron Pact (religion)`
- `Translation · entry #47 (es)`

Per [`delta-log-row.md → Target line`](../../patterns/delta-log-row.md):
"the host can supply 'Entity · Kael' or 'Thread · Iron Pact'
prefixed strings." Tab 5 is the first consumer adopting this
variant.

Diff cache pending fallback is built into the pattern's
`summary: string` contract: cache miss → host produces a
keys-only summary (e.g., `Modified traits, drives`); cache
populate → host upgrades to rich prose (e.g.,
`Added "former soldier"; was ["brave", "loyal"]`). Tab 5 inherits
this without local additions.

#### Row tap behavior

Tab 5 rows have two distinct tap targets:

- **Row body** → opens the [Raw JSON viewer Sheet](../../patterns/data.md#raw-json-viewer--shared-modal-pattern)
  showing the `undo_payload` JSON. Sheet header:
  `Delta · <op> · <target> · <time>` (e.g.,
  `Delta · update · Entity · Kael · 2h ago`).
- **ActionId chip** → cross-tab nav to per-turn inspector when
  present AND turn capture is still in ring buffer. When the
  turn has aged out: chip is informational only — tap shows
  `this turn's diagnostic data has aged out — only its deltas
remain` as a muted tooltip (desktop) / inline toast (phone).

**No inline accordion expansion.** Tab 5 rows are already
3-line (op badge + target line + summary + meta). Stacking a
tall expanded body below would dominate the list; the Sheet
overlay is the right surface for the full `undo_payload`. The
previously-deferred [DeltaLogRow inline-diff-expansion](../../patterns/delta-log-row.md#what-this-design-defers)
followup stays deferred.

**Divergence from World/Plot tap behavior.** World/Plot wire
DeltaLogRow's `onPress` to "open in target detail pane" (exits
to the entity/lore/thread/happening home surface). Tab 5 wires
it to "open Raw JSON viewer Sheet" (stays in hub for
inspection). Per the [pattern doc's host-wired contract](../../patterns/delta-log-row.md#click-behavior),
divergence is allowed; the implementer wires `onPress` to open
the Sheet here. Cross-hub-out "navigate to target detail pane"
is parked-until-signal (see
[`parked.md → Diagnostics Delta log — cross-hub-out detail-pane navigation`](../../../parked.md#diagnostics-delta-log--cross-hub-out-detail-pane-navigation)).

#### Filters (Delta log)

Six dimensions composing the [Toolbar pattern](../../patterns/toolbar.md):

```
Filter: [filter by name or field path…]   [Source: 3 of 8 ▾]   [Target: 2 of 6 ▾]   [This branch | All branches]   [Time: Last 1h ▾]
```

- **Filter** (free-text) — `Toolbar.Search` slot. Substring
  match against target display names and field paths.
- **Source** ([MultiSelect](../../patterns/multi-select.md)) —
  `classifier / lore_mgmt / user_edit / chapter_close / ...`
  (deltas source enum).
- **Target table** MultiSelect — `entities / lore / happenings /
threads / translations / ...` (deltas target_table enum).
- **Branch segment** — 2-segment Select `[This branch | All
branches]`. Inherits the story-selector's current branch; the
  segment is a _scope override_, not a branch picker. The story
  selector continues to pick the working branch.
- **Time range** Select — `Toolbar.Sort` slot. Single-select
  dropdown with presets `All time / Last 5m / Last 15m / Last 1h
/ Last 6h / Last 24h`. Default `All time`.

##### Branch segment — semantic two-option pick

`[This branch | All branches]` is a semantic two-option pick (not
a boolean on/off), per the [forms.md SwitchRow precedent](../../patterns/forms.md#switchrow-pattern):
segment is valid for semantic two-option picks, off-limits for
`[off | on]` booleans. The labels make the scope explicit at a
glance; chip-toggle alternative (`[All branches]` alone, off =
implicit current) was rejected for off-state ambiguity.

##### Time range — wall-clock anchor

Presets anchor to wall-clock-now, not to story activity.
"Last 1h" = deltas with `created_at` between `(now - 1h)` and
`now`. Reasoning: users read "last hour" with literal recency
semantics; anchoring to story activity creates surprise when
reopening across days. A user wanting "the last hour of activity
in this story" picks `All time`.

Absolute date-range picker (`From [date] To [date]`) parked —
power-user shape, low v1 demand.

##### No min-selection enforcement

Source / Target table filters allow 0 selected. Empty visible
set → filters-hide-all empty state fires naturally.

#### Cross-tab nav (Delta log)

Outbound: actionId chip → per-turn inspector when actionId is
present on the delta AND the corresponding turn capture is still
in ring buffer. Aged-out fallback: tooltip / toast as documented
in [Row tap behavior](#row-tap-behavior).

Inbound from per-turn inspector clicking a specific delta:
`actionId=X, focusDeltaId=Y` arrival. Nudges per the Tab 4
substrate, with one Tab 5-specific addition:

- **Branch toggle nudge**: if the focus delta is on a different
  branch than the current scope, the Branch segment expands to
  `[All branches]` silently. Additive scope-expansion mirrors
  the Level / Subsystem additive nudge.
- Multi-select chips and dropdowns (Source, Target) ADD the
  focus delta's values if missing.
- Free-text Filter does NOT auto-clear; fall through to
  empty-state if conflict.
- Time range nudges to `All time` if the focus delta's
  `created_at` falls outside the current window.

**Auto-emphasis without accordion**: Tab 5 has no inline expand.
Focus-row emphasis is scroll-into-view + a transient ~1.5s
ease-out background tint that fades to normal. After the fade,
the row is visually indistinct from neighbors. The Turn Tag chip

- tint flash + scroll-into-view together communicate the
  arrival.

Inbound broad (`actionId=X` only): apply filter, preserve other
filters, empty-state with clear-buttons if intersection is
empty.

#### Count badge (Delta log)

Unfiltered count of deltas in the current scope (respects the
Branch segment's setting — current branch only, or all branches
in the story). Other within-scope filters (Source, Target, Time,
Filter, actionId) do not affect the badge.

**No severity dimension**: color stays neutral. The
[`deltas` source / op enums](../../../data-model.md#diagram)
don't carry a severity ordering equivalent to log-level or HTTP
status. Confirms the Tab 4 close-out's per-tab note.

#### Empty states (Delta log)

Three flavors:

- **Scope empty** (no deltas in branch): "No deltas in this
  scope yet — turns produce deltas after the classifier runs."
- **Filters hide all, no actionId**: "No deltas match your
  filters · `[Clear filters]`."
- **Filters hide all, actionId arrival**: "No deltas match your
  filters for Turn `tr_a3kf` · `[Clear other filters]`
  `[Clear actionId]`."

#### State persistence (Delta log)

Same as Tabs 3 and 4: filter + branch-toggle + time-range state
persist as long as master is on; clear on master toggle-off.

#### Mobile expression (Delta log)

Delta log is story-anchored — the story selector + branch picker
remain visible on phone (consistent with the hub-level mobile
expression rule). Phone-tier row inherits DeltaLogRow's natural
3-line layout (op badge + target line / summary / meta line);
no separate phone-tier shape needed.

Filter row follows the [Toolbar cross-tier overflow rule](../../patterns/toolbar.md#cross-tier-overflow-rule):
Filter on own row at `md`, secondary cluster (Source MS + Target
MS + Branch segment + Time Select) wraps below at `xs`, possibly
to 2 visual lines on phone. With actionId arrival, the Turn Tag
chip joins the secondary cluster (3 visual lines worst-case).
The tightest filter chrome in the hub, but acceptable for
Tab 5's inspection focus.

#### Cost notes

Unlike the other tabs, Tab 5 queries a persisted, growing table.
Active stories accumulate dozens of deltas per turn. Query
needs `LIMIT` + virtualization per
[`patterns/lists.md`](../../patterns/lists.md). Tab 5 inherits
the [delta diff cache](../../../architecture.md#delta-history-diff-resolution)
prerequisite for `(old → new)` rendering; doesn't add new
dependencies.

#### Implementation notes (Delta log)

- **Single-tap-target on row body**: `Pressable` row wires
  `onPress` to open the Raw JSON viewer Sheet with the
  delta's `undo_payload`. ActionId chip is a nested
  `Pressable` with `stopPropagation` so its tap doesn't bubble
  to the row body.
- **Auto-emphasis tint** on focus-row arrival: ~1.5s ease-out
  background tint via CSS keyframe (web) / Reanimated
  `withTiming` (native). One-shot animation triggered by the
  arrival nav.
- **Virtualization** per [`patterns/lists.md`](../../patterns/lists.md).
  Row data fetched via paged query against the `deltas` table
  scoped to the branch toggle + time range; in-scope rows
  rendered via virtualized list. Filter predicates apply on the
  rendered rows.
- **Branch toggle nudge** on cross-tab arrival: implementation
  hooks the same arrival-handling code path that nudges
  multi-select chips, just operating on the branch-segment
  state.

## Cross-tab nav substrate

Tabs share an `actionId` deep-link parameter. A tab transition
that includes an actionId sets this parameter and auto-focuses
the appropriate row in the destination tab. An optional
`focusEntryId` parameter narrows the arrival to a specific row
(driving auto-scroll + auto-expand behavior at the destination —
see [Tab 4 → Cross-tab nav](#cross-tab-nav-logs) for the worked
example).

Per-tab filter and view state (active filter chips, expand state,
selected row) **persist as long as master is on** — closing the
hub via back-arrow preserves state, reopening finds it intact.
State clears on master toggle-off, consistent with the in-memory
ring-buffer wipe semantics from
[`observability.md → Wipe semantics`](../../../observability.md#wipe-semantics).

## Empty states

- **Master OFF + deep link to hub** — "Diagnostics is off — turn
  on the master toggle to enable capture" with a link to App
  Settings · Diagnostics. The hub entry in the Actions menu is
  hidden when master is off, so this state is reached only via
  direct route navigation.
- **Master ON + buffers empty** — per-tab copy ("No turns
  captured yet — trigger a turn to start" / "No calls yet" / "No
  log entries yet" / "No delta rows yet"). Memory probe's empty
  state stays as documented in its own screen doc.

## Mobile expression

Tab strip via the [Tabs primitive](../../patterns/tabs.md) —
horizontal strip on tablet+, falls back to Select at phone tier
per the existing
[Group C cardinality cascade](../../foundations/mobile/layout.md).

Each tab body inherits whatever list-pane / two-pane pattern fits
its shape: per-turn inspector uses two-pane (collapses to
list-first on phone per the standard rule); Call log, Logs, and
Delta log are single-list with row expansion. Memory probe's
existing mobile design carries over unchanged.

Story selector strip on phone collapses to a single-row affordance
showing only the active story name with a tap-to-switch picker;
branch picker moves to the per-tab filter row when a
story-anchored tab is active. When an **app-global** tab is active
(Logs, Call log) both story selector and branch picker hide
entirely — saves ~32px of phone chrome; the app-global tabs don't
care about story selection and showing them would be misleading.

## Screen-specific open questions

- **Story selector switch when buffers contain other-story data.**
  Switching stories doesn't wipe the per-story `turnCaptures` —
  the buffer is keyed by `actionId`, not story. Should
  story-anchored tabs hide entries whose `branchId` doesn't match
  the current story selection (filter at render-time), or should
  the buffer wipe on story switch? Lean: filter at render-time;
  buffer survives story switches so the user can flip back. Detail
  for the per-tab passes.
- **Cross-window aggregation on Electron** — each window has its
  own diagnostics store. If a user opens the hub in window A
  while turns run in window B, hub A's buffers are empty. Parked
  as
  [Cross-window aggregator](../../../parked.md#observability--cross-window-aggregator-on-electron).
  Until then: open the hub in the window where the work is
  happening.
- **Tab count badge calculation semantics for Tab 2** — resolved
  for Tabs 3, 4, 5 in their detail passes (see [Tab strip](#tab-strip)
  for the per-tab rules). Tab 2 (per-turn inspector) confirms its
  count source and color rule at its detail pass — likely
  outcome-keyed (`failed > aborted > completed`) but pending the
  per-tab decision.
- **Memory probe tab relocation question.** This design pass
  references the existing
  [`memory-probe.md`](../memory-probe/memory-probe.md) rather
  than relocating its content under `diagnostics/`. If future
  passes find the cross-doc reference structurally awkward, the
  memory-probe content can be relocated via `git mv` to
  `screens/diagnostics/memory-probe/` with inbound anchor sweeps.
  Not load-bearing for v1.

## Top-bar Actions menu

The hub's entry point is the Actions menu — a global affordance
specified in
[`patterns/actions-menu.md`](../../patterns/actions-menu.md). The
hub contributes a single entry, `Open Diagnostics Hub`, gated by
the diagnostics master toggle; the menu's broader inventory and
organization live in that pattern doc.
