# Mobile foundations — layout primitives (session 3)

Session 3 of the mobile-foundations design pass (per
[`../ui/foundations/mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)).
Mints the canonical layout-primitive vocabulary that all per-screen
mobile designs compose from, plus the desktop-to-mobile mapping
rules. Existing project terms (`peek drawer`, `popover`, `modal`,
`bottom drawer`) are respected where they're load-bearing; one
naming consolidation lands (`drawer` and `bottom sheet` collapse
into a single `Sheet` primitive with anchor / height variants).

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/mobile/layout.md`](../ui/foundations/mobile/layout.md).

## Decisions locked entering this session

Reached through dialogue:

- **Vocabulary set**: Popover, Modal, Sheet, Full-screen route. Four
  primitives. Existing project terms map onto these (`peek drawer`
  becomes a named usage of Sheet; `bottom drawer` in branch-navigator
  is the same primitive as a bottom-anchored Sheet).
- **Consolidation of Sheet.** Right-anchored drawers (peek drawer,
  raw JSON viewer) and bottom drawers (branch nav, Actions menu on
  phone) collapse into one Sheet primitive with anchor variants
  (right, bottom) and height variants (short, medium, tall). User
  prompted this by suggesting the iOS "page sheet" pattern (~95%
  cover with parent visible at top edge, swipe-to-dismiss) for the
  peek drawer's phone expression — which made the route-vs-sheet
  distinction click into "internal nav vs no internal nav" rather
  than "covers more vs less screen."
- **Peek drawer on phone is a tall Sheet (~95%)**, not a full-screen
  route. Preserves the glance-and-dismiss feel; parent surface
  visible at top edge; swipe-down or tap-outside dismiss. iOS
  page-sheet pattern, Material 3 modal-bottom-sheet at >85% height.
- **Story Settings on phone is a full-screen route**, not a Sheet.
  It has internal navigation (categories, sub-screens) — needs
  route-shaped chrome, not sheet-shaped overlay.
- **Pre-foundations naming preserved.** `bottom drawer` in
  `branch-navigator.md` and other surfaces stays in their text;
  session 7's per-screen retrofits unify naming when each surface
  is touched. No sweep this session.

## Background — existing overlay vocabulary in the docs

Survey turned up a heterogeneous set of overlay terms in the
canonical docs:

- **popover** — chapter popover, time-chip popover, ⋯ menus, help
  popover, model picker, calendar picker, guidance popover (in
  packs). Used pervasively for "anchored to a trigger element,
  small content, transient."
- **peek drawer** — entity-overview pattern in the reader. Right-
  anchored on desktop (~440px wide; the
  [data-viewer pattern](../ui/patterns/data.md) explicitly matches
  this width). Has a save-session quick-edit exception per
  [`patterns/save-sessions.md → Quick-edit exception — peek drawer`](../ui/patterns/save-sessions.md#quick-edit-exception--peek-drawer).
- **bottom drawer** — branch-navigator's mobile expression per
  [`branch-navigator.md → Mobile — bottom drawer`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#mobile--bottom-drawer).
- **modal** — rollback-confirm, branch creation, calendar swap
  warnings. Centered, scrim, focused interaction.
- **right-anchored drawer** — raw JSON viewer per
  [`patterns/data.md`](../ui/patterns/data.md), explicitly matched
  to peek drawer width.

Three observations:

1. **`drawer` is overloaded.** Peek drawer (right, ~440px), bottom
   drawer (mobile), right-anchored drawer (raw JSON viewer). Same
   primitive, different anchors / heights.
2. **`popover` covers two distinct cases** — genuinely tiny popovers
   (tooltip-style, 2-row mini menus) AND content-rich popovers
   (chapter popover with many rows, full Actions menu). The mobile
   expression has to differ between these.
3. **`modal` has a clean meaning** (centered, scrim, must
   confirm-or-cancel) but its mobile expression isn't pinned —
   rollback-confirm declared "renders identically on mobile" pre-
   foundations, but bigger modals could need a different shape.

## Vocabulary — four primitives

The session lands four primitives. Every overlay / sliding surface
in the app maps to one of these.

### 1. Popover

Anchored to a trigger element. Small content (≤ 200px tall is the
informal limit). No scrim. Transient — dismisses on tap-outside,
Esc key, or trigger re-tap. No drag-to-dismiss; popovers are for
content too small to merit gesture-driven interaction.

Use when: a small menu, picker, tooltip, or inline status display
should anchor visually to its trigger and not interrupt the parent
surface.

Examples in the app: chapter chip's dropdown affordance (chapter
popover content moves to Sheet on phone, see below), time-chip
popover, tooltips, the search-help popover.

### 2. Modal

Centered. Scrim behind. Focus-demanding — the user must confirm or
cancel; tap-outside dismiss is gated by the modal's own action set
rather than free dismissal. Same expression on every tier.

Use when: a confirmation, alert, or short focused form interrupts
the user's flow and demands resolution before proceeding.

Examples in the app: rollback-confirm, branch creation modal,
calendar swap warnings.

**Long / multi-step content** is rare in this category but, when
encountered, becomes a **full-screen route on phone** rather than
a Modal — phone Modal-with-form is awkward at the keyboard-open
viewport heights. Today the project has no such modal; flagged
for session 7 as a substitution rule, not a today-decision.

### 3. Sheet

Edge-anchored sliding panel. Scrim. Draggable. Dismissible by
swipe-toward-edge, tap-outside, or close affordance. Anchor and
height vary.

**Anchor variants:**

- **Bottom** — phone primary. The sheet slides up from the bottom
  edge; drag-down dismisses. Most mobile sheets.
- **Right** — desktop primary. Slides in from right ~440px wide
  (matches reader peek drawer width). Used for entity-overview-
  style detail content where a right rail makes sense.

(Left and top anchors are not used in v1.)

**Height variants (bottom-anchored on phone):**

- **Short** (~30% viewport, content-fit). Actions menu, branch
  nav (currently named "bottom drawer"), short pickers.
- **Medium** (~50–60% viewport). Chapter popover content on phone,
  calendar picker, multi-row pickers.
- **Tall** (~85–95% viewport). Peek drawer on phone, raw JSON
  viewer on phone, rich detail content. Top edge of the parent
  surface remains visible (~10–20px) so the sheet reads as overlay
  rather than destination.

Right-anchored sheets on desktop are a single ~440px-wide
expression; height fills the available viewport region under the
top bar.

**Peek drawer is a named usage of Sheet** — desktop expression is
a right-anchored sheet (~440px); phone expression is a tall
bottom-anchored sheet (~95%). Project-specific content rules
(save-session quick-edit exception, lead-affordance, "Open in
panel" link) attach to the named usage, not the primitive.

### 4. Full-screen route

A navigable destination with its own back affordance. Standard
navigation; no swipe-dismiss; parent surface enters the navigation
stack rather than remaining alive behind.

Use when: the destination has internal navigation (sub-screens,
categories), is multi-step (must not accidentally dismiss
mid-flow), or is genuinely a separate piece of the app rather
than an overlay over the current piece.

Examples in the app: wizard, onboarding, **Story Settings on
phone** (per session 2's settings routing), World / Plot /
Chapter Timeline on every tier (these are surfaces, not overlays —
they happen to fit the route shape but they're the _destinations_,
not invocations of route).

## Decision tree — picking a primitive

```
Is the user being interrupted to confirm or cancel?
  → MODAL (centered, scrim, all tiers; long/multi-step → full-screen route on phone)

Is this a menu, picker, or selection list?
  Desktop: → POPOVER (anchored to trigger)
  Phone:
    Tiny (≤ 200px content) and fits viewport with margin?
      → POPOVER (anchored to trigger, same as desktop)
    Larger:
      → SHEET (bottom, height = short/medium per content)

Is this rich detail of a thing (entity overview, lore detail, raw JSON dump)?
  Desktop: → SHEET (right-anchored, ~440px)
  Phone:   → SHEET (bottom-anchored, tall ~95%)

Is this a navigable destination with internal navigation, multi-step content,
or no-accidental-dismiss requirements?
  → FULL-SCREEN ROUTE (all tiers)
```

## Mapping rules — desktop to mobile

| Desktop                  | Phone                         | Tablet            |
| ------------------------ | ----------------------------- | ----------------- |
| Popover (rich content)   | Sheet (bottom, medium height) | Popover           |
| Popover (tiny content)   | Popover                       | Popover           |
| Modal (short)            | Modal                         | Modal             |
| Modal (long, multi-step) | Full-screen route             | Modal             |
| Peek drawer (right ~440) | Sheet (bottom, tall ~95%)     | Peek drawer       |
| Right-anchored drawer    | Sheet (bottom, tall ~95%)     | As desktop        |
| Full-screen route        | Full-screen route             | Full-screen route |
| Modal-over-Sheet         | Modal-over-Sheet              | Modal-over-Sheet  |

Tablet inherits desktop expressions across the board (consistent
with session 2's "tablet inherits desktop chrome verbatim" rule).

## Stacking rules

- **Modal over Sheet**: allowed but rare. Use case: a confirm-action
  initiated from inside a Sheet (e.g. "delete this branch" inside
  the branch nav sheet shows a centered Modal over the Sheet).
  Backdrop scrim stacks; the Sheet stays visible behind the Modal.
- **Sheet over Sheet**: not allowed. If a Sheet's content needs to
  lead somewhere richer, the Sheet dismisses and the new surface
  (full-screen route or Modal) takes over.
- **Popover over anything**: popovers anchor to chrome elements;
  they can fire over a Sheet or Modal IF the trigger is visible.
  Rare in practice — most chrome triggers aren't visible during a
  Sheet or Modal.
- **Full-screen route from a Sheet**: dismiss the Sheet first, then
  navigate. Stack-aware Return remembers the user came from the
  Sheet's parent surface, not from the Sheet itself.

## Container conventions

Inherited from existing foundations; no new tokens minted.

- **Padding**: `--row-pad-y` / `-x` for sheet rows; `--input-pad-y`
  / `-x` for sheet inputs (per `foundations/spacing.md`).
- **Radii**: sheets use `--radius-lg` (12px) for top corners (when
  bottom-anchored) or all corners (when content area is detached).
  Modals use `--radius-md` (8px).
- **Depth**: pure flat per
  [`foundations/spacing.md → Depth metaphor`](../ui/foundations/spacing.md#depth-metaphor).
  Modals and Sheets use `--bg-overlay` plus `--border-strong`
  outline plus the fixed mode-dependent scrim
  (`rgba(0, 0, 0, 0.4)` light / `0.6` dark). Popovers use
  `--bg-overlay` plus `--border` (no scrim, per the existing
  spec).
- **Tap-target / hit area**: sheet drag-handles inherit native-
  tap-target conventions per `foundations/spacing.md`'s
  `hitSlop` guidance.

## Specific surface bindings

These are the existing app surfaces, each binding to a primitive:

| Surface                          | Primitive                                                 | Notes                                                                     |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Chapter chip popover (reader)    | Popover (desktop) → Sheet medium (phone)                  | Multi-row content, exceeds the 200px tiny limit                           |
| Time-chip popover                | Popover everywhere                                        | Genuinely small (a few rows)                                              |
| Actions menu (`⚲`)               | Popover (desktop) → Sheet short (phone)                   | Phone: edge-clipping risk → Sheet                                         |
| Branch chip popover (`⎇`)        | Popover (desktop) → Sheet short (phone)                   | Pre-foundations spec already calls phone "bottom drawer" — same primitive |
| Branch creation                  | Modal (all tiers)                                         | Pre-foundations: "creation modal is unchanged on mobile"                  |
| Rollback confirm                 | Modal (all tiers)                                         | Pre-foundations: "modal renders identically on mobile"                    |
| Calendar swap warnings           | Modal (all tiers)                                         | Per `patterns/calendar-picker.md`                                         |
| Calendar picker                  | Popover (desktop) → Sheet medium (phone)                  | Rich content (preset rows, summary panel)                                 |
| Model picker dropdown            | Popover (desktop) → Sheet medium (phone)                  | Per app-settings.md "popover-rendered, virtualized list"                  |
| Help / search-help popovers      | Popover everywhere                                        | Tiny content                                                              |
| Peek drawer                      | Sheet right ~440px (desktop) → Sheet bottom tall (phone)  | Project-specific named usage of Sheet                                     |
| Raw JSON viewer                  | Sheet right ~440px (desktop) → Sheet bottom tall (phone)  | Matches peek drawer pattern                                               |
| Story Settings (from in-story)   | Full-screen route (phone) / regular surface (tablet+desk) | Has internal navigation (categories)                                      |
| Wizard, onboarding               | Full-screen route everywhere                              | Multi-step; no swipe-dismiss                                              |
| Save-session navigate-away guard | Modal (all tiers)                                         | Confirms unsaved changes; standard modal usage                            |

This table is documentation, not a spec — session 7's per-screen
retrofits cite these bindings.

## Sheet behavior — additional rules

Pinned this session to avoid session 5 (touch grammar) revisiting
foundational sheet behavior:

- **Drag handle.** Bottom-anchored sheets render a small drag handle
  (~32px wide, 4px tall, centered, muted color) at the top edge.
  Visual cue that the sheet is draggable. Right-anchored desktop
  sheets do not show a drag handle — desktop dismissal is via
  close button or tap-outside.
- **Drag-down dismisses.** Bottom-anchored sheets dismiss when
  dragged down past ~40% of their visible height (or per platform
  convention if iOS / Android differ from this — session 6
  resolves implementation specifics).
- **Tap-outside dismisses** for both anchor variants. The visible
  parent surface (top edge for tall bottom sheet, area outside the
  ~440px right strip on desktop) is tappable to dismiss.
- **Scrim opacity** matches existing tokens. No sheet-specific
  scrim token.
- **Sheet "stuck" state** — if a sheet is in mid-form-edit and the
  user tries to drag-down dismiss, save-session navigate-away guard
  fires (per
  [`patterns/save-sessions.md → Navigate-away guard`](../ui/patterns/save-sessions.md)).
  This is consistent with existing behavior; mobile inherits.
- **Keyboard interaction** — sheets and modals trap Tab focus.
  Esc dismisses (desktop); on mobile, the system back / swipe-back
  triggers stack-aware Return which dismisses the sheet (per
  session 2's binding).

## Adversarial pass

After the design feels coherent, deliberately try to break it.

### Load-bearing assumption

The big assumption: **the four primitives cover every overlay /
sliding surface in v1**. The specific-surface-bindings table above
is the verification — every existing pre-foundations surface maps
to one primitive without forcing fit. If a future surface needs a
fifth primitive, the foundations contract is open to adding it,
but no current evidence suggests the gap exists.

Edge case I want to flag: **the right rail on desktop**. Is the
rail a Sheet? It's right-anchored, ~280px wide (per
[`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md)),
collapsible to an edge strip per the existing collapse spec.
Behaviorally:

- It's _persistent_ by default (visible alongside the narrative),
  not modal. No scrim.
- It collapses to an edge strip rather than full-dismissing.
- It's the reader's primary cross-surface mechanism per session 2.

That's not Sheet behavior (Sheets are scrim-modal). The rail is
its own thing — neither a primitive nor a named-usage-of-Sheet.
Session 4 (collapse rule) owns the rail's mobile fate;
session 3 doesn't classify the rail as a primitive. Acceptable.

### Edge cases

- **Sheet height when keyboard is open.** Phone keyboard takes
  ~40% of viewport. A medium sheet (~55%) plus keyboard would
  overlap. Mitigation: sheet height shrinks to fit available
  viewport above the keyboard; content scrolls if it exceeds. This
  is platform-handled (iOS / Android both handle this natively
  via safe-area-aware layout). Session 6 (platform) details the
  binding.
- **Sheet over Modal**: explicitly disallowed. If a flow needs
  this, the design is wrong — invert the stacking order.
- **Tall Sheet (95%) vs full-screen route — visually similar but
  behaviorally distinct.** Risk: users don't notice the swipe-
  dismiss affordance on a tall sheet because it looks like a
  route. Mitigation: (a) the visible parent edge at the top is
  distinct from a route's chrome; (b) the drag handle is the
  affordance hint; (c) iOS / Android users are conditioned to
  these patterns by other apps. Acceptable risk.
- **Peek drawer mobile dismissal during edit-in-progress.** Peek
  has the save-session quick-edit exception (most fields commit
  on blur). The tall-sheet's drag-down dismissal interacts with
  this — drag-down acts like blur, commits any in-progress edit.
  Existing semantics carry; mobile inherits.
- **Modal-over-Sheet stack on phone.** When a Sheet is at ~95% and
  a Modal opens over it, the Modal's centered position lands inside
  the Sheet's visible area. Backdrop scrim stacks. Visually
  acceptable.

### Read-site impact / doc-integration cascades

- `principles.md → Settings architecture` declares Story Settings
  as in-story chrome → settings routing. Session 3 doesn't modify
  the routing rule; it just says the **shape** on phone is
  full-screen route. Compatible with the existing principle.
- `patterns/save-sessions.md → Quick-edit exception — peek drawer`
  carries over to phone (peek drawer is now a tall Sheet, but the
  save-session exception attaches to the named usage, not the
  primitive). No edit needed.
- `patterns/data.md` describes the raw JSON viewer as
  "right-anchored drawer, ~440px wide (matches reader peek drawer
  width)." This still reads true on desktop / tablet. On phone the
  primitive binding shifts to "bottom-anchored Sheet, tall." A
  one-line update could be added but isn't required this session;
  session 7 retrofits the per-screen prose.
- `branch-navigator.md → Mobile — bottom drawer` is the same
  primitive as Sheet. No edit this session; session 7 reconciles
  naming.
- Pre-foundations modal sections (rollback-confirm, branch
  creation) — both align with session 3's Modal primitive. No
  edits.

### Missing perspective

- **Sync / backup.** Sheets and Modals are UI; no schema impact. ✓
- **Translation pipeline.** Primitive vocabulary doesn't carry
  translatable content. ✓
- **Implementation cost.** Three or four sheet libraries exist for
  RN (`@gorhom/bottom-sheet` etc.). Choice is implementation; the
  contract is library-agnostic. ✓
- **Accessibility.** Sheets and Modals trap focus, support Esc /
  back to dismiss. Specific screen-reader announcements (sheet
  open / close) bundle with session 6 (platform). ✓
- **Performance on low-end Android.** Sheet animations could be
  costly. Existing `--duration-base` and `--duration-fast` motion
  tokens (from `foundations/motion.md`) cover the timing; reduced-
  motion behavior already handles transform-vs-opacity per
  motion.md. ✓

### Verified vs assumed

- **Verified.** Existing overlay vocabulary across the docs (grep
  confirmed). Pre-foundations Modal usage in rollback-confirm /
  branch creation. Peek drawer's save-session exception. Right-
  anchored drawer for raw JSON viewer matches peek width.
- **Assumed.** The four primitives cover every v1 surface. Direct
  enumeration in the bindings table is the primary mitigation —
  if a future surface doesn't fit, foundations is open to adding
  a fifth primitive.

## Followups generated

- **Sheet library choice for RN implementation.** Bundles with
  session 7's per-screen implementation; not a foundations
  decision. Existing followup
  [`virtual-list library choice`](../followups.md#virtual-list-library-choice)
  is a precedent for "library choice happens at first
  implementation." Adopt the same pattern.
- **Sheet drag dismissal threshold per platform.** iOS and Android
  conventions differ slightly. Session 6 (platform) specifies; not
  a session 3 issue.
- **Tall Sheet vs full-screen route disambiguation in user
  research.** Visually similar; users may not notice swipe-dismiss
  on tall sheet. Post-v1 monitoring task; not a foundations
  followup.

No new entries in `followups.md` or `parked.md`.

## Integration plan

Files touched in the integration commit:

- **NEW** `docs/ui/foundations/mobile/layout.md` — canonical
  primitive set, decision tree, mapping rules, stacking rules,
  surface bindings, sheet behavior rules.
- **NEW** `docs/ui/foundations/mobile/layout.html` — interactive
  demo: each primitive rendered, viewport toggle to see expressions
  per tier.
- **NEW** `docs/explorations/2026-05-01-mobile-layout.md` — this
  record.
- **EDIT** `docs/ui/foundations/mobile/README.md` — Files list adds
  `layout.md` and `layout.html`. Sessions list session 3 status
  changes from pending to landed.

Renames / heading changes: none.

Patterns adopted on a new surface: none. The new files cite
`principles.md` (settings routing), `responsive.md` (tier
vocabulary), `navigation.md` (chrome layers), `save-sessions.md`
(quick-edit exception, navigate-away guard), `data.md` (raw JSON
viewer), `motion.md` (durations), `spacing.md` (depth metaphor,
padding tokens). All content references; no Used-by updates needed
since `layout.md` is foundations not a screen.

Followups resolved: none in `followups.md` reference layout
primitives. The user's tall-sheet idea wasn't a followup; it was
session-3 input.

Followups introduced: none. Sheet library choice bundles with
session 7 (implementation). Drag dismissal threshold per platform
is session 6.

Wireframes updated: one new (`layout.html`); no existing
wireframes touched.

Intentional repeated prose: the primitive set and decision tree
appear in this exploration record AND in `mobile/layout.md`.
Standard exploration-record duplication.

## Self-review

- **Placeholders.** None — every "session N owns" forward
  reference names the session.
- **Internal consistency.** Tier boundaries (640 / 1024) match
  session 1. Top-bar references match session 2. Existing
  vocabulary terms (peek drawer, popover, modal) preserved
  semantically.
- **Scope.** Single integration; layout primitives only. No
  collapse / touch / platform rules creep in — verified each
  section ends in either the contract value or "session N owns."
- **Ambiguity.** "Tall Sheet" defined as ~85–95% with parent
  visible at top edge — concrete enough. "Tiny popover" defined
  as ≤ 200px content — concrete enough. Sheet anchor rules
  (bottom phone, right desktop) explicit.
- **Doc rules.** Anchor links resolve. No `+` separators in prose
  that could trip prettier wrap-mangling.
