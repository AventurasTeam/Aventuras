# Touch grammar

How desktop interactions translate to touch. Pins the hover
replacement, gesture vocabulary, save bar behavior with the
keyboard, status pill tap, chip-strip safe zone, and the scope of
tooltips and keyboard shortcuts.

This file is session 5 of the mobile-foundations multi-session pass
(per [`./README.md → Sessions`](./README.md#sessions)). Sister to
[`./responsive.md`](./responsive.md),
[`./navigation.md`](./navigation.md),
[`./layout.md`](./layout.md), and
[`./collapse.md`](./collapse.md).

## What this contract pins

- **Minimal-translation philosophy.** Touch is a subset of desktop
  interactions, not a parallel rich-gesture vocabulary.
- **Hover-bound affordances translate to always-visible-muted.**
  Generalization of the
  [`patterns/icon-actions.md → Visibility`](../../patterns/icon-actions.md#visibility--always-rendered-muted-default-brighten-on-hover)
  rule.
- **No long-press for actions, no swipe-on-row, no
  pull-to-refresh.** Gesture vocabulary stays small.
- **Save bar on phone hides while keyboard is open**, reappears on
  field blur. Navigate-away guard remains active throughout.
- **Tap-to-tooltip on truncated inert chrome text** (story title,
  current breadcrumb segment) — narrowly scoped.
- **Status pill on phone** taps to a Popover with phase plus
  cancel.
- **Chip strip safe zone** of ~16 px from the screen's left edge
  to accommodate the iOS swipe-back gesture.
- **Tooltips and keyboard shortcuts are desktop-only.**
- **Breadcrumb tappability** is generalized in
  [`../../principles.md → Breadcrumb tappability`](../../principles.md)
  alongside this session.

## Hover translation

The
[`patterns/icon-actions.md → Visibility`](../../patterns/icon-actions.md#visibility--always-rendered-muted-default-brighten-on-hover)
rule (always-rendered-muted, brighten on hover/focus on desktop,
no hover state on touch) becomes the universal rule for any
"hover-revealed" affordance:

| Desktop                               | Touch                                          |
| ------------------------------------- | ---------------------------------------------- |
| Hover-brighten on icon-actions        | always-visible-muted (no brighten on touch)    |
| Hover-preview on rollback rows        | desktop-only; no touch fallback (taps trigger) |
| Hover tooltips                        | desktop-only; touch has no tooltip mechanism   |
| Hover-anywhere-else affordance reveal | always-visible-muted                           |

This generalizes the existing scattered "touch has no hover state"
rules into one place and applies them uniformly. Per-surface docs
that reference the pattern continue to reference
`patterns/icon-actions.md` directly; this file is the rule's
mobile-foundations citation.

## Gesture vocabulary

What we use:

- **Tap** — equivalent of click. Universal.
- **Drag-down on Sheet (bottom-anchored)** — dismiss. Per
  [`./layout.md → Sheet behavior`](./layout.md#sheet-behavior--additional-rules).
- **Tap-outside on Sheet / Popover** — dismiss. Per
  [`./layout.md`](./layout.md).
- **Drag from explicit handle** (`✥`-style icon) — for any
  reorder / drag interactions. Not long-press-to-grab.
- **Horizontal scroll** — chip strip, anything that overflows
  horizontally. Safe-zone rule below.
- **iOS swipe-from-left edge** — system back gesture. Reserved by
  the OS; the app accommodates the safe zone.

What we don't use in v1:

- **Long-press for actions.** No long-press-to-show-context-menu,
  no long-press-to-grab, no long-press-for-tooltip. The OS
  reserves long-press for selection / accessibility; using it for
  app actions creates conflicts. Right-click on desktop maps to
  the existing `⋯` overflow menu; touch users tap the `⋯`.
- **Swipe-on-row** (Material's swipe-to-delete / swipe-to-action).
  Adds discoverability cost, conflicts with horizontal-scroll
  regions, no iOS analog. Row actions use the explicit
  icon-actions pattern (always-visible-muted icons).
- **Pull-to-refresh.** Most lists are local-data; refresh is
  meaningless. No paged-from-network lists in v1.
- **iOS context menus / native preview gestures.** Not free in RN;
  not pursued.
- **Multi-finger gestures** beyond system pinch-to-zoom on any
  future image gallery — none in v1.

If post-v1 evidence shows users genuinely fish for long-press or
swipe-on-row, foundations is open to adding gestures as
_alternative triggers_ to existing affordances (not new affordance
sets). Today's contract doesn't paint into a corner; the
minimal-vocabulary default is the simpler starting point.

## Save bar on phone

The save bar (per
[`patterns/save-sessions.md`](../../patterns/save-sessions.md))
sits at the bottom of detail panes on desktop. On phone, the
detail is a full-screen route per
[`./collapse.md → World`](./collapse.md#world--kind-selector--list--detail-master-detail).

Behavior contract on phone:

- **Save bar sticky at bottom of detail-route content area** when
  no keyboard is active.
- **Save bar hides** when the soft keyboard opens (any field in
  the route gains focus). Animation: slide down off-screen.
- **Save bar reappears** when the keyboard dismisses (field blur,
  keyboard's return-key dismiss, tap-outside-field). Animation:
  slide up into place.
- **Navigate-away guard remains active** during keyboard-open
  state. If the user attempts back / system-back while dirty, the
  guard's confirm modal fires regardless of save-bar visibility.
- **Save action requires dismissing the keyboard first** (one
  extra tap), then tapping the now-visible save button.
  Save-during-typing isn't a typical workflow; the natural
  sequence is type → done → save.

Why hide rather than float-above:

- **Screen space.** Keyboard takes ~290 px on iPhone, ~250–300 px
  on Android. With chrome (top bar, sub-header, tabs ~112 px),
  plus a 48 px save bar, plus the keyboard, remaining content
  area shrinks below ~350 px on a 6.1" iPhone. Hiding the bar
  buys back ~48 px for the field being edited.
- **Workflow alignment.** The save bar's purpose is to commit the
  form; while typing, no commit is needed.
- **Safety preserved.** The navigate-away guard handles the
  "leave with dirty state" case independently.

The platform mechanism (RN's `KeyboardAvoidingView` modes, iOS
interactive-dismiss vs Android adjust-resize) is **session 6
(platform)** territory — this file pins the behavior contract;
session 6 pins the implementation when it lands.

## Status pill on phone

Status pill is icon-only on phone (text label `reasoning…` doesn't
fit in icon-only chrome).

- **Tap on pill (when active)** reveals current phase plus cancel
  button in a Popover anchored to the pill. Same content as
  desktop's pill text plus a `Cancel` action.
- **Popover, not Sheet.** Content is tiny (single phase line plus
  cancel) — fits the ≤ 200 px tiny-popover threshold per
  [`./layout.md → Popover`](./layout.md#popover). Same primitive
  on every tier.
- **Cancel** triggers the same cancel-pipeline action the desktop
  pill's click-to-cancel popover has, per the in-flight pipeline
  rules in
  [`../../principles.md → Edit restrictions during in-flight generation`](../../principles.md#edit-restrictions-during-in-flight-generation).

## Chip-strip safe zone

The reader chip strip (chapter, time, branch chips per
[`./navigation.md → Reader chip strip`](./navigation.md#reader-chip-strip-phone-only))
is horizontally scrollable on phone. iOS reserves the leftmost
~16 px for its system swipe-back gesture; horizontal scrolling
that starts at the screen's left edge competes with swipe-back.

Pin: **chip strip starts ~16 px in from the screen's left edge**.
The visual padding doubles as gesture safe zone. iOS's
edge-swipe-back triggers cleanly in the leftmost 16 px before
chip-strip horizontal scroll engages. Material / Android also
reserves an analogous edge region; the same 16 px works for both.

The rule generalizes to any other horizontally scrollable content
near a screen edge (none in v1 beyond the chip strip, but the
pattern carries forward if added).

## Tap-to-tooltip on inert chrome text

Generalizes the story-title popover rule from session 2 (per
[`./navigation.md → Title truncation on phone`](./navigation.md#title-truncation-on-phone)).

The rule applies to chrome text that:

- **Is at risk of truncation** (CSS `text-overflow: ellipsis` at
  runtime), AND
- **Isn't tappable for navigation** (inert label, not a link).

In scope today:

- **Top-bar story-title slot** (already pinned in session 2).
- **Current segment of a breadcrumb** (the "you are here" segment;
  inert per the
  [`../../principles.md → Breadcrumb tappability`](../../principles.md)
  amendment). When truncated, tap reveals the full segment in a
  popover.
- **Status badges, sub-screen labels, anywhere chrome carries an
  inert text label that may overflow.**

NOT in scope:

- **Parent breadcrumb segments** — they're navigation links per
  the breadcrumb-tappability amendment. Tap navigates; doesn't
  reveal popover. If the user wants to see the full parent
  segment, they navigate there.
- **List rows / story-list cards / entity rows** — these are
  tappable for navigation (tap → open detail). Their truncation
  is by-design (scannable summary view); the full content is
  reachable via the row's normal navigation.
- **Buttons / actionable icons / chips** — tap fires the action;
  no popover.

Implementation guidance: bind the tap-to-popover handler only to
elements whose text actually overflows at runtime. Don't bind on
elements where the text fits — that creates a phantom affordance
the user can tap with no visible result.

The popover is transient (no persistency, no localStorage), uses
the
[`./layout.md → Popover`](./layout.md#popover) primitive, and
dismisses on tap-outside or after a brief idle.

If this rule grows to ≥ 3–4 distinct surfaces, it earns promotion
to its own `patterns/text-truncation.md` file. For now, pinned
here.

## Tooltip and keyboard-shortcut scope

- **Tooltips are desktop-only.** Touch has no tooltip mechanism
  beyond the tap-to-tooltip rule above. Touch users get visual
  affordances (icons with adjacent labels where present) and
  short, legible icon vocabularies.
- **Keyboard shortcuts are desktop-only** (`Cmd/Ctrl+\`, `Cmd-K`,
  etc.). Mobile users get visual affordance equivalents — the
  icon button, the rail strip, the search input. No on-screen
  keyboard-shortcut hint is shown to mobile users.

Onscreen keyboard shortcuts as a concept (e.g., "Cmd+K" rendered
in the chrome) appear only on desktop / tablet. Phone chrome
omits the shortcut hint entirely.

## What this contract does NOT pin

- **Platform-specific keyboard handling** (RN
  `KeyboardAvoidingView` modes, iOS interactive-dismiss vs
  Android adjust-resize, soft-keyboard appearance animation) —
  session 6 (platform).
- **Sheet drag-dismiss threshold per platform** — session 6.
- **Accessibility specifics** (screen-reader announcements for
  popover open / close, focus-trap mechanisms, dynamic-type
  scaling) — session 6.
- **Exact gesture safe-zone pixel offset** if we ever support
  android-edge-back gesture differences; the 16 px default is
  a working number that session 6 may refine.
- **Per-screen wireframe retrofits** — session 7. The current
  wireframes show desktop hover behavior; phone touch behavior is
  documented here but not yet rendered in per-screen demos beyond
  the foundations demos.
