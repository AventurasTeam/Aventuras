# Reader / Composer

**Wireframe:** [`reader-composer.html`](./reader-composer.html) — interactive

The core screen. Entry list + composer + streaming AI reply. Right
rail for world-state Browse. Chapter navigation + in-world time in
the top-bar chrome. Next-turn suggestions between entries and
composer.

Cross-cutting principles that govern this screen are in
[principles.md](../../principles.md). Relevant sections:

- [Top-bar design rule](../../principles.md#top-bar-design-rule)
- [Edit restrictions during in-flight generation](../../principles.md#edit-restrictions-during-in-flight-generation)
  (composer's send/cancel duality, status-pill click-to-cancel,
  disabled controls during a turn)
- [Composer mode — send-time transform](../../principles.md#composer-mode--send-time-transform-narration-aware)
- [Entity surfacing — three levels, same data](../../patterns/entity.md#entity-surfacing--three-levels-same-data)
  (Reader provides level 1 — Browse rail — and level 2 — peek drawer)
- [Entity row indicators — four channels](../../patterns/entity.md#entity-row-indicators--four-orthogonal-channels)
- [Browse filter chips + accordion grouping](../../patterns/entity.md#browse-filter-chips)
- [Empty list / table state + no-results state](../../patterns/lists.md#empty-list--table-state)
  (Browse rail inherits both: per-category empty placeholder when
  the active kind has no rows; "No results" line when search /
  filter narrows to zero)
- [Composing virtualization with load-older](../../patterns/lists.md#composing-virtualization-with-load-older)
  (entry list at scale: virtualization layered on a loaded window
  per [Scroll behavior](#scroll-behavior) below)

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [logo] <title ✎> · Chapter ▾ · 🕒 time    [status][br][⎇][⛭][←]│ ← top bar (⛭ = Story Settings)
├───────────────────────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  (chapter progress strip)              │
├───────────────────────────────────────┬───────────────────────┤
│                                       │ Browse rail            │
│   entries scroll                      │ (scope chip if active) │
│                                       │ category dropdown      │
│                                       │ filter chips           │
│                                       │ search                 │
│                                       │ list (sorted, grouped) │
│                                       │ + Import from Vault    │
│   suggestions panel (after AI reply)  │                        │
│   composer (mode, regen, send/cancel) │                        │
└───────────────────────────────────────┴───────────────────────┘
```

(Right-side peek drawer slides in over the rail + narrative when an
entity row is clicked.)

## Top-bar — chapter navigation

Lean breadcrumb:

`<story-title ✎>  ·  <chapter-chip ▾>  ·  <time chip>`

**Progress strip** — thin 3px full-width bar along the bottom edge of
the top-bar. Fill width = current chapter's tokens / threshold.
Tooltip on hover shows exact numbers. Click opens chapter popover.

**Color thresholds** (apply to both the top-strip AND the popover
progress bar):

- **< 80%**: green (safe)
- **80–90%**: yellow (approaching — heads-up for manual-mode users)
- **≥ 90%**: red / warn (at limit — close imminent)

Why coloring matters: auto-chapter-close is a story setting; some
users wrap chapters manually. For them, the color is the primary
signal to close.

**Chapter popover contents:**

- **Chapter list** — closed chapters + the current one (labeled
  `in progress`, highlighted). Closed chapters click to jump.
- **Progress bar + label** — `chapter progress · 8,420 / 24,000 tok`
- **Close chapter manually** — primary action; opens the
  [chapter-close modal](../chapter-timeline/chapter-timeline.md#chapter-close-modal)
  to confirm the range and trigger the close sub-pipeline. Same
  modal is reachable from the
  [Chapter Timeline](../chapter-timeline/chapter-timeline.md) screen.
- **Manage chapters →** — link to the
  [Chapter Timeline](../chapter-timeline/chapter-timeline.md) screen
  for deeper chapter management (edit metadata, delete, regenerate
  summary, close with explicit end-entry pick).

Chapter closing is reachable from both the popover AND the Actions
menu.

## Top-bar — in-world time display

In-world time is rendered by the active calendar's renderer from the
latest entry's `metadata.worldTime` (physical seconds since story
start; calendar-uniform) plus the story's
`definition.worldTimeOrigin` — a `TierTuple` keyed by the active
calendar's tier names that anchors the elapsed seconds to a starting
point on the display tier-stack. See
[`calendar-systems/spec.md`](../../../calendar-systems/spec.md#calendar-definition)
for the primitive.

The renderer walks `worldTime + worldTimeOrigin` through the
calendar's tier stack to a tier-tuple, then renders via the
calendar's `displayFormat` Liquid template. Reader chrome treats
the rendered string as opaque; all calendar-specific shaping is
inside the template.

**Surfaces:**

- **Top-bar time chip** — small clock icon + label, after the chapter
  chip. Always visible. Renders the formatter's output as opaque
  text. `max-width: 260px` with ellipsis on overflow; full label in
  tooltip. Becomes interactive (click → popover) when the active
  calendar has surfaceable affordances; see
  [Time-chip popover](#time-chip-popover) below.
- **Chapter break (inline)** — each closed chapter's break in the
  entries list shows time at close (formatter applied to that
  chapter's `end_entry_id` worldTime).
- **Chapter popover rows** — each row shows a time range (start → end
  formatted via the same formatter).

**The formatter is the only place "calendar" logic lives.** UI doesn't
parse, segment, or interpret the time string — it consumes whatever
the formatter returns. Future calendar systems plug in by replacing
the formatter; UI code is untouched.

Storage / classifier contract: see
[`data-model.md → In-world time tracking`](../../../data-model.md).

### Time-chip popover

The time chip becomes interactive when there are calendar-time
affordances to surface. Today: era flip on calendars where
`eras !== null`. The chip stays passive (no `▾` indicator, no
hover affordance, no popover) when nothing is surfacable — e.g.,
calendars with `eras: null` and no other affordances yet.

When interactive, click → small popover anchored to the chip:

```
┌── Day 12 · Reiwa 6 ──────────┐
│  Current era: Reiwa           │
│  [ Flip era…              ]  │
└───────────────────────────────┘
```

- **Header** — the chip's rendered time, repeated for context.
- **Current era** — read-only `Current era: <name>` label;
  confirms what era is active (the era applied to the latest
  entry's `worldTime` per the calendar formatter). Hidden when
  the calendar has `eras: null`.
- **`Flip era…` action** — opens the
  [Flip era modal](#era-flip) anchored at the latest entry.
  Hidden when `eras: null`.

Symmetric with the chapter chip ▾ pattern: both chips become
interactive surfaces for their respective calendar-domain
concerns. The popover is the **anchor point for future
calendar-time affordances** — when the deferred
[manual `worldTime` correction](../../../followups.md#manual-worldtime-correction--cascade-vs-jump--downstream-blast-radius)
gets its design pass, it lands here without growing chrome.

## Per-entry actions

Actions on an individual entry (edit, regenerate, branch, delete)
follow the
[icon-actions pattern](../../patterns/icon-actions.md) — icon
buttons, always-visible-but-muted, brighten on row hover/focus,
same affordance on desktop and mobile.

Icon set (placeholder glyphs per the
[shared glyph vocabulary](../../patterns/icon-actions.md#glyph-vocabulary);
finalize with visual identity):

| Action   | Glyph | Meaning                                                                                                                        |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| edit     | ✎     | Edit entry content                                                                                                             |
| regen    | ↻     | Regenerate this AI reply                                                                                                       |
| branch   | ⎇     | Branch from this entry — opens the [creation modal](./branch-navigator/branch-navigator.md#branch-creation--modal)             |
| flip era | 📅    | Flip era from this entry — opens the [flip-era modal](#era-flip). Conditional: renders only when active calendar has eras.     |
| delete   | ×     | Delete this entry — opens the [rollback confirmation](./rollback-confirm/rollback-confirm.md) (cascade preview + counts modal) |

Per-entry action sets:

- **User entry:** edit, `[flip era]`, delete
- **AI entry:** edit, regen, branch, `[flip era]`, delete
- **System entry:** content-level buttons (Retry / Details / Dismiss)
- **Streaming entry:** no per-entry actions; cancel happens via the
  composer's Send→Cancel transform

Bracketed `[flip era]` indicates conditional visibility — the icon
renders only when the active calendar has `eras !== null`. See
[Era flip](#era-flip) below.

## Era flip

Era flips are user-triggered narrative events writing one row to
[`branch_era_flips`](../../../data-model.md#era-flips) — see
[`calendar-systems/spec.md → Eras`](../../../calendar-systems/spec.md#eras-hoisted-out-manually-triggered)
for what the underlying system models. This section covers the UI
surfaces that trigger a flip and the modal that captures the era
name.

**Trigger surfaces** (all conditional on `eras !== null`):

- **[Time-chip popover](#time-chip-popover) — `Flip era…` action.**
  Primary in-narrative path. Defaults the modal's anchor to the
  latest entry's `worldTime`.
- **[Actions menu](../../principles.md#actions--platform-agnostic-action-directory) — `Flip era…`.**
  Universal route. Same default anchor (latest entry).
- **Per-entry `📅 flip era` icon.** Defaults the anchor to the
  chosen entry's `worldTime` — covers the retcon case without
  needing the deferred entry-ref picker.

### Flip-era modal

```
┌──── Flip era ─────────────────────────── × ─┐
│                                              │
│   Flipping at entry 47 (Day 12, Reiwa 6).    │
│                                              │
│   Era name *                                 │
│   ┌────────────────────────────────────┐     │
│   │ Hei                                │     │
│   └────────────────────────────────────┘     │
│   ┌────────────────────────────────────┐     │
│   │ Heisei                             │     │
│   │ + Add new era: "Hei"               │     │
│   └────────────────────────────────────┘     │
│                                              │
│                       [ Cancel ]  [ Flip ]   │
└──────────────────────────────────────────────┘
```

- **Width** ~400px. Centered. Backdrop dim.
- **Context line** — formatted via the active calendar's renderer
  on the chosen entry's `worldTime`. Read-only. Says "start of
  story" when `at_worldtime ≈ 0`.
- **Era name input** — uses the
  [Autocomplete-with-create primitive](../../patterns/forms.md#autocomplete-with-create-primitive)
  configured against `EraDeclaration.presetNames`. Casing
  normalization = canonical (commit form snaps to the preset's
  canonical case on case-insensitive match). Required;
  auto-focused on open.
- **`Flip` button** — disabled until input is non-empty
  (whitespace doesn't count). Enter inside the input also confirms,
  per the primitive's default Enter behavior.
- **`Cancel`** — closes; no row written. Esc and click-outside
  also Cancel.

**Collision guard.** `branch_era_flips` enforces unique
`(branch_id, at_worldtime)`. If the chosen anchor's `worldTime`
matches an existing flip's `at_worldtime` on the current branch,
the modal blocks save with an inline error pointing the user to
the existing flip's name and to the flip-list affordance in
[Story Settings · Calendar](../story-settings/story-settings.md#era-flips-on-this-branch)
where they can delete it.

**Confirmation.** No separate "are you sure" step. The modal's
form IS the confirmation. The time chip re-renders immediately
post-flip — that's the feedback. Reversible via CTRL-Z (one
delta).

**Edit-restrictions gating.** Every trigger surface and the modal's
`Flip` button disable when a pipeline transaction is in flight,
per
[`principles.md → Edit restrictions during in-flight generation`](../../principles.md#edit-restrictions-during-in-flight-generation).
Tooltip copy is principle-owned.

**Visibility.** All three trigger surfaces hide entirely when the
active calendar has `eras: null`. Browsing / cleanup of orphan
flips (when the calendar swap leaves a branch carrying flips that
the new calendar doesn't support) lives in
[Story Settings · Calendar → Era flips](../story-settings/story-settings.md#era-flips-on-this-branch)
— the trigger surfaces stay hidden regardless.

## Reasoning expansion + token metadata on AI entries

Meta line is intentionally minimal. No model name — users don't care
per-entry. Format:

`📚  [🧠]  <reply-tok> / <reasoning-tok>`

- **Narrative glyph** (📚 placeholder, finalized in visual identity).
  Replaces a text "AI reply" label so the meta row stays compact at
  narrow widths and doesn't compete with the per-entry action cluster
  for horizontal space. Symbolizes the narrative voice / narrator
  rather than the AI provider.
- **Brain icon** (🧠 placeholder). Clickable — toggles an italic,
  muted, left-bordered reasoning body expansion **above** the content
  (chronological order: think, then speak). Absent when the provider
  doesn't expose reasoning tokens.
- **Unified token display** as `<reply> / <reasoning>` in muted
  monospace. Tooltip explains the slash.
- **Pulses** while the model is streaming reasoning (same animation
  as the gen-status pill dot). Static + clickable when done.
- **Collapsed by default**, including during the reasoning phase —
  click the pulsing brain to expand and watch reasoning stream.

## Streaming entry — same structure, live state

The streaming AI entry uses the same structure as a completed AI
entry.

- **Reasoning phase:** brain icon pulses, token display `— / N →`
  (dash for reply-not-started, N = reasoning tokens so far).
  Reasoning body stays **collapsed by default**; pulsing brain is
  the signal. Content placeholder "reply hasn't started yet".
- **Reply phase:** brain icon static (reasoning complete), token
  display `M / N →` (M = reply streamed, N = final reasoning),
  content streams token-by-token.
- **Complete:** entry commits; trailing `→` disappears, brain
  clickable for reasoning expansion.

Non-reasoning providers: no brain, token display collapses to just
reply tokens.

## Error surface — system entries, not chrome indicators

Pipeline errors do **not** live in the top-bar status pill. They
render as **system-kind entries in the main chat** — orange/warn-
tinted bubbles with the failure description and action buttons (Retry
/ View details / Dismiss). Rationale: errors need to be visible,
actionable, and part of the narrative log as context, not a silent
chrome blip.

## Next-turn suggestions

After an AI reply completes, a **suggestions panel** appears between
the entries and the composer, offering 3-4 possible next turns. **UI
shape is unified** across modes; **category sets are mode-specific**
because adventure and creative frame the user differently.

**Categories per story mode:**

| Mode      | Categories                                  |
| --------- | ------------------------------------------- |
| Adventure | `Action`, `Dialogue`, `Examine`, `Move`     |
| Creative  | `Action`, `Dialogue`, `Revelation`, `Twist` |

**Colors** (wireframe placeholders):

| Category     | Color  |
| ------------ | ------ |
| `Action`     | Blue   |
| `Dialogue`   | Green  |
| `Examine`    | Purple |
| `Move`       | Amber  |
| `Revelation` | Orange |
| `Twist`      | Red    |

**Suggestions are complete prose.** Click → composer text fills with
the suggestion, composer mode is set to **`Free`** (suggestion is
already finished prose; no further wrapping needed). User can edit
text and/or override mode before sending.

**NOT coupled to composer mode categories.** Composer mode =
prefix/suffix wrapping intent. Suggestion category = narrative-beat
type. Different axes.

**Mix is classifier-driven**, not strict one-of-each.

**States:**

- `visible` — normal
- `loading` — suggestion LLM is regenerating (rows dim, regen icon
  pulses)
- `error` — generation failed (inline error with Retry)
- `collapsed` — user hid the list via chevron; chrome remains
- `hidden` — user disabled suggestions in Story Settings
  (`stories.settings.suggestionsEnabled = false`); panel never
  appears

## Scroll behavior

The entry list is log-shaped and unbounded; entries accumulate
within a branch, and the read pattern is recent-most-first. Three
mechanics compose: a single contiguous loaded window with auto-load
on scroll boundaries, autoscroll that follows AI streaming, and
jump buttons for terminal-endpoint navigation. The composed
fetching + virtualization pattern is documented at
[`patterns/lists.md → Composing virtualization with load-older`](../../patterns/lists.md#composing-virtualization-with-load-older);
this section covers the reader-specific behaviors layered on top.

### Loaded-set model

At any moment the reader holds a **single contiguous window** of
entries — never two disconnected windows.

**Window.** The contiguous range in memory + DOM. On branch open:
~50 most recent entries. Inside the window, only visible rows +
small overscan render to DOM (virtualization).

**Auto-load on scroll boundary.** As the user scrolls within the
window:

- Approaching the top of the loaded range (within ~one
  viewport-height of the topmost loaded entry) → auto-fetch the
  next older chunk (~50 entries). Content prepends; native browser
  scroll-anchoring keeps visible content stable.
- Approaching the bottom of the loaded range (within ~one
  viewport-height of the bottommost loaded entry, when that isn't
  the live edge) → auto-fetch the next forward chunk. Content
  appends.

Loading shimmer at the boundary edge during fetch — fast scrollers
don't hit empty space. This is the reader's deviation from
[`lists.md → Load-older`](../../patterns/lists.md#load-older--log-shaped-unbounded-lists)'s
explicit-click rule. The existing rule applies to History-tab-shaped
surfaces where auto-loading older content while glancing at recent
state would be a surprise; the reader's auto-load fires only on
**boundary approach** — the user explicitly asking for more in
that direction.

**Swap on jump.** When the user invokes
[jump-to-top or jump-to-bottom](#jump-buttons) to a region not
adjacent to the current window, the entire window swaps:

- Jump-to-top → unload current, fetch entries 1..50 of the branch,
  render. Instant cut to entry 1 in viewport.
- Jump-to-bottom from a non-recent window → unload current, fetch
  entries `last-49..last`, render. Instant cut to bottom.
- Jump-to-bottom while already in the recent window → smooth scroll
  (~150ms) to bottom. No swap.

**Scroll-position restoration per window.** Each branch has up to
two remembered scroll positions — one for the recent window, one
for the top window (if either has been visited this session). Save
the current window's `scrollTop` before unloading; restore on
return. Without it, the swap loses the user's place every time
they peek at the start. Positions reset on branch switch.

**"Branch top" semantics.** First entry of the **current branch** —
first post-fork entry on a non-root branch, or entry #1 of the root
branch. The reader does not walk fork chains across branches.
Cross-branch navigation is the
[Branch navigator](./branch-navigator/branch-navigator.md)'s
domain.

**Branch switch.** Resets the window to the recent ~50 entries of
the new branch, scrolled to bottom. Saved scroll positions for the
previous branch are dropped.

### Autoscroll

Per-stream state machine: **engaged** ↔ **disengaged**, with
auto-re-engagement on return to bottom.

**Engage condition (per stream).** When an AI reply begins streaming,
autoscroll evaluates whether the viewport is at-bottom (within ~80px
tolerance):

- At bottom → engaged. Viewport pins to streaming entry's bottom
  edge as tokens arrive.
- Not at bottom → disengaged. Streaming entry grows below the fold;
  user keeps their position.

The ~80px tolerance is generous because the suggestion-panel +
composer chrome sits below the entries.

**Disengage.** Any user-initiated scroll upward during a stream →
disengaged for the rest of the stream. Detection: track `scrollTop`
set by autoscroll programmatically; if a `scroll` event reports a
different value, it's user-initiated.

**Re-engage (auto).** User scrolls back to within ~80px of bottom
while still in the same stream → autoscroll re-engages. Viewport
pins back to streaming entry's bottom.

**Stream end.** Engaged / disengaged state resets. Next stream
re-evaluates the engage condition fresh.

**Layout shifts during a stream.**

- **Reasoning body expansion on an earlier entry** — document grows
  above viewport; native browser scroll-anchoring keeps visible
  content stable. The chosen virtualization library MUST preserve
  scroll-anchoring on above-viewport mutations (per
  [`lists.md → Library choice`](../../patterns/lists.md#library-choice)).
- **Suggestion panel appearing at stream end** — adds ~80px between
  last entry and composer. Engaged: viewport stays at the new
  bottom (engagement carries through the layout shift). Disengaged
  - above tolerance: panel doesn't move them.

**Streaming while in a non-recent window.** Pipeline writes happen
in the data layer regardless of which window is rendered. The
streaming entry is at the live edge — outside the loaded window
when the user has jumped to top. Render simply doesn't show it
until the user returns to the recent window. The chrome status pill
(per
[`principles.md → Universal in-story chrome`](../../principles.md#universal-in-story-chrome))
is the cross-window awareness signal that something is in flight.
Render reattaches when the user returns; token append continues
into the now-mounted entry.

**Edit-restrictions.** Scroll is a read action. Per
[`principles.md → What's not gated`](../../principles.md#whats-not-gated),
autoscroll, jump buttons, and auto-load fetches are all unaffected
by the in-flight transaction gate.

### Jump buttons

Two floating affordances in the scroll viewport, stacked vertically
near the right edge, above the suggestion panel + composer chrome.

**Visibility — conditional.**

- **Jump-to-bottom** — visible when the user is not at-bottom of
  the recent window, OR when the current window is not the recent
  window. Slides in / out on threshold cross.
- **Jump-to-top** — visible when (a) the
  [`Show jump-to-top button` App Settings toggle](../app-settings/app-settings.md#show-jump-to-top-button)
  is on AND (b) the current window is not the top window OR the
  user is not scrolled to entry 1 within it. Hidden otherwise.

**Click behavior.**

- **Jump-to-bottom.** In the recent window: smooth scroll (~150ms)
  to bottom. In the top window: swap (unload top, load recent),
  instant cut to bottom of recent. Re-engages autoscroll if a
  stream is in flight and the user lands at-bottom.
- **Jump-to-top.** In the top window already loaded: smooth scroll
  to entry 1. In the recent window: swap (unload recent, load
  entries 1..50), instant cut to entry 1.

The swap path is always instant cut — there's no in-between content
to traverse smoothly. The same-window path is smooth.

**Keyboard shortcuts** (always available regardless of toggle):

- `Home` — jump-to-top
- `End` — jump-to-bottom

**Actions menu entries** (always available):

- `Jump to top of branch`
- `Jump to bottom`

The App Settings toggle gates the visible button only, never the
capability — keyboard and Actions remain on regardless.

**Chapter-top is not a separate scroll button.** The chapter chip in
the [top-bar — chapter navigation](#top-bar--chapter-navigation)
already exposes per-chapter jumps via the chapter popover.
Scroll-chrome buttons stay focused on terminal endpoints (top /
bottom of branch); chapter-anchored navigation lives with chapter
chrome.

## Browse rail — collapse / expand

The rail is collapsible to give the narrative full prose width and
to reduce chrome during pure reading. It also adapts to small
Electron windows (responsive auto-collapse below a viewport
threshold) without committing to a mobile shape.

### Collapsed state — full-height edge strip

Collapsed, the rail squeezes to a full-height vertical strip on
the screen's right edge (~16–24px wide; exact value finalized in
the visual identity pass). The strip:

- Provides a **visual silhouette** so the rail stays
  discoverable — a continuous vertical region telegraphs "the
  rail lives here," matching OS sidebar conventions.
- Is the **expand affordance**: clicking anywhere on it restores
  the rail.
- Has **no functional content** — no indicators, no kind icons,
  no awareness signals. Pure click target plus silhouette.

The strip sits at muted opacity and brightens slightly on hover
(tooltip: `Expand rail`).

The strip is intentionally not a "what's new on the rail since
you last looked" awareness surface; cross-surface classification
awareness is parked as a separate pattern design (see
[`followups.md → Classification awareness pattern`](../../../followups.md#classification-awareness-pattern)).

### Open state — collapse trigger

A small chevron (`›`) in the rail header's top-right corner
collapses the rail. The chevron points toward the right edge to
telegraph the motion. Tooltip: `Collapse rail`.

Keyboard shortcut: `Cmd/Ctrl+\` (toggles regardless of focus
location, mirroring VSCode's sidebar shortcut).

No top-bar slot for the toggle. The back button stays in its
existing rightmost position, and the right-edge spatial gravity
belongs to the rail itself, not to the chrome cluster.

### State model — manual + viewport, decoupled

Two inputs combine to determine display:

- **Manual preference** — set by the chevron, the strip, or the
  keyboard shortcut. Persists app-globally across launches (not
  per-story, not per-session).
- **Viewport-forced collapse** — fired by resize events crossing
  a width threshold downward. Overrides display without
  overwriting manual preference.

```
on user toggle (chevron / strip / shortcut):
  manual_preference = (toggle); apply immediately

on resize crossing threshold downward (viewport < ~900px):
  display = collapsed (manual_preference unchanged)

on resize crossing threshold upward (viewport > ~980px,
~80px hysteresis):
  display = manual_preference (restore)
```

Viewport check is **event-driven** (one-shot on threshold cross),
not a continuous constraint. A continuous constraint would
silently re-collapse the rail every time a user clicks the strip
in a small window. Decoupling lets the user explicitly expand the
rail in a cramped window and accept the squeeze.

Threshold pixel values (~900 / ~980 with ~80px hysteresis) are
tunable in the visual identity pass; the **rule shape** —
event-driven, hysteresis-buffered, manual preference preserved
underneath — is what's locked here.

First-launch default: **open**. Storage venue is implementation
detail (an ergonomic UI-state surface, not `stories.settings` —
this is chrome state, not story content).

### Peek drawer — peek implies rail open

The peek drawer is invoked only by clicking rail rows in the
expanded rail (per
[Peek drawer](#peek-drawer--lead-affordance-for-characters)).
Peek and collapsed-rail are mutually exclusive states:

- Open + click rail row → peek slides in over rail + narrative
  (status quo).
- Collapsed → no path to invoke peek without first expanding.

Collapsing the rail (manually or via viewport-forced collapse)
while peek is open closes the peek simultaneously. They're a
continuum: peek is a deeper state of "rail engaged," collapse is
"rail dismissed." Closing the container closes its contents.

### Animation

~150ms symmetric horizontal slide (ease-out collapse, ease-in
expand). The rail and the strip are visually a continuum — no
fade, no separate elements appearing. The narrative column's
right edge slides left/right in lockstep.

## Browse rail — search scope

Search is **category-aware** — scope changes with the active
category in the dropdown:

- **Characters / locations / items / factions** (entity rows):
  `name`, `description`, `tags`
- **Lore**: `title`, `body`, `category`, `tags`
- **Threads**: `title`, `description`, `category`, `tags`
- **Happenings**: `title`, `description`, `category`, `tags`

Placeholder text rotates with the active category
(`Search characters…` / `Search lore…` / etc.) — reader-specific
deviation; standard tooltip + ⓘ affordances per the
[search-bar-scope pattern](../../patterns/lists.md#search-bar-scope).

## Peek drawer — lead affordance for characters

The peek-head exposes the lead-character mutation inline (no overflow
menu — peek is intentionally lightweight; deep work routes to the
World panel via the existing `Open in World panel →` foot link).

For a character peek:

- **Currently lead** — small badge after the name reading `You`
  (adventure mode) / `Protagonist` (creative). Same `lead-badge`
  styling used in the Browse rail row, so the indicator is uniform
  wherever a character is surfaced.
- **Not lead** — small inline `Set as lead` text-action after the
  name. Click sets `stories.definition.leadEntityId` to this entity;
  the peek transitions to the badge state in place.

For non-character kinds (location / item / faction / lore / threads /
happenings) the peek-head is unchanged — the affordance does not
apply.

No confirmation modal. Lead-switching is a first-class action per
[principles → Mode, lead, and narration](../../principles.md#mode-lead-and-narration--three-orthogonal-concepts);
the reader's narration and `You` anchor immediately re-anchor to the
new lead, which IS the feedback (consistent with the no-toast
precedent in the
[branch creation flow](./branch-navigator/branch-navigator.md#after-confirm)).

### State-field composition — same as World panel Overview

The peek body's content is a 440px-width projection of the
[Overview tab](../world/world.md#overview--glance-summary-read-mostly)
from the World panel. Per-kind glance composition lives there;
peek doesn't restate it. Single design, two surfaces.

This includes the [non-default `injection_mode` chip](../world/world.md#overview--glance-summary-read-mostly)
that lives on Overview — it propagates to peek for free via the
projection rule. No separate spec for the peek surface.

### State-field composition — lore peek

Lore has no Overview tab (per
[`world.md → Lore — separate kind`](../world/world.md#lore--separate-kind)),
so the entity-side projection rule doesn't apply. The lore peek
body is a read-only projection of the **Body tab + non-default
operational signals from Settings**, top-down at 440px width:

- **Operational chip row** — renders only when there are
  non-default signals to surface:
  - **Injection-mode chip** when `always` or `disabled` (hidden
    for `keyword_llm` default). Same chip shape used on entity
    Overview.
  - **Category chip** when set. Distinct visual treatment from
    the injection chip — content tag, not operational signal.
- **Body prose** — read-only render of `lore.body`. **Truncates
  at ~10 visible lines** with `…` ellipsis; the foot link is the
  escalation path for full read. Empty body cannot occur (per
  [`world.md → Required body`](../world/world.md#required-body--creation--edit-invariant)).
- **Tags chip row** — read-only mirror of the Settings `tags`
  field.

What's not on lore peek:

- No `priority` — peek surfaces user-actionable signals, not
  internal retrieval scaffolding.
- No inline editing — peek-head's lead-character mutation is
  character-only and doesn't apply.
- No History — log access stays on the World panel.

Peek is read-mostly. The lead-character mutation above is the only
inline mutation surface (character-only; doesn't apply to lore or
other non-character kinds). Deep edits route to the World panel
via the existing `Open in World panel →` foot link.

## Mobile expression

Renders per the
[mobile foundations contracts](../../foundations/mobile/README.md).
Reader is a 2-pane surface that collapses to 1-pane on phone per
[`collapse.md → Reader / composer`](../../foundations/mobile/collapse.md#reader--composer-narrative--rail--narrative--rail-strip).
Tablet inherits desktop verbatim per
[navigation.md → Tablet](../../foundations/mobile/navigation.md#tablet-6401023-px);
the existing rail viewport-forced-collapse threshold (~900 px per
[State model](#state-model--manual--viewport-decoupled)) covers
phone-landscape and iPad-portrait, so iPad-portrait already gets
the strip-collapsed rail without a phone-specific rule. Phone-tier
specifics below.

- **Top-bar shape.** Slim single-row plus reader-only chip strip
  per
  [navigation.md → Phone top-bar](../../foundations/mobile/navigation.md#phone--640-px).
  Layout: `[←] [story-title…] [status-pill] [⛭] [⚲]`. Story title
  truncates with ellipsis; tap reveals the full title in a transient
  popover per
  [touch.md → Tap-to-tooltip on inert chrome text](../../foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text).
- **Reader chip strip (phone-only).** Below the top-bar:
  `[Chapter ▾] [<time chip>] [⎇N] ········· [☰ Browse]`.
  Horizontally scrollable when overflowing; ~16 px left padding
  doubles as iOS swipe-back safe zone per
  [touch.md → Chip-strip safe zone](../../foundations/mobile/touch.md#chip-strip-safe-zone).
  The Browse chip is **right-anchored** within the strip — it's
  an action affordance (opens the rail content as a Sheet), not a
  state chip; the visual separation telegraphs the difference.
- **Chapter chip popover** binds to **Sheet (medium, bottom)** on
  phone per
  [layout.md → Surface bindings](../../foundations/mobile/layout.md#surface-bindings--existing-app-surfaces)
  — multi-row content (chapter list, progress bar, manage-chapters
  link) exceeds the tiny-popover threshold.
- **Time chip popover** stays Popover all tiers — tiny content
  (era label and `Flip era…` action).
- **Branch chip popover** binds to **Sheet (short, bottom)** on
  phone; primitive specced in
  [branch-navigator → Mobile expression](./branch-navigator/branch-navigator.md#mobile-expression).
- **Status pill on phone** is icon-only (the desktop label
  `reasoning…` doesn't fit narrow chrome). Tap reveals current
  phase plus cancel in a Popover anchored to the pill per
  [touch.md → Status pill on phone](../../foundations/mobile/touch.md#status-pill-on-phone).
  Same cancel-pipeline flow as desktop.
- **Browse rail not visible in-place on phone.** Phone width is a
  strict subset of the existing viewport-forced-collapse threshold
  (~900 px), and the right-edge strip — a desktop-shaped folded-
  rail affordance — translates poorly to phone (right-edge trigger
  → bottom-anchored sheet creates a directional mismatch). On
  phone the rail column is hidden; **the `[☰ Browse]` chip in
  the chip strip is the trigger** — bottom-anchored chip opens
  the rail's content as a bottom Sheet. Tier-aware per
  [collapse.md → Reader / composer](../../foundations/mobile/collapse.md#reader--composer-narrative--rail--narrative--rail-strip):
  desktop / tablet keep the right-edge strip and expand the rail
  in place; **phone uses the chip and a Sheet (bottom, medium
  initial)**.
- **Rail-as-sheet contents.** Full rail vocabulary — category
  dropdown, filter chips, search, row list, Import affordance.
  Tap a row inside the sheet → sheet swaps to peek view (height
  may grow to tall ~85–95 % per the
  [Peek drawer mapping](../../foundations/mobile/layout.md#mapping--desktop-to-mobile)).
  Single sheet, content state-swap; not Sheet over Sheet (which
  is disallowed per
  [layout.md → Stacking](../../foundations/mobile/layout.md#stacking)).
  In peek state, the sheet head shows an **icon-only `←`** back
  affordance at the top-left — replaces the desktop `×` (which
  is desktop chrome; sheets dismiss via handle / backdrop, not
  an X). The arrow is the universal back affordance, no text
  label needed; the head uses flex-start so entity meta sits
  close after the arrow. Tap returns to row-list state. Peek's `Open in panel →` link dismisses the
  sheet and routes to World / Plot per the cross-surface nav
  model. Drag-down on the handle, or backdrop tap, dismisses the
  whole sheet regardless of state.
- **Peek-rail mutual exclusion** (per
  [Peek drawer — peek implies rail open](#peek-drawer--peek-implies-rail-open))
  holds on phone — peek is reachable only via row-tap inside the
  rail-as-sheet, never independently. The desktop "collapse
  closes peek" rule maps to "drag-down dismisses sheet
  regardless of state."
- **Composer keyboard handling.** `KeyboardAvoidingView` per
  [platform.md → Keyboard avoidance](../../foundations/mobile/platform.md#keyboard-avoidance)
  reflows narrative and composer above the soft keyboard. The
  narrative scroll view shrinks; latest entry stays at the top of
  the visible scroll region per the existing scroll-behavior
  rule. Composer textarea sits directly above the keyboard; send
  button and mode picker remain visible. Suggestion panel moves
  up with the composer (it's content, not chrome).
- **Per-entry action icons** stay always-visible-muted per the
  [icon-actions visibility rule](../../patterns/icon-actions.md#visibility--always-rendered-muted-default-brighten-on-hover);
  no tier-specific change. Touch users see the icons at the muted
  default; taps trigger normally.
- **Modals stay Modal all tiers** — branch creation, rollback
  confirm, era flip, chapter close. Per the layout binding table.
- **Stack-aware Return.** The chrome `←`, Android `BackHandler`,
  and iOS swipe-back all bind to stack-aware Return per
  [navigation.md → Stack-aware Return on mobile](../../foundations/mobile/navigation.md#stack-aware-return-on-mobile).
  Empty-stack-confirm is Android-relevant primarily per
  [platform.md → OS back integration](../../foundations/mobile/platform.md#os-back-integration).
- **Safe areas.** Top-bar honors `insets.top`; composer and send
  button area honor `insets.bottom`; narrative scroll extends
  edge-to-edge but its visible end-of-scroll respects the bottom
  inset per
  [platform.md → Safe areas](../../foundations/mobile/platform.md#safe-areas).

Design rationale and adversarial findings in
[`explorations/2026-05-01-mobile-group-b-reading-flow.md`](../../../explorations/2026-05-01-mobile-group-b-reading-flow.md).

## Screen-specific notes

- Title max-width capped at 320px with ellipsis + tooltip; keeps long
  titles from blowing out the header.
- Progress strip is **always visible**, color-graded by threshold.
- Suggestions panel appears between entries and composer (below the
  last entry, above the composer).
- Clicking a suggestion fills composer text + sets mode=`Free`.
- Entry hover reveals per-entry action icons at full opacity (they
  exist at 55% by default).
- Chapter break inline separators are minimalist (thin rule + chapter
  label + time at close).
- Per-chapter in-world time shows as a range in the popover (closed
  chapters) or "since <time>" (current chapter).
