# Reader / Composer

**Wireframe:** [`reader-composer.html`](./reader-composer.html) — interactive

The core screen. Entry list + composer + streaming AI reply. Right
rail for world-state Browse. Chapter navigation + in-world time in
the top-bar chrome. Next-turn suggestions between entries and
composer.

Cross-cutting principles that govern this screen are in
[principles.md](../../principles.md). Relevant sections:

- [Top-bar design rule](../../principles.md#top-bar-design-rule--essentials-vs-discretionary)
- [Composer mode — send-time transform](../../principles.md#composer-mode--send-time-transform-narration-aware)
- [Entity surfacing — three levels, same data](../../principles.md#entity-surfacing--three-levels-same-data)
  (Reader provides level 1 — Browse rail — and level 2 — peek drawer)
- [Entity row indicators — four channels](../../principles.md#entity-row-indicators--four-orthogonal-channels)
- [Browse filter chips + accordion grouping](../../principles.md#browse-filter-chips)

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ [logo] <title ✎> · Chapter ▾ · 🕒 time    [status][br][⎇][⚙][←]│ ← top bar
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
- **Close chapter manually** — primary action; triggers chapter-close
  sub-pipeline.
- **Manage chapters →** — link to the dedicated Chapter Timeline
  screen (inventory #9) for deeper chapter management.

Chapter closing is reachable from both the popover AND the Actions
menu.

## Top-bar — in-world time display

In-world time is rendered by a calendar formatter from the latest
entry's `metadata.worldTime` (integer base time units since story
start; seconds for the Earth calendar) plus the story's
`settings.worldTimeOrigin` (ISO 8601 Earth datetime that anchors the
elapsed units to a display calendar).

**v1 ships Earth calendar only.** Renderer:
`formatEarthTime(worldTime, worldTimeOrigin)` → "Day 12, Dusk" /
"March 5, 2026 09:42" depending on rendering style (TBD). Fictional
calendar systems are future-deferred replacement formatters over the
same integer (see
[followups.md](../../../followups.md#fictional-calendar-systems)).

**Surfaces:**

- **Top-bar time chip** — small clock icon + label, after the chapter
  chip. Always visible. Renders the formatter's output as opaque
  text. `max-width: 260px` with ellipsis on overflow; full label in
  tooltip.
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

## Per-entry actions

Actions on an individual entry (edit, regenerate, branch, delete)
render as **icon buttons** (not text labels), **always visible** (not
hover-to-reveal), with a muted default opacity that brightens on
hover/focus. Same affordance on desktop and mobile.

Icon set (placeholder glyphs; finalize with visual identity):

| Action | Glyph | Meaning                                |
| ------ | ----- | -------------------------------------- |
| edit   | ✎     | Edit entry content                     |
| regen  | ↻     | Regenerate this AI reply               |
| branch | ⎇     | Branch from this entry                 |
| delete | ×     | Delete this entry (rollback semantics) |

Per-entry action sets:

- **User entry:** edit, delete
- **AI entry:** edit, regen, branch, delete
- **System entry:** content-level buttons (Retry / Details / Dismiss)
- **Streaming entry:** no per-entry actions; cancel happens via the
  composer's Send→Cancel transform

## Reasoning expansion + token metadata on AI entries

Meta line is intentionally minimal. No model name — users don't care
per-entry. Format:

`AI reply  [🧠]  <reply-tok> / <reasoning-tok>`

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

## Browse rail — search scope

The rail's search input is **category-aware** — scope changes with
the active category in the dropdown:

- **Characters / locations / items / factions** (entity rows):
  `name`, `description`, `tags`
- **Lore**: `title`, `body`, `category`, `tags`
- **Threads**: `title`, `description`, `category`, `tags`
- **Happenings**: `title`, `description`, `category`, `tags`

Placeholder text reflects the active category (`Search characters…` /
`Search lore…` / etc.). Tooltip + ⓘ help icon list the full scope per
[principles → Search bar scope](../../principles.md#search-bar-scope).

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
