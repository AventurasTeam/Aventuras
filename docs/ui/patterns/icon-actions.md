# Icon actions

Visual + interaction pattern for **discrete actions associated
with a row** in a list, rendered as icon buttons rather than text
labels. App-wide convention — every surface that exposes
per-row actions follows it.

Used by:

- [Reader per-entry actions](../screens/reader-composer/reader-composer.md#per-entry-actions)
  (edit / regen / branch / delete on each story entry)
- [Branch navigator row actions](../screens/reader-composer/branch-navigator/branch-navigator.md#row-actions--inline-icons)
  (rename / delete on each branch row)

Future row-shaped surfaces with per-row actions follow the same
pattern.

## Visibility — always rendered, muted default, brighten on hover

- **Always rendered**, not hover-to-reveal. Findability is
  preserved regardless of input device or accessibility tooling.
- **Muted default opacity** (~0.35–0.40). Icons are present but
  visually receded so they don't compete with the row's primary
  content.
- **Brighten to full opacity** on row hover/focus (desktop), with
  a quick transition (~120ms). Hovering an individual icon
  additionally surfaces its own affordance (background tint;
  destructive icons may shift color too).
- **Same affordance on desktop and mobile.** Touch has no hover
  state, so mobile sits at the muted default; taps trigger
  normally. The brightening is a desktop confirmation cue, not a
  load-bearing affordance — touch users can still see and tap the
  icons at muted opacity.

The alternative — hover-reveal on desktop, persistent on mobile —
was considered and rejected. Inconsistent cross-device behavior
costs more than the small visual weight saved by hiding muted
icons on desktop.

## Glyph vocabulary

A small shared semantic mapping. The same glyph means the same
action everywhere it appears.

| Action        | Glyph | Use cases                                               |
| ------------- | ----- | ------------------------------------------------------- |
| edit / rename | `✎`   | Edit entry content (reader); rename branch (navigator). |
| regenerate    | `↻`   | Regenerate this AI reply (reader).                      |
| branch        | `⎇`   | Branch from this entry (reader).                        |
| delete        | `×`   | Delete entry (reader); delete branch (navigator).       |

Glyphs are placeholders pending the visual identity session; the
consistent **semantic mapping** is what matters now and what
extends as new actions emerge.

## Disabled vs hidden

Two ways an action can be unavailable on a given row, with
different defaults:

- **Hidden** is preferred when the affordance is **structurally
  not applicable** to that row (e.g. branch-navigator hides
  `delete` on the root branch and on the current branch — those
  rows can't be deleted by definition). Keeps the row visually
  clean.
- **Disabled (greyed, no hover-brighten, tooltip explains)** is
  preferred when the affordance is **temporarily unavailable**
  (e.g. per-entry `branch` action while a generation is
  in flight — see
  [branch-navigator → during generation](../screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked)).
  Tells the user "this normally works, just not right now."

## When NOT to use this pattern

- **Top-bar essentials** (Settings gear, Return arrow, Actions
  icon) — chrome, not row actions. Always-visible at full
  opacity, no muted state. Their own conventions live in
  [`principles.md → Top-bar design rule`](../principles.md#top-bar-design-rule).
- **Dismissal affordances** (modal `×`, drawer grab handle,
  popover `×`) — these close a surface; they aren't row actions.
- **Interactive content indicators** (e.g. the brain icon on AI
  entries that pulses while reasoning streams and toggles
  expansion on click) — these surface state about the content
  itself rather than offering an action against the row.
- **System-entry content-level buttons** (`Retry` / `Details` /
  `Dismiss`) — text labels by design, not part of this pattern.

The pattern is specifically about **discrete actions associated
with a row in a list**.
