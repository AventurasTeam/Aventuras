# Chapter Timeline

**Wireframe:** [`chapter-timeline.html`](./chapter-timeline.html) — interactive

The dedicated chapter management surface. Reached from the reader's
top-bar chapter popover via the `Manage chapters →` link.

The reader's chapter popover handles **glance + jump + simple
close**. This screen handles everything richer: viewing the
LLM-generated metadata (summary, theme, keywords), editing it,
closing the current chapter with explicit end-entry picking, and
deleting a chapter (which routes through rollback).

Cross-cutting principles that govern this screen are in
[principles.md](../../principles.md). Relevant sections:

- [Save-session pattern](../../patterns/save-sessions.md) — per-card
  edit session, navigate-away guard fires when expanding another
  card with unsaved changes.
- [Icon-actions pattern](../../patterns/icon-actions.md) — for
  per-row edit affordances.

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ [logo] Aria's Descent / Chapters     [⎇] [←]                │ ← simplified top-bar
├────────────────────────────────────────────────────────────┤
│ Chapters · 4 closed + 1 in progress                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Chapter 1 — The Tavern Encounter           ▸           │   │ ← collapsed card
│  │ Day 1 · 8.4k tok · arrival, mystery                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Chapter 2 — The Trail North               ▾           │   │ ← expanded card
│  │ Day 2–3 · 12.1k tok · travel, conflict                 │   │
│  │ ────                                                    │   │
│  │ Title:   [The Trail North           ]                  │   │
│  │ Theme:   [travel, conflict          ]                  │   │
│  │ Summary: [textarea, ~3 lines visible]                  │   │
│  │ Keywords: [chip] [chip] [chip] +                       │   │
│  │                                                         │   │
│  │ [Jump to chapter →]  [Regenerate summary]  [Delete…]   │   │
│  │ ┌─ save bar (when dirty) ──────────────────────────┐   │   │
│  │ │ 2 unsaved changes      [Discard]  [Save ⌘S]      │   │   │
│  │ └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Chapter 3 — The Warden's Bargain            ▸          │   │
│  │ Day 4–6 · 16.0k tok · betrayal, oath                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Chapter 4 — Across the Pass                ▸          │   │
│  │ Day 7–8 · 11.2k tok · escape, refuge                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ── In progress · since Day 9 ──                        │   │ ← specialized card
│  │ <title generates on close>                             │   │
│  │ 14.2k / 24k tok  ▓▓▓▓▓▓▓▓░░░░  59%                     │   │
│  │ <summary generates on close>                           │   │
│  │                                                         │   │
│  │ [Close chapter…]                                        │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

Vertical timeline of cards stacked top-to-bottom, ordered by
`sequence_number` ascending. The in-progress chapter renders as a
specialized last card (no DB row exists for it yet — see
[data-model → Chapters / memory system](../../../data-model.md#chapters--memory-system)).

## Per-chapter card

### Collapsed state

Default state for non-active cards. Single row showing:

- **Number + title** — `Chapter <N> — <title>` with a `▸`
  expand-disclosure on the right.
- **Compact metadata line** — `<time range> · <token count> ·
<theme>`. Theme renders as plain text, comma-separated; not chips.

Click anywhere on the card body → expand. Same row click on an
already-expanded card → collapse.

### Expanded state

The full editor. **One card expanded at a time** — expanding
another card with the current one dirty fires the
[navigate-away guard](../../patterns/save-sessions.md#navigate-away-guard--global-intercept)
(Save / Discard / Cancel).

Editable fields (zod-validated; types per
[data-model → chapters](../../../data-model.md)):

- **Title** (`title`) — single-line text input.
- **Theme** (`theme`) — single-line text input. Free-form short
  thematic tag.
- **Summary** (`summary`) — multi-line textarea, 4–6 visible rows.
  This is the load-bearing field; gets the most space.
- **Keywords** (`keywords`) — chip editor. Add new chip via inline
  input; remove via per-chip `×`. Keywords drive retrieval / LLM
  injection per the data-model.

Read-only context shown alongside (not part of the form):

- **Time range** — `<start time> – <end time>` formatted via the
  active calendar formatter.
- **Token count** — accumulated `token_count` across the chapter.
- **Closed at** — wall-clock `closed_at` timestamp, muted small.
- **Entry range** — `start_entry_id` → `end_entry_id`, displayed as
  entry numbers (e.g. `entries 12–34`).

### Per-card actions

Three buttons in a row beneath the form, before the save bar:

- **Jump to chapter →** — routes back to the reader scrolled to the
  chapter's start entry. The reader's chapter chip would highlight
  the same chapter on arrival. No state mutation.
- **Regenerate summary** — re-runs only the LLM metadata-generation
  step (title / summary / theme / keywords) on the chapter's
  existing range. Idempotent for the metadata layer; does NOT
  re-run lore-management or memory compaction (those are destructive
  re-applications and out of scope for v1 — see
  [open questions](#screen-specific-open-questions)). Confirm modal
  warns "this overwrites the current title/summary/theme/keywords."
- **Delete…** — destructive. Opens the
  [rollback-confirm modal](../reader-composer/rollback-confirm/rollback-confirm.md)
  pre-targeted at the chapter's `start_entry_id`. Deleting the
  chapter means rolling back to before the chapter's start; the
  rollback flow already handles cascade + cross-chapter warnings.

### Save session — per card

Each card is its own
[save session](../../patterns/save-sessions.md). First field edit
opens the session; the in-card save bar appears at the card's
bottom edge (`Discard` / `Save` per the pattern). Save commits all
session changes under one `action_id`; CTRL-Z reverses the entire
edit.

In-card save bar (vs screen-bottom): each chapter is a self-
contained edit surface, so the save bar belongs with the card it
applies to. If a user scrolls away from a dirty card, scrolling
back is the way to commit — there's no global "save dirty card"
chrome at the screen edge.

## In-progress chapter card

The current open region renders as a specialized last card. No DB
row exists for it (per data-model: chapters are persisted only on
close), so most fields are placeholders.

Rendered:

- **Title row** — `── In progress · since <start time> ──` (no
  chapter number; the next number lands at close).
- **Token progress** — `<current> / <threshold> tok` plus a thin
  progress bar. Color-graded per the same thresholds the reader's
  top-strip uses (per
  [reader-composer → Top-bar chapter navigation](../reader-composer/reader-composer.md#top-bar--chapter-navigation)):
  green < 80%, yellow 80–90%, red ≥ 90%.
- **Summary placeholder** — italic muted "summary generates on
  close."
- **Action: Close chapter…** — primary button. Opens the
  [chapter-close modal](#chapter-close-modal) below.

The card is not expandable / editable — there's nothing to edit
yet. Once the user closes the chapter, the in-progress card is
replaced by a new closed-chapter card at the bottom of the
timeline, expanded by default so the user can review (and edit, if
they want to override) the LLM-generated metadata.

## Chapter-close modal

Triggered from two places: this screen's `Close chapter…` button
**and** the reader's chapter popover `Close chapter manually`
button. Same modal, same shape — uniform UX.

```
┌──── Close current chapter? ──────────────────── × ─┐
│                                                      │
│  Closes the open chapter from entry 89 through       │
│  your chosen end entry. The AI generates title,      │
│  summary, theme, and keywords; lore management       │
│  and memory compaction run as part of the close.     │
│                                                      │
│  ── Start of chapter ──                              │
│  ┌────────────────────────────────────────────────┐ │
│  │ entry 89 [Chapter 4 ended here] "Aria sets…"   │ │
│  │                                Day 7 · 06:42   │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ── End of chapter ── (picker trigger, click to open)│
│  ┌────────────────────────────────────────────────┐ │
│  │ entry 102 [latest] "She stops at the threshol…"│ │
│  │                              Day 9 · 22:18  ▾  │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  14,200 tokens in range                              │
│                                                      │
│                [ Cancel ]  [ Close chapter ]         │
└──────────────────────────────────────────────────────┘
```

- **Width** ~480px. Centered. Backdrop dim.
- **Title** — `Close current chapter?` Entry-agnostic on purpose:
  the user picks the end entry inside the modal, so naming a
  specific entry up front would be presumptuous of the default.
- **Body** — one-sentence framing + start-entry row + end-entry
  picker + live token count.
- **Foot** — `Cancel` (secondary) + `Close chapter` (primary, ink —
  this is constructive, not destructive). Esc and click-outside
  cancel.

### Entry-row anatomy (start row + picker trigger)

Both the start-of-chapter row and the **picker trigger** (the
always-visible button representing the current end pick) use the
same single-line shape:

```
[entry-num] [optional tag] [snippet — truncates with …]    [time]  [▾]
```

Fields, left-to-right:

- **Number** — `entry <N>` in muted monospace.
- **Optional tag** — small chip-style label when applicable
  (`Chapter <N> ended here` on the start row; `latest` on the
  picker trigger when the latest entry is selected).
- **Snippet** — first ~80 chars of `story_entries.content`,
  italicized. Single line; trailing ellipsis when truncated.
- **Time** — right-aligned. Formatted via the active calendar
  formatter (same formatter the reader's time chip uses).
- **Chevron** — picker trigger only. Rotates 180° when the panel
  is open.

Both rows render with the same border + padding so the start row
and picker trigger read as visually paired cards (start above,
end below).

### End-entry picker — dropdown panel

Default selection: the latest entry in the open region.

Clicking the picker trigger opens a dropdown panel **in-flow**
below it (the modal grows vertically; panel is scrollable when
more entries exist than fit in ~320px). Entries are listed
newest-first, back to the start of the open region.

Each dropdown item is a **two-line layout** (richer preview than
the single-line trigger):

```
[✓] entry-num [optional tag]                            [time]
"snippet wrapping to two lines via line-clamp; longer than the
trigger's single-line truncation; …"
```

- **Head row** — `✓` glyph (visible only on the selected row),
  entry-num, optional tag, time right-aligned.
- **Snippet row** — same first ~80 chars of entry content, but
  rendered with `line-clamp: 2` so up to two visual lines show
  before truncation. Gives the user a real read of each option,
  not a single-line tease.

Picking an entry:

1. Updates the trigger's snippet / number / tag / time.
2. Updates the modal's `tokens in range` line (live count for
   the new range).
3. Collapses the panel.

Why an explicit picker (vs a `close at latest` button): manual
chapter close is exactly the place users want to choose a natural
ending point (per
[data-model → Chapters / memory system](../../../data-model.md#chapters--memory-system):
"User can also manually trigger chapter-create at any time,
choosing the ending entry explicitly"). Latest-by-default covers
the common case; the picker covers the rest, and the
snippet + time are what make picking meaningful instead of
guesswork on bare numbers.

### Snippet origin

Snippet is the **first ~80 chars of `story_entries.content`** in
all surfaces (start row, picker trigger, dropdown items). One rule
across the modal — no end-of-entry / mid-entry variants. Same rule
also applies to the
[rollback-confirm modal's affected-entries display](../reader-composer/rollback-confirm/rollback-confirm.md).
The reader has the full text if a user wants more context; the
modals are scanning surfaces, not reading surfaces.

### Why a single shared modal

Both surfaces (this screen + reader popover) want the same close
flow. A shared modal:

- Keeps the start/end picker UX uniform regardless of trigger.
- Avoids drifting wording between two confirmation surfaces.
- Mirrors the
  [save-sessions navigate-away guard](../../patterns/save-sessions.md#navigate-away-guard--global-intercept)
  precedent — same modal, same copy across surfaces.

## Empty state

When the story has no closed chapters yet (entries 1..N all in the
open region), only the in-progress card renders. Header reads
`Chapters · 0 closed + 1 in progress`. The card itself works
normally — `Close chapter…` opens the modal with `Start: entry 1`
fixed.

## Top-bar

Simplified shape — same as Story Settings:

- Logo + breadcrumb (`<story-title> / Chapters`)
- Actions (⎇)
- Return (←) → back to reader

No status pill, no chapter chip ▾ (we're already managing
chapters), no progress strip, no time chip — those are reader-
specific chrome. The ⚙ Story Settings gear is also absent (it
points at a sibling screen; the Actions menu is the route there).

See
[followups → Top-bar shape on World and Plot](../../../followups.md#top-bar-shape-on-world-and-plot-panels)
for the parallel question on those panels.

## Screen-specific open questions

- **Re-run compaction / lore-mgmt for a closed chapter.** The
  Regenerate summary action only re-runs the metadata layer.
  Re-running lore-mgmt + memory compaction would overwrite
  consolidated state; that's destructive and gated on the
  long-deferred compaction philosophy work (see
  [followups → Top-K-by-salience retrieval](../../../followups.md#top-k-by-salience-retrieval--long-term-memory-implications)).
  Defer until the compaction session lands; the eventual answer
  will probably be "available, but only via an explicit
  consent-modal heavy enough that users don't fire it casually."
- **Bulk chapter operations.** Multi-select to delete or
  re-generate-summary multiple chapters at once. Defer; matches
  the
  [bulk operations on entities](../../../followups.md#bulk-operations-on-entities)
  followup which sets the precedent.
- **Chapter merging / splitting.** "Merge chapter 3 into chapter
  4" or "split chapter 5 at entry N" — both are user-visible
  structural ops the data model could support but the UX hasn't
  been thought through. Defer until a real demand surfaces.
- **In-progress card while generation is active.** During the
  reader's pipeline phases (reasoning / generating / classifying /
  chapter-close), the `Close chapter…` button on this screen
  should disable. Same rule as
  [branch-navigator → during generation](../reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked).
  Visual treatment TBD with the visual-identity pass.
- **Animation when the in-progress card transitions to closed.**
  After successful chapter close, the in-progress card morphs
  into a new closed card at the bottom of the timeline, plus a
  fresh in-progress card appears below it. Smooth transition vs
  hard re-render — visual identity pass.
