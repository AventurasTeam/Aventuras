# Layout primitives

Canonical layout-primitive vocabulary for Aventuras. Every overlay
or sliding surface in the app — chapter chip popover, Actions
menu, peek drawer, rollback confirm, the wizard, and so on — maps
to exactly one of the four primitives below: Popover, Modal,
Sheet, Full-screen route.

This file is session 3 of the mobile-foundations multi-session pass
(per [`./README.md → Sessions`](./README.md#sessions)). Sister to
[`./responsive.md`](./responsive.md) (tier boundaries) and
[`./navigation.md`](./navigation.md) (chrome layers).

## What this contract pins

- **Four primitives** — Popover, Modal, Sheet, Full-screen route.
  Closed set for v1; open to extension if a future surface
  genuinely needs a fifth.
- **Sheet consolidates `drawer` and `bottom sheet`** — one
  primitive with anchor variants (right, bottom) and height
  variants (short, medium, tall). The existing project term
  `peek drawer` becomes a named usage of Sheet rather than its
  own primitive; the pre-foundations `bottom drawer` term in
  `branch-navigator.md` was reconciled to Sheet (bottom, short)
  vocabulary in Group B (session 7) — same primitive, foundations
  vocabulary.
- **Decision tree for picking a primitive** keys on the
  user-intent question: focus-demanding vs browse-and-pick vs
  rich-detail vs navigable-destination.
- **Desktop-to-mobile mapping rules** make explicit when a
  desktop popover becomes a phone Sheet, when a desktop modal
  stays a modal, when a peek drawer becomes a tall Sheet.
- **No new tokens or styling rules.** Sheets and Modals consume
  the existing depth metaphor (pure flat,
  [`../spacing.md → Depth metaphor`](../spacing.md#depth-metaphor)),
  padding tokens, radii tokens, motion durations.

## The four primitives

### Popover

Anchored to a trigger element. Small content (≤ ~200px tall,
informal limit). No scrim. Transient — dismisses on tap-outside,
Esc key, or trigger re-tap. No drag-to-dismiss.

**Use when**: a small menu, picker, tooltip, or inline status
display should anchor visually to its trigger and not interrupt
the parent surface.

**Examples**: time-chip popover (in-world time detail), tooltips,
help icons, search-help popover. (The chapter chip's dropdown
content is large enough to fall outside this category — see
mapping table below.)

### Modal

Centered. Scrim behind. Focus-demanding — the user must confirm
or cancel. Tap-outside dismiss is gated by the modal's own action
set rather than free dismissal. Same expression on every tier.

**Use when**: a confirmation, alert, or short focused form
interrupts the user's flow and demands resolution before
proceeding.

**Examples**: rollback-confirm, branch creation, calendar swap
warnings, save-session navigate-away guard.

**Long / multi-step content**, when encountered, becomes a
**full-screen route on phone** rather than a Modal — phone
Modal-with-form is awkward at the keyboard-open viewport heights.
No such content exists at v1 today; rule is forward-looking.

### Sheet

Edge-anchored sliding panel. Scrim. Draggable. Dismissible by
swipe-toward-edge, tap-outside, or close affordance. Anchor and
height vary by surface.

**Anchor variants**:

- **Bottom** — phone primary. Sheet slides up from the bottom
  edge; drag-down dismisses.
- **Right** — desktop primary. Slides in from right at ~440px
  width (matches reader peek drawer width per the existing spec).

(Left and top anchors not used in v1.)

**Height variants** (bottom-anchored on phone):

- **Short** (~30% viewport, content-fit). Actions menu, branch
  nav, short pickers.
- **Medium** (~50–60% viewport). Chapter popover content on phone,
  calendar picker, multi-row pickers.
- **Tall** (~85–95% viewport). Peek drawer on phone, raw JSON
  viewer on phone, rich detail content. Top edge of the parent
  surface remains visible (~10–20px) so the sheet reads as overlay
  rather than destination.

Right-anchored sheets on desktop are a single ~440px-wide
expression; height fills the available viewport region under the
top bar.

**Use when**: rich content needs to overlay the parent surface
without taking the user fully away from it. Sheet's drag-dismiss
preserves the overlay-ness — distinct from a full-screen route's
navigate-away semantics.

**Examples**: peek drawer (right desktop, tall bottom phone),
Actions menu on phone, chapter popover content on phone, branch
nav on phone, raw JSON viewer.

### Full-screen route

Navigable destination with own back affordance. Standard
navigation. No swipe-dismiss. Parent surface enters the navigation
stack rather than remaining alive behind.

**Use when**: the destination has internal navigation
(sub-screens, categories), is multi-step (must not accidentally
dismiss mid-flow), or is genuinely a separate piece of the app
rather than an overlay over the current piece.

**Examples**: wizard, onboarding, Story Settings on phone (per
session 2's settings routing — internal categories), World / Plot
/ Chapter Timeline (these are top-level surfaces; mentioning here
because they happen to fit the route shape behaviorally).

## Decision tree

Pick the primitive by walking these questions:

1. **Is the user being interrupted to confirm or cancel?** →
   **Modal**. Centered, all tiers. Long / multi-step content →
   full-screen route on phone (rare).

2. **Is this a menu, picker, or selection list?**
   - Desktop: → **Popover** (anchored to trigger).
   - Phone:
     - Tiny (≤ 200px content) and fits viewport with margin? →
       **Popover** (same as desktop).
     - Larger? → **Sheet** (bottom, height = short / medium per
       content).

3. **Is this rich detail of a thing** (entity overview, lore
   detail, raw JSON dump)?
   - Desktop: → **Sheet** (right-anchored, ~440px).
   - Phone: → **Sheet** (bottom-anchored, tall ~95%).

4. **Is this a navigable destination with internal navigation,
   multi-step content, or no-accidental-dismiss requirements?** →
   **Full-screen route** (all tiers).

The sheet-vs-route distinction at full-cover heights matters:
sheet's swipe-dismiss preserves "I'm overlaying the parent" feel,
while route's standard back-action signals "I navigated to a new
destination." Has-internal-nav → route; flat-content even when
rich → sheet. Peek drawer (one entity's overview, no inner stack)
is flat → sheet. Story Settings (categories, sub-screens) has
inner nav → route.

## Mapping — desktop to mobile

| Desktop                  | Phone                     | Tablet            |
| ------------------------ | ------------------------- | ----------------- |
| Popover (rich content)   | Sheet (bottom, medium)    | Popover           |
| Popover (tiny content)   | Popover                   | Popover           |
| Modal (short)            | Modal                     | Modal             |
| Modal (long, multi-step) | Full-screen route         | Modal             |
| Peek drawer (right ~440) | Sheet (bottom, tall ~95%) | Peek drawer       |
| Right-anchored drawer    | Sheet (bottom, tall ~95%) | As desktop        |
| Full-screen route        | Full-screen route         | Full-screen route |
| Modal-over-Sheet         | Modal-over-Sheet          | Modal-over-Sheet  |

Tablet inherits desktop expressions across the board (consistent
with [`./navigation.md → Top-bar shape across tiers`](./navigation.md#top-bar-shape-across-tiers)
on tablet inheriting desktop chrome).

## Stacking

- **Modal over Sheet**: allowed but rare. Use case: a
  confirm-action initiated from inside a Sheet (delete-this-branch
  confirm inside the branch nav sheet). Backdrop scrim stacks; the
  Sheet stays visible behind the Modal.
- **Sheet over Sheet**: not allowed. If a Sheet's content needs
  to lead somewhere richer, the Sheet dismisses and the new
  surface (full-screen route or Modal) takes over.
- **Popover over anything**: popovers anchor to chrome elements;
  they fire over a Sheet or Modal when their trigger is visible.
  Rare in practice — most chrome triggers are hidden behind a
  Sheet / Modal scrim.
- **Full-screen route from a Sheet**: dismiss the Sheet first,
  then navigate. Stack-aware Return remembers the user came from
  the Sheet's parent surface, not from the Sheet itself.

## Sheet behavior — additional rules

- **Drag handle.** Bottom-anchored sheets render a small drag
  handle (~32px wide, 4px tall, centered, muted color) at the top
  edge. Visual cue that the sheet is draggable. Right-anchored
  desktop sheets do not show a drag handle — desktop dismissal is
  via close button or tap-outside.
- **Drag-down dismisses** when dragged past ~40% of visible sheet
  height. iOS / Android platform conventions may refine this
  threshold; session 6 (platform) resolves implementation
  specifics.
- **Tap-outside dismisses** for both anchor variants. The visible
  parent surface (top edge for tall bottom sheet; area outside the
  ~440px right strip on desktop) is tappable.
- **Scrim opacity** matches existing tokens
  (`rgba(0, 0, 0, 0.4)` light / `0.6` dark per
  [`../spacing.md → Depth metaphor`](../spacing.md#depth-metaphor)).
- **In-edit dismissal** triggers the save-session navigate-away
  guard per
  [`../../patterns/save-sessions.md → Navigate-away guard`](../../patterns/save-sessions.md).
  Mobile inherits.
- **Keyboard interaction** — sheets and modals trap Tab focus.
  Esc dismisses (desktop); on mobile, system back / swipe-back
  triggers stack-aware Return which dismisses the sheet (per
  [`./navigation.md → Stack-aware Return on mobile`](./navigation.md#stack-aware-return-on-mobile)).

## Container conventions

- **Padding** — `--row-py-*` / `--row-px-*` for sheet rows,
  `--control-h-*` for sheet inputs (per
  [`../spacing.md → Component-internal sizing tokens — density-aware`](../spacing.md#component-internal-sizing-tokens--density-aware)).
- **Radii** — Sheet top corners use `--radius-lg` (12px) when
  bottom-anchored. Modal corners use `--radius-md` (8px) all
  around. Sheet right-anchored on desktop uses `--radius-lg` on
  the left edge (top-left, bottom-left).
- **Depth** — pure flat per
  [`../spacing.md → Depth metaphor`](../spacing.md#depth-metaphor).
  No shadow tokens. Modals and Sheets use `--bg-overlay` plus
  `--border-strong` outline plus the fixed scrim. Popovers use
  `--bg-overlay` plus `--border` (no scrim).
- **Tap-target / hit area** — drag handles inherit native
  tap-target conventions per
  [`../spacing.md → Tap-target on native`](../spacing.md#tap-target-on-native).

## Surface bindings — existing app surfaces

Reference table for session-7 retrofits. Each existing surface
binds to one primitive:

| Surface                          | Primitive (desktop) | Primitive (phone)         | Notes                                                      |
| -------------------------------- | ------------------- | ------------------------- | ---------------------------------------------------------- |
| Chapter chip popover (reader)    | Popover             | Sheet (medium)            | Multi-row content; exceeds tiny limit                      |
| Time-chip popover                | Popover             | Popover                   | Tiny content                                               |
| Actions menu (`⚲`)               | Popover             | Sheet (short)             | Edge-clipping risk on phone → Sheet                        |
| Branch chip popover (`⎇`)        | Popover             | Sheet (short)             | Was "bottom drawer" pre-foundations; reconciled in Group B |
| Branch creation                  | Modal               | Modal                     | Pre-foundations: "creation modal is unchanged on mobile"   |
| Rollback confirm                 | Modal               | Modal                     | Pre-foundations: "modal renders identically on mobile"     |
| Calendar swap warnings           | Modal               | Modal                     | Per `patterns/calendar-picker.md`                          |
| Calendar picker                  | Popover             | Sheet (medium)            | Rich content (preset rows, summary panel)                  |
| Model picker dropdown            | Popover             | Sheet (medium)            | Per `app-settings.md` "popover-rendered, virtualized list" |
| Help / search-help popovers      | Popover             | Popover                   | Tiny content                                               |
| Peek drawer                      | Sheet (right ~440)  | Sheet (bottom, tall ~95%) | Project-specific named usage                               |
| Raw JSON viewer                  | Sheet (right ~440)  | Sheet (bottom, tall ~95%) | Matches peek drawer pattern                                |
| Story Settings (from in-story)   | Regular surface     | Full-screen route         | Has internal navigation (categories)                       |
| Wizard, onboarding               | Full-screen route   | Full-screen route         | Multi-step; no swipe-dismiss                               |
| Save-session navigate-away guard | Modal               | Modal                     | Standard modal usage                                       |

This table is documentation for retrofits, not a runtime spec —
session 7's per-screen passes cite these bindings.

## Pre-foundations naming

Existing project terms are preserved where they're load-bearing:

- **`peek drawer`** — kept as the named usage of Sheet for entity-
  overview content. Save-session quick-edit exception, lead-
  affordance, "Open in panel" link — all attach to the named
  usage.
- **`popover`** — kept as the primitive name. Existing references
  remain valid.
- **`modal`** — kept as the primitive name. Existing references
  remain valid.
- **`bottom drawer`** — was used in
  [`branch-navigator.md`](../../screens/reader-composer/branch-navigator/branch-navigator.md#mobile-expression)
  pre-foundations; reconciled to "Sheet (bottom, short)" in
  Group B (session 7) — same primitive, foundations vocabulary.
- **`right-anchored drawer`** — used in
  [`../../patterns/data.md`](../../patterns/data.md) for the raw
  JSON viewer — refers to the same primitive as a right-anchored
  Sheet. Same session-7-retrofit posture.

## What this contract does NOT pin

Bundles with later sessions:

- **Sheet drag-dismiss threshold per platform** (iOS vs Android
  conventions) — session 6 (platform).
- **Touch-grammar specifics** for drag handles (gesture velocity,
  resistance feel) — session 5 (touch grammar).
- **Sheet library choice** for RN implementation
  (`@gorhom/bottom-sheet` vs alternatives) — bundles with session
  7's first per-screen retrofit that needs a Sheet.
