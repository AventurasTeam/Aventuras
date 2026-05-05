# Icon actions

Visual + interaction pattern for **discrete actions associated
with a row** in a list, rendered as icon buttons rather than text
labels. App-wide convention — every surface that exposes
per-row actions follows it.

Used by:

- [Reader per-entry actions](../screens/reader-composer/reader-composer.md#per-entry-actions)
  (edit / regen / branch / delete / 📅 flip-era on each story entry)
- [Branch navigator row actions](../screens/reader-composer/branch-navigator/branch-navigator.md#row-actions--inline-icons)
  (rename / delete on each branch row)
- [Story Settings · Era flips on this branch](../screens/story-settings/story-settings.md#era-flips-on-this-branch)
  (delete on each flip row)
- [Chapter Timeline per-card actions](../screens/chapter-timeline/chapter-timeline.md#per-card-actions)
  (edit / re-run cadence / etc. per chapter card)
- [Rollback-confirm hover-preview row icons](../screens/reader-composer/rollback-confirm/rollback-confirm.md#hover-preview--pre-click)
  (entry-row affordances inside the rollback confirmation modal)
- [Wizard cast / lore row actions](../screens/wizard/wizard.md)
  (✕ delete on each cast or lore row; ⭐ set-as-lead on character
  rows; ✨ AI-assist triggers at field labels)
- [Vault calendar card affordances](../screens/vault/calendars/calendars.md#calendar-card)
  (★ favorite toggle on each card; `⭐ default` badge on the card
  matching the app default)
- [Story list pin star](../screens/story-list/story-list.md#story-card--text-first)
  (☆/★ pin toggle inline before each story-card title — applies
  the visibility rule via existing muted-opacity, brighten-on-hover
  styling)

Future row-shaped surfaces with per-row actions follow the same
pattern.

## Visibility — always rendered, color-tiered, brighten on hover

- **Always rendered**, not hover-to-reveal. Findability is
  preserved regardless of input device or accessibility tooling.
- **Receded default color** — icons render in `text-fg-secondary`
  (a softer color slot than the row's primary text). Visible but
  visually receded so they don't compete with the row's primary
  content.
- **Brighten to `text-fg-primary`** on row hover/focus (desktop)
  via `group-hover:` / `group-focus-visible:`, with a quick
  transition (~120ms). Hovering an individual icon additionally
  surfaces its own affordance (`bg-tint-hover` background;
  destructive icons shift to `text-danger`).
- **Same affordance on desktop and mobile.** Touch has no hover
  state, so mobile sits at the receded color; taps trigger
  normally. The brightening is a desktop confirmation cue, not a
  load-bearing affordance — touch users can still see and tap the
  icons at the receded color.

The alternative — hover-reveal on desktop, persistent on mobile —
was considered and rejected. Inconsistent cross-device behavior
costs more than the small visual weight saved by hiding muted
icons on desktop.

### Why color tiers, not opacity tiers

An earlier draft of this pattern specified opacity-based muting
(~0.35–0.40 default, 1.0 on hover). Two problems surfaced when
the IconAction primitive was implemented and reviewed:

1. **NativeWind opacity isn't hover-composable.** Opacity is
   extracted to a style prop via `cssInterop` rather than emitted
   as a CSS class, so `hover:opacity-100` and
   `group-hover:opacity-100` never fire through CSS-driven hover
   state. Background-color hover modifiers work because `bg-*`
   stays a regular class with a `:hover` selector; opacity does
   not. Routing opacity through JS-tracked hover state via
   `Pressable.onHoverIn` is possible but adds rendering churn for
   a purely visual cue.
2. **Opacity-muted-active and color-muted-disabled collide
   visually.** `text-fg-primary` rendered at 40% opacity reads as
   roughly the same midpoint grey as `text-fg-muted` at 100%
   opacity, so a disabled-vs-enabled side-by-side comparison
   looks identical when one uses opacity and the other uses
   color. The two muting axes cancel.

Color-tiered muting (three slots: `--fg-primary` /
`--fg-secondary` / `--fg-muted`) sidesteps both problems. Tiers
compose cleanly with `:hover` / `:group-hover` modifiers, give a
genuine three-step visual hierarchy, and degrade gracefully on
touch where hover is absent — disabled remains visibly different
from enabled because the color slot differs, not because the
hover state can't fire.

## Glyph vocabulary

A small shared semantic mapping. The same glyph means the same
action everywhere it appears.

| Action        | Glyph | Use cases                                                                                                |
| ------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| edit / rename | `✎`   | Edit entry content (reader); rename branch (navigator).                                                  |
| regenerate    | `↻`   | Regenerate this AI reply (reader).                                                                       |
| branch        | `⎇`   | Branch from this entry (reader).                                                                         |
| delete        | `×`   | Delete entry (reader); delete branch (navigator); delete era flip (Story Settings · Calendar flip-list). |
| flip era      | `📅`  | Flip era from this entry (reader, conditional on `eras !== null`).                                       |

Glyphs above are wireframe placeholders; the consistent **semantic
mapping** is what matters now and what extends as new actions
emerge. Visual identity (session 5) picked the canonical Lucide
names for this scratch table — see
[`foundations/iconography.md → Per-entry actions`](../foundations/iconography.md#per-entry-actions).
Wireframes continue to render the scratch glyphs above per the
[wireframe-authoring rule](../../conventions.md#wireframe-authoring);
the iconography table is the implementation reference.

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
