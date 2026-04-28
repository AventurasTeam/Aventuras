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
`settings.worldTimeOrigin` — a `TierTuple` keyed by the active
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
  name. Click sets `stories.settings.leadEntityId` to this entity;
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
