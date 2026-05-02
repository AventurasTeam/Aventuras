# Mobile foundations — touch grammar (session 5)

Session 5 of the mobile-foundations design pass (per
[`../ui/foundations/mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)).
Pins **how desktop interactions translate to touch** — hover
replacement, gesture vocabulary, save bar behavior with the
keyboard, status pill tap, chip-strip safe zone, tooltip and
keyboard-shortcut scope.

Also bundles a small **navigation amendment**: breadcrumb
tappability (segments are navigation links; current segment is
inert). Noted as a pattern that already-was-expected-but-not-pinned.

This file is an exploration record. Once integrated, the canonical
home for the touch grammar is
[`../ui/foundations/mobile/touch.md`](../ui/foundations/mobile/touch.md);
the breadcrumb amendment lives in
[`../ui/principles.md → Breadcrumb tappability`](../ui/principles.md).

## Decisions locked entering this session

Reached through dialogue:

- **Minimal-translation philosophy.** Touch is a subset of desktop
  interactions, not a parallel rich-gesture vocabulary. No
  long-press for actions, no swipe-on-row, no pull-to-refresh.
  Hover-bound affordances translate to always-visible-muted via
  the existing
  [`patterns/icon-actions.md → Visibility`](../ui/patterns/icon-actions.md#visibility--always-rendered-muted-default-brighten-on-hover)
  rule, generalized.
- **Save bar on phone hides while keyboard is open.** Reappears on
  field blur (keyboard dismissal). Approach B from the dialogue —
  preserves screen space for the input being edited; navigate-away
  guard still fires to protect against losing dirty state.
- **Tap-to-tooltip on truncated chrome text — narrowly scoped.**
  Applies only to inert chrome text (text not tappable for
  navigation). Today: the top-bar story title slot (already pinned
  in session 2) and the current segment of a breadcrumb when
  truncated. Not parent breadcrumb segments (those are nav links).
- **Breadcrumb tappability** as a generalized rule. Standard UX
  expectation; not previously pinned. Lands as a small principles
  amendment alongside this session.

## Hover translation — generalize the icon-actions rule

The
[`patterns/icon-actions.md`](../ui/patterns/icon-actions.md)
visibility rule (always-rendered-muted on every tier, brighten on
hover/focus on desktop only, no hover state on touch) becomes the
universal rule for any "hover-revealed" affordance:

| Desktop                               | Touch                                                   |
| ------------------------------------- | ------------------------------------------------------- |
| Hover-brighten on icon-actions        | always-visible-muted (no brighten on touch)             |
| Hover-preview on rollback rows        | desktop-only; no touch fallback (taps trigger directly) |
| Hover tooltips                        | desktop-only; touch has no tooltip mechanism            |
| Hover-anywhere-else affordance reveal | always-visible-muted                                    |

This codifies the existing scattered "touch has no hover state"
rules into one place and applies them uniformly.

## Gesture vocabulary

What we use:

- **Tap** — equivalent of click. Universal.
- **Drag-down on Sheet (bottom-anchored)** — dismiss. Per
  [`./layout.md → Sheet behavior`](../ui/foundations/mobile/layout.md#sheet-behavior--additional-rules).
- **Tap-outside on Sheet / Popover** — dismiss. Per session 3.
- **Drag from explicit handle** (`✥`-style icon) — for any reorder
  / drag interactions. Not long-press-to-grab.
- **Horizontal scroll** — chip strip, anything that overflows
  horizontally.
- **iOS swipe-from-left edge** — system back gesture. Reserved by
  the OS. App accommodates the safe zone.

What we don't use in v1:

- **Long-press for actions.** No long-press-to-show-context-menu,
  no long-press-to-grab, no long-press-for-tooltip. Gesture is
  reserved by the OS for selection / accessibility; using it for
  app actions creates conflicts. Right-click on desktop maps to
  the existing `⋯` overflow menu (per
  [`patterns/icon-actions.md`](../ui/patterns/icon-actions.md));
  touch users tap the `⋯`.
- **Swipe-on-row** (Material's swipe-to-delete / swipe-to-action).
  Adds discoverability cost, conflicts with horizontal-scroll
  regions, no iOS analog. Row actions are the explicit
  icon-actions pattern (always-visible-muted icons).
- **Pull-to-refresh.** Most lists are local-data; refresh is
  meaningless. No paged-from-network lists in v1.
- **iOS context menus / native preview gestures.** Not free in RN;
  not pursued.
- **Multi-finger gestures** beyond the system pinch-to-zoom on
  any future image gallery — none in v1.

The minimal vocabulary is a deliberate trade-off against
gesture-rich UIs: it reduces the discoverability surface, keeps
iOS↔Android consistency simpler, and avoids gestures whose
semantics vary across platforms. Old-app evidence (mobile-only
users without major usability complaints) supports the pattern.

If post-v1 evidence shows users genuinely fish for long-press or
swipe-on-row, foundations is open to adding gestures as
_alternative triggers_ to existing affordances (not new affordance
sets), without rewriting the contract.

## Save bar on phone — hide while keyboard open

The save bar (per
[`patterns/save-sessions.md → Save bar`](../ui/patterns/save-sessions.md))
sits at the bottom of detail panes on desktop. On phone, the
detail is a full-screen route per
[`./collapse.md → World — kind selector + list + detail`](../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).

Behavior contract on phone:

- **Save bar sticky at bottom of detail-route content area** when
  no keyboard is active.
- **Save bar hides** when the soft keyboard opens (any field in the
  route gains focus). Animation: slide down off-screen.
- **Save bar reappears** when the keyboard dismisses (field blur,
  keyboard's return-key dismiss, tap-outside-field). Animation:
  slide up into place.
- **Navigate-away guard remains active** during keyboard-open
  state. If the user attempts back / system-back while dirty, the
  guard's confirm modal fires regardless of save-bar visibility.
  Safety contract preserved without the visible bar.
- **Save action is reachable** by dismissing the keyboard first
  (one extra tap), then tapping the now-visible save button. Save
  during typing isn't a typical workflow.

Why this approach:

- **Screen space.** The keyboard takes ~290 px on iPhone, ~250–300
  px on Android. With chrome (top bar ~44, sub-header ~32, tabs
  ~36 — totaling ~112 px), plus a 48 px save bar, plus the keyboard,
  remaining content area shrinks below ~350 px on a 6.1" iPhone.
  Hiding the save bar buys back ~48 px for the field being edited.
- **Workflow alignment.** Typing-then-saving is the natural
  sequence. The save bar's purpose is to commit the form; while
  the user is mid-typing, no commit is needed.
- **Safety preserved by navigate-away guard.** The save bar's
  presence is presentation, not enforcement.

The platform mechanism (RN's `KeyboardAvoidingView` modes, iOS
interactive-dismiss vs Android adjust-resize) is **session 6
(platform)** — session 5 just pins the _behavior contract_.

If post-v1 user testing reveals problems (e.g., users want
mid-typing save), an alternative compact-save-pill-while-keyboard
variant is implementable without foundations rewrite — the
contract clause is "save bar hidden during active keyboard input"
which is precise enough to relax later.

## Status pill tap — phone

Deferred from session 2. The status pill is icon-only on phone
(text label `reasoning…` doesn't fit in icon-only chrome).

- **Tap on pill (when active) reveals current phase and cancel
  button** in a Popover anchored to the pill. Same content as
  desktop's pill text plus a `Cancel` button.
- **Popover, not Sheet.** Content is tiny (single phase line +
  cancel) — fits the ≤ 200 px tiny-popover threshold per
  [`./layout.md → Popover`](../ui/foundations/mobile/layout.md#popover).
  Popover anchors to the pill at every tier (same primitive
  desktop / tablet / phone).
- **Cancel button in the popover** triggers the same
  cancel-pipeline action the desktop pill's click-to-cancel popover
  has (per
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md)
  and the existing in-flight pipeline rules in principles.md).

## Chip-strip horizontal scroll vs iOS swipe-back — safe zone

Deferred from session 2. The chip strip on the reader phone-tier
(per
[`./navigation.md → Reader chip strip`](../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only))
is horizontally scrollable. iOS reserves the leftmost ~16 px for
its system swipe-back gesture; horizontal scrolling that starts
at the screen's left edge competes with swipe-back.

Pin: **chip strip starts ~16 px in from the screen's left edge**.
The visual padding doubles as the gesture safe zone. iOS's
edge-swipe-back triggers cleanly in the leftmost 16 px before the
chip-strip's horizontal scroll engages. Material / Android also
reserves an analogous edge region; the same 16 px works for both.

Same rule applies to any other horizontally scrollable content
that lives near a screen edge (none in v1 beyond the chip strip,
but the pattern generalizes if added).

## Tap-to-tooltip on inert chrome text

Generalizes the story-title popover rule from session 2. Applies
to chrome text that:

- **Is at risk of truncation** (text-overflow: ellipsis at runtime),
  AND
- **Isn't tappable for navigation** (inert label, not a link).

Today, this scope covers:

- **Top-bar story-title slot** (per session 2 — already pinned).
- **Current segment of a breadcrumb** (the "you are here" segment;
  inert per the breadcrumb-tappability amendment below). When
  truncated, tap reveals the full segment in a popover.
- **Status badges, sub-screen labels, anywhere chrome carries an
  inert text label that may overflow.**

NOT in scope:

- **Parent breadcrumb segments** — they're navigation links per
  the amendment below. Tap navigates; doesn't reveal popover. If
  the user wants to see the full parent segment, they navigate
  there.
- **List rows / story-list cards / entity rows** — these are
  tappable for navigation (tap → open detail). Their truncation
  is by-design (scannable summary view); the full content is
  reachable via the row's normal navigation.
- **Buttons / actionable icons / chips** — tap fires the action;
  no popover.

Implementation guidance: bind the tap-to-popover handler only to
elements whose text actually overflows at runtime (CSS overflow
detection). Don't bind on elements where the text fits, since
that creates a phantom affordance.

If this rule grows to ≥ 3–4 distinct surfaces, it earns promotion
to its own `patterns/text-truncation.md` file. For now, pinned in
`mobile/touch.md`.

## Tooltip and keyboard-shortcut scope

- **Tooltips are desktop-only.** Touch has no tooltip mechanism
  beyond the tap-to-tooltip rule above. Touch users get visual
  affordances (icons with adjacent labels where present) and
  short, legible icon vocabularies.
- **Keyboard shortcuts are desktop-only** (Cmd/Ctrl+\, Cmd-K,
  etc.). Mobile users get visual affordance equivalents — the
  icon button, the rail strip, the search input, etc. No on-screen
  keyboard shortcut hint is shown to mobile users.

## Breadcrumb tappability — amendment

Standard UX expectation; not previously pinned in `principles.md`.
The
[`principles.md → Top-bar design rule → Master-detail sub-header`](../ui/principles.md#master-detail-sub-header)
section describes the visual treatment of the in-pane sub-header
(`Characters / Kael Vex`) but doesn't say segments are tappable.
This amendment adds the rule.

The rule:

- **Top-bar breadcrumb segments are tappable** for navigation.
  Each segment is a link to that ancestor in the screen-level
  path. Top-bar example: `Aria's Descent / World` — tapping
  `Aria's Descent` returns to the reader (story root).
- **Master-detail sub-header segments are tappable** for in-pane
  navigation. Sub-header example: `Characters / Kael Vex` —
  tapping `Characters` clears the row selection (returns to "no
  character selected" or, on phone, returns to the list state per
  the master-detail collapse rule).
- **Current segment is inert** (no-op on tap). Visual treatment:
  emphasized (bold, muted-to-full color depending on visual
  identity). If the current segment is text-truncated, tap
  reveals the full text in a popover per the
  tap-to-tooltip-on-inert-chrome-text rule above. Otherwise no-op.
- **Same rule across desktop, tablet, phone.** Tappability is a
  universal navigation expectation.

Phone-specific behavior (master-detail collapse): on phone, the
detail-route's chrome includes the breadcrumb. Tapping a parent
segment dismisses the detail route and lands on the parent state
(e.g., tap `Characters` → back to list state, Characters filter
active). Tap-on-parent-segment is a fast route alternative to
tapping the back arrow plus filter selection. Both pathways exist;
breadcrumb segments are the chrome-resident shortcut.

Stack-aware Return interaction: tapping a breadcrumb segment is
equivalent to popping the navigation stack repeatedly until that
segment is the current location. The stack is updated coherently;
no orphan-state issues.

## Adversarial pass

### Load-bearing assumption

Big assumption: **minimal-translation works for v1**. Indirect
evidence (old-app mobile users had no major usability complaints)
supports it; no direct evidence that users won't fish for
gestures.

Mitigation: **additive-only fallback**. Post-v1, foundations is
open to adding long-press / swipe-on-row as alternative triggers
to existing affordances without rewriting the contract. The
minimal vocabulary today doesn't paint us into a corner.

### Edge cases

- **Save bar hidden together with iOS swipe-back.** User has
  keyboard open and dirty save state. They swipe-back from the
  left edge. Two things compete:
  - The keyboard would normally dismiss when focus is lost (system
    behavior).
  - The swipe-back would trigger the navigate-away guard's confirm
    modal (per the existing rule).

  Standard iOS behavior: swipe-back-while-keyboard-open dismisses
  the keyboard first, then the navigation transition. The
  navigate-away guard fires AFTER keyboard dismissal completes.
  Same as desktop swipe-back-during-keyboard. No conflict; tested
  by every modern iOS app.

- **Tap on pill while pipeline is in flight, then navigate.** The
  pill's popover has cancel; user clicks elsewhere first. Popover
  dismisses on tap-outside; pipeline continues. Per existing
  edit-restrictions rule, navigation during pipeline is allowed
  read-only; the pill's popover is consistent across surfaces. ✓
- **Chip strip horizontal scroll vs iOS swipe-back conflict.** The
  16 px safe zone is the standard iOS solution. If the strip's
  content is short enough to not need scrolling, the safe zone is
  cosmetic visual padding; no gesture conflict possible. If the
  content needs scrolling, the safe zone reserves the system
  gesture region. Verified pattern. ✓
- **Tap-to-tooltip on truncated current breadcrumb segment.** User
  is on `Aria's Descent / World / Characters / Kael Vex Reborn`
  and the current segment `Kael Vex Reborn` is truncated to
  `Kael Vex…`. Tap reveals the full text in a popover. Tap-outside
  dismisses. No nav, no back. Same flow as the story-title
  popover. ✓
- **Breadcrumb tap on current segment when NOT truncated.**
  No-op. Visual feedback (hover state on desktop only — mobile has
  none, no specific feedback needed; the segment is inert by
  visual treatment). No phantom affordance.
- **Drag handle on rows where reorder is supported.** Currently no
  surfaces support row-reorder. If added later, explicit
  `[✥]`-style handle icon on each row is the rule (per the
  gesture-vocabulary table). Long-drag-from-handle initiates
  reorder; touch and mouse both work the same way.
- **Chip-strip horizontal scroll on tablet.** Tablet has chips
  inline in top-bar (per session 2). Chip strip doesn't render on
  tablet. Safe-zone rule moot at tablet tier. ✓

### Read-site impact / doc-integration cascades

- `patterns/icon-actions.md → Visibility` already declares the
  always-visible-muted rule for icon-actions specifically. Session
  5's generalization broadens the principle to "any hover-bound
  affordance"; the `patterns/icon-actions.md` text remains valid
  and unchanged. Session 5's `mobile/touch.md` cites it as the
  precedent.
- `principles.md → Top-bar design rule → Master-detail sub-header`
  carries a visual-treatment description; the breadcrumb-tappability
  amendment adds a tappability sub-section that doesn't conflict.
  Heading anchors preserved.
- `patterns/save-sessions.md` describes the save bar generally;
  the phone-specific keyboard-hide behavior pinned in
  `mobile/touch.md` is mobile-foundations territory and doesn't
  need patterns/save-sessions.md to be edited.
- The status pill on phone (popover reveal) was implicitly
  expected per session 2's "session 5 fleshes out tap behavior";
  it lands here.

### Missing perspective

- **Sync / backup format.** Touch grammar is UI; no schema impact.
  ✓
- **Translation pipeline.** Touch grammar doesn't touch
  user-translatable content. ✓
- **Implementation cost.** RN supports the gesture set
  (tap, drag-down, tap-outside, horizontal scroll) via native
  components. Swipe-back is iOS-platform-handled. Drag handles for
  reorder use `react-native-draggable-flatlist` or similar
  (library choice deferred to first implementation).
- **Accessibility.** Tap-to-tooltip on truncated text needs a
  screen-reader announcement of the full text when the popover
  opens. Bundles with session 6 (platform). Status-pill popover
  needs role="alert" or similar. Same.
- **Power user concerns.** Mobile-only users don't have keyboard
  shortcuts; that's a known cost of the platform. Not unique to
  Aventuras.

### Verified vs assumed

- **Verified.** `icon-actions.md`'s always-visible-muted rule
  exists and applies to icon-actions specifically. `rollback-confirm.md`
  declares hover-preview is desktop-only with no touch fallback.
  `mobile/navigation.md` (session 2) covers status-pill icon-only
  on phone with tap-reveal-phase. Chip strip's existence per
  session 2.
- **Assumed.** iOS / Android / mobile-web users tolerate the
  minimal gesture vocabulary without complaint. Indirect evidence
  (old-app feedback). Mitigated by additive-only fallback path.

## Followups generated

- **Long-press as alternative trigger** (post-v1 if user testing
  surfaces fishing). Not a pre-v1 followup; flagged in the
  contract for future expansion.
- **Compact save-bar variant** for mid-typing save (post-v1 if
  user testing reveals workflow gap). Not a pre-v1 followup; same
  shape as long-press.
- **Tap-to-tooltip pattern promotion** to `patterns/text-truncation.md`
  if usage grows beyond ~3 surfaces. Not a pre-v1 followup.

No new entries in `followups.md` or `parked.md`.

## Integration plan

Files in the integration commit:

- **NEW** `docs/ui/foundations/mobile/touch.md` — canonical touch
  grammar contract.
- **NEW** `docs/ui/foundations/mobile/touch.html` — interactive
  demo (status-pill popover, save-bar-with-keyboard, tap-to-tooltip
  on truncated text).
- **NEW** `docs/explorations/2026-05-01-mobile-touch.md` — this
  record.
- **EDIT** `docs/ui/foundations/mobile/README.md` — Files list adds
  `touch.md` and `touch.html`. Sessions list session 5 marked
  landed.
- **EDIT** `docs/ui/principles.md` — add "Breadcrumb tappability"
  sub-section under or adjacent to the Master-detail sub-header
  section. Notes parent-segments-tappable, current-segment-inert,
  same-on-every-tier. Heading anchors preserved.

Renames / heading changes: none.

Patterns adopted on a new surface: none. The new files cite
`patterns/icon-actions.md` (visibility rule),
`patterns/save-sessions.md` (save bar, navigate-away guard),
`principles.md` (edit restrictions, stack-aware Return),
`responsive.md`, `navigation.md` (status pill icon-only,
chip strip), `layout.md` (Sheet, Popover primitives),
`collapse.md` (master-detail full-screen route on phone). All
content references; no Used-by updates.

Followups resolved: none in `followups.md`. The classification-
awareness pattern entry mentions "tap behavior on the rail strip"
which is now covered by collapse.md's strip-tap rule (carried over
from session 4); the broader awareness-pattern is still open. No
removal.

Followups introduced: none.

Wireframes updated: one new (`touch.html`); no existing wireframes
touched.

Pre-foundations content stance: existing per-screen docs
(reader-composer.md, world.md, etc.) NOT modified. Their
hover-behavior descriptions remain unchanged; session 7 retrofits
each surface's prose.

Intentional repeated prose: gesture vocabulary tables and the
hover-translation table appear in both the exploration record and
`mobile/touch.md`. Standard exploration-record duplication.

## Self-review

- **Placeholders.** None.
- **Internal consistency.** Tier boundaries match session 1.
  Sheet / Popover primitives match session 3. Status-pill phone
  expression cited from session 2. Save-bar phone position cited
  from session 4 (collapse). Breadcrumb amendment applies on every
  tier.
- **Scope.** Single integration; touch grammar plus the small
  breadcrumb amendment. Platform specifics (RN keyboard handling,
  iOS / Android gesture conventions, accessibility specifics) all
  scoped to session 6.
- **Ambiguity.** "Inert chrome text" defined as "text not tappable
  for navigation"; the table of in-scope and out-of-scope examples
  resolves edge cases. "Save bar hides while keyboard open" defined
  as "any field in the route gains focus." "Long-press for actions"
  explicitly off; "drag from explicit handle" explicitly on.
- **Doc rules.** Anchor links resolve. No `+` separators in prose
  per the saved feedback memory.
