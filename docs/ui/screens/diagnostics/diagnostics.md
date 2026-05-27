# Diagnostics Hub

Power-user / dev surface for inspecting what the AI pipeline did.
Tabbed page hosting the family of observability surfaces designed
around the contracts in
[`docs/observability.md`](../../../observability.md).

Gated by `app_settings.diagnostics.enabled` (master toggle). When
off, the hub entry is absent from the
[Actions menu](../../principles.md#top-bar-design-rule) — the
toggle itself is the discovery point.

Surface inventory plus Tab 4 (Logs) detail. **Per-tab body
designs for tabs 2, 3, and 5 land in their own detail passes** when
each is built; this doc names the structural pieces (top-bar, tab
strip, story-anchor selector, cross-tab nav, empty states, mobile
expression) plus the full body spec for Tab 4 below.

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
badges render to the right of each label. Each tab pins its own
count source and color rule at its detail pass. Tab 4 (Logs) ships
**unfiltered buffer count, always rendered, colored by max severity
present** — see [Tab 4 → Count badge](#count-badge). Other tabs
pick their own source + color when designed.

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
reverse-chronological by `startedAt`. Row state-aware visual
treatment:

- **In-flight** — pulsing indicator, request-side fields visible,
  response-side fields a "Waiting…" placeholder, no duration
  shown yet.
- **Completed** — solid status chip (2xx/3xx/4xx/5xx coloring),
  duration, response body expandable.
- **Failed** — error chip, partial fields, error message.

Row identity (ULID) stable across the in-flight → completed/failed
transition; React keys don't churn and per-row expanded state
persists through the transition.

Click expands the row to show request + response payloads in the
JSON viewer.

Filters: source (provider / embedder / etc.), state, HTTP status
range, free-text URL/body search.

Cross-tab nav: actionId chip on a row → per-turn inspector for
that turn (when actionId present and turn capture is still in the
ring buffer).

Auth-style headers (`Authorization`, `X-API-Key`, `Cookie`,
response `Set-Cookie`) render as `'***'` per the
[redaction contract](../../../observability.md#header-redaction).

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

#### Count badge

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
selector's branch), with a filter to expand to "all branches in
this story." Sources the canonical `deltas` table (persisted by
design — see
[`data-model.md → Entry mutability & rollback`](../../../data-model.md#entry-mutability--rollback)).

Row shape **extends the
[DeltaLogRow pattern](../../patterns/delta-log-row.md)** — same
primitive World and Plot per-entity History tabs use. Difference:
those tabs scope to one target_id's lineage; this tab is
**unscoped across rows** (every delta) but scoped within a story
(and by default within a branch).

Filters:

- `source` multi-select — `classifier | lore_mgmt | user_edit |
chapter_close | ...` (matches the existing source enum on
  `deltas`).
- `target_table` multi-select — `entities | lore | happenings |
threads | translations | ...`.
- Branch — current branch by default; expand-to-all-branches
  toggle.
- `action_id` — implicit when navigated from per-turn inspector.
- Free-text search across target names and field paths.
- Optional time range.

Cross-tab nav: actionId chip → per-turn inspector when actionId
is present on the delta AND the corresponding turn capture is
still in the ring buffer. When the turn has aged out, the chip is
informational only (clicking shows "this turn's diagnostic data
has aged out").

**Prerequisite:** the
[delta diff cache](../../../architecture.md#delta-history-diff-resolution)
resolves `(old → new)` rendering for ALL history surfaces. This
tab inherits the prerequisite; doesn't add a new one. Fallback
while a row's cache entry is pending: a summary derived from
`undo_payload` keys alone (e.g., `Modified traits, drives`),
upgrading to the rich `(old, new)` prose on populate. Raw
`undo_payload` JSON viewing is the pattern's separately-deferred
[inline diff expansion](../../patterns/delta-log-row.md#what-this-design-defers)
affordance, not the populate-pending state.

**Cost:** unlike the other tabs, this one queries a persisted,
growing table. Active stories accumulate dozens of deltas per
turn. Query needs `LIMIT` + virtualization per
[`patterns/lists.md`](../../patterns/lists.md).

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
- **Tab count badge calculation semantics for tabs 2, 3, 5** —
  Tab 4 (Logs) resolves to unfiltered buffer count colored by max
  severity present (see [Tab 4 → Count badge](#count-badge)). The
  pattern generalizes to severity-bearing tabs (Tab 3 Call log:
  `error` if any 5xx, `warn` if any 4xx, neutral otherwise; Tab 2
  per-turn inspector: outcome `failed > aborted > completed`).
  Tab 5 (Delta log) has no severity dimension. Each tab confirms
  its count source and color rule at its detail pass.
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
