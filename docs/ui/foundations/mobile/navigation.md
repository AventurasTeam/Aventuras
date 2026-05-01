# Navigation paradigm

How mobile users move around the app. Pins top-bar shape across
tiers, the reader-only chip strip on phone, the cross-surface
navigation model (which inherits from desktop), and how the
existing stack-aware Return + Settings-icon scope rules carry over
to mobile.

This file is session 2 of the mobile-foundations multi-session pass
(per [`./README.md → Sessions`](./README.md#sessions)). Sister to
the [responsive contract](./responsive.md) — that file owns tier
boundaries and artifact strategy; this file owns chrome shape and
nav model.

## What this contract pins

- **Phone gets a slim single-row top bar plus a reader-only chip
  strip.** No bottom tabs, no left-side drawer. The eight-element
  desktop chrome is split vertically — icons + truncated title in
  the top bar, chapter/time/branch chips on a slim strip below.
- **Tablet inherits desktop chrome verbatim.** At 640–1023 px the
  full single-row top bar fits.
- **Cross-surface nav uses the desktop model on every tier.**
  Actions menu for direct surface jumps; right-rail Browse →
  peek → "Open in panel" for entity-level cross-surface. No
  phone-only nav mechanism added.
- **Stack-aware Return inherits unchanged** — the existing rule
  in [`../../principles.md → Stack-aware Return`](../../principles.md#stack-aware-return)
  already covers empty-stack-confirm before exit, which is the
  case mobile most needs (system back from a perceived-home
  surface).
- **Settings-icon scope inherits unchanged** — `⚙` for App
  Settings on app-level surfaces, `⛭` for Story Settings on
  in-story surfaces, App Settings reachable from in-story via
  Actions menu.

## Top-bar shape across tiers

### Phone (`< 640 px`)

Single-row top bar with icons + truncated title. Reader-only chip
strip below. Sub-screens get just the top bar (no chip strip; their
master-detail sub-header or breadcrumb does the location job).

```
Reader (phone):
  ┌─────────────────────────────────────────────────────┐
  │ [A] [Aria's Descent…]    [pill] [⛭] [⚲] [←]        │  ← top bar (~44 px)
  ├─────────────────────────────────────────────────────┤
  │ ▰▰▰▰▱▱▱▱▱▱▱                                          │  ← progress strip (~3 px)
  ├─────────────────────────────────────────────────────┤
  │ [Chap 3 ▾]  [Day 3 dusk ▾]  [⎇3]                    │  ← chip strip (~36 px)
  ├─────────────────────────────────────────────────────┤
  │                                                       │
  │  reader narrative + composer                          │
  │                                                       │
  └─────────────────────────────────────────────────────┘

Sub-screen (World, Plot, Timeline, Story Settings, phone):
  ┌─────────────────────────────────────────────────────┐
  │ [A] [Aria's Descent / World]  [pill] [⛭] [⚲] [←]   │
  ├─────────────────────────────────────────────────────┤
  │ ▰▰▰▰▱▱▱▱▱▱▱                                          │
  ├─────────────────────────────────────────────────────┤
  │ Characters / Kael                                     │  ← master-detail sub-header (World, Plot only)
  ├─────────────────────────────────────────────────────┤
  │ surface content                                       │
  └─────────────────────────────────────────────────────┘

App-level (story-list, Vault, App Settings, phone):
  ┌─────────────────────────────────────────────────────┐
  │ [A] [<screen breadcrumb>]            [⚙] [⚲] [←?]   │  ← `←` absent on root
  ├─────────────────────────────────────────────────────┤
  │ surface content                                       │
  └─────────────────────────────────────────────────────┘
```

### Tablet (`640–1023 px`)

Identical to desktop. Single-row top bar with chips inline (no
chip strip — chapter / time / branch chips render alongside the
title, same as desktop).

### Desktop (`≥ 1024 px`)

Unchanged. Existing chrome per
[`../../principles.md → Top-bar design rule`](../../principles.md#top-bar-design-rule).

## Reader chip strip (phone-only)

The reader's three reader-only chips migrate from inline-in-top-bar
(desktop) to a slim strip below the top bar (phone). Same
semantics, vertical layout instead of horizontal.

- **Always shown** when on the reader. No toggle, no persistency.
  Cost is ~36 px vertical; the chips carry context users actively
  reference while reading (chapter for jumps, time for in-world
  date awareness, branch for branch awareness).
- **Absent on sub-screens.** Sub-screens have either the
  master-detail sub-header (World, Plot) or the breadcrumb
  inline in the top bar (Story Settings, Chapter Timeline) —
  neither needs the chip strip.
- **Horizontally scrollable when overflowing.** All three chips
  expanded with full labels (`Day 3 dusk`, full chapter title)
  may overflow at 360-wide screens. Strip becomes horizontally
  scrollable as fallback. Per existing branch-chip rule, single-
  branch stories omit `[⎇]` from the strip — usually leaves
  enough room for chapter + time without scroll.
- **Strip starts a few pixels in from the screen edge.** Avoids
  conflict with iOS's swipe-from-left-edge back gesture; visual
  padding doubles as gesture safe-zone. Exact pixel offset is
  session 5 (touch grammar) territory.
- **Empty state.** If the story has no chapters yet (or the
  chapter / time chips would render empty), the strip is hidden
  entirely. Saves vertical space.

The desktop equivalent — chips inline in the top bar — is
unchanged. Tablet inherits the desktop expression. **Phone is the
only tier with the strip.**

## Title truncation on phone

The story title in the logo+title slot is the most likely overflow
at narrow widths (`Aria's Descent of the Crown's Bargain` doesn't
fit at 390 px alongside the icon group).

- **Single-line ellipsis truncation** when the title overflows.
  Standard text-overflow behavior; the title slot has a fixed
  max-width within the row.
- **Tap on the truncated title reveals the full title in a small
  popover** anchored to the title element. Popover dismisses on
  tap-outside or after a brief idle.
- **No persistency.** Popover is transient. No `app_settings`
  field, no localStorage, no expand/collapse state.
- **Sub-screen breadcrumbs follow standard text-ellipsis behavior**
  — head element (story title) truncates first; the popover
  affordance is reader-specific, not a general "expand chrome"
  mechanism.

This is the only tap-to-reveal in mobile chrome. Distinguishes it
from larger reveals (action menus, drawers, sheets) that all open
through different affordances and live in session 3's vocabulary.

## Cross-surface navigation model

Same model on every tier. Mobile inherits desktop without
modification.

- **Actions menu (`⚲`)** — direct surface jumps. Carries entries
  `Open World`, `Open Plot`, `Open Chapter Timeline`, `Open Story
Settings`, `Open App Settings`. Two taps total (open menu, pick
  destination).
- **Right-rail Browse → peek → "Open in panel"** — entity-level
  cross-surface for "I want to look up a specific character /
  thread / lore entry, maybe stay in reader, maybe jump to that
  panel." The rail's phone-tier collapsed form is **session 4**
  (collapse rule); session 2 commits the _model_ exists, not the
  rail's phone rendering.
- **Per-row "Open in panel →"** — peek drawers and entity rows
  carry the same Open-in-panel link they do on desktop. Routes
  to the appropriate surface with the row pre-selected.

No phone-only nav mechanism (no bottom tabs, no left drawer).
Cross-tier consistency: same nav vocabulary on every tier.

If post-v1 evidence shows phone users genuinely struggle with the
inherited model, a phone-only nav layer can be added without
foundations rewrite — chrome layers are additive.

## Stack-aware Return on mobile

Inherits from
[`../../principles.md → Stack-aware Return`](../../principles.md#stack-aware-return)
unchanged. The existing rule already covers:

- In-session-only stack, reset on app restart.
- Pop semantics: Return = pop one level (whichever sibling /
  parent the user came from).
- One-shot return targets (e.g. `Edit info` from story-list).
- **Empty stack: confirm dialog before terminating** — directly
  resolves the old-app pain of "system back from library exited
  the app silently."

On mobile, both the chrome `←` button and OS-level back actions
(Android hardware/gesture back, iOS swipe-back from left edge)
bind to the same stack-aware Return logic. Empty-stack confirm
fires regardless of which trigger fired the Return.

The implementation detail of binding OS back actions (`BackHandler`
on Android, swipe-back interception on iOS) is **session 6**
(platform) territory. Session 2 commits _that they're bound_; the
_how_ lands in session 6.

## Settings routing on mobile

Inherits from
[`../../principles.md → Settings icon scope`](../../principles.md#settings-icon-scope)
unchanged.

- **App-level surfaces** (story-list, Vault, App Settings,
  Onboarding) — `⚙` in top bar opens App Settings.
- **In-story surfaces** (Reader, World, Plot, Story Settings,
  Chapter Timeline) — `⛭` in top bar opens Story Settings.
  Absent on Story Settings itself (self-reference).
- **App Settings from in-story** — Actions menu entry.
- **Story Settings from story-list** — `⋯ → Edit info` boots
  the story and routes (per the existing one-shot return rule).

Glyphs (`⚙` / `⛭`) need to be glance-distinguishable per the
existing visual-identity constraint. At phone-tier 24 px icon size
both remain readable.

## Status pill on phone

The status pill (gen-state indicator, per the universal-in-story-
chrome rule) renders in the top-bar's right-aligned icon group
on phone. Auto-hides when idle, shows during pipeline phases.

The pill's desktop expression carries a text label
(`reasoning…`, `generating narrative…`). Phone's narrower top bar
doesn't accommodate the label — the pill renders icon-only on
phone, with **tap revealing the current phase + cancel popover**
(same flow as desktop, narrower expression).

The exact tap behavior + cancel-popover layout is **session 5**
(touch grammar) territory. Session 2 affirms the pill is
icon-only on phone; session 5 specs the tap interaction.

## Onboarding + wizard chrome on phone

Onboarding and the Story-creation wizard are full-screen takeovers
with minimal chrome (per their per-screen docs). They inherit the
phone-tier expression naturally — their existing chrome (typically
`←` + screen title + advance button) is already phone-friendly.
No mobile-specific treatment needed; their per-screen retrofits at
session 7 mostly do the responsive-toggle wiring rather than
chrome changes.
