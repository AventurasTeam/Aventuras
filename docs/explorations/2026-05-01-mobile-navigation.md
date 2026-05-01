# Mobile foundations — navigation paradigm (session 2)

Session 2 of the mobile-foundations design pass (per
[`../ui/foundations/mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)).
Pins **how mobile users move around the app** — top-bar inheritance,
cross-surface navigation, what new chrome (if any) phone gets, and
how the existing desktop-side stack-aware Return + Settings-icon
scope rules carry over.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/mobile/navigation.md`](../ui/foundations/mobile/navigation.md).

## Decisions locked entering this session

Reached through dialogue (with adversarial back-and-forth on the
chrome shape):

- **No new chrome layer on phone.** Top-bar discipline survives.
  The desktop nav model — Actions menu + right-rail Browse +
  peek-then-open-in-panel — carries over. No bottom tabs, no
  left-side drawer.
- **Phone: slim single-row top bar + reader-only chip strip.**
  The eight-element overcrowding visible at `~569 px` browser
  width gets resolved by migrating the reader-only chips
  (chapter, time, branch) into a slim strip below the top bar.
  The top bar itself is single-row, icons + truncated title.
- **Tablet inherits desktop chrome verbatim.** At 640–1023 px the
  full single-row top bar with chips inline fits. No chip strip
  on tablet. Tablet uses the desktop nav model unmodified.
- **Stack-aware Return rule already covers the back-to-exit
  case.** Per
  [`../ui/principles.md → Stack-aware Return`](../ui/principles.md#stack-aware-return),
  empty-stack Return surfaces a confirm dialog before exit. The
  user surfaced this from old-app pain ("library + system back =
  silent exit"); the rule was already there. Mobile inherits, no
  new rule needed this session.
- **Settings-icon scope rule inherits unchanged.** `⚙` (App
  Settings) on app-level surfaces, `⛭` (Story Settings) on
  in-story surfaces. App Settings reachable from in-story via
  Actions menu. Same vocabulary across tiers.

## Background — what the screenshot evidence showed

User shared a desktop browser narrowed to 569 × 793 (which lands
in **phone tier** per the foundations contract — just under the
640 boundary). The reader top-bar at that width carried eight
chrome elements competing for one row:

```
[A] [Aria's Descent ▾] [· Chap 3 ▾] [· Day 3 dusk ▾] [⎇3] [⚲] [⛭] [←]
```

At 569 px the strip is uncomfortable; at a real phone (390 CSS
px wide) it would either truncate to illegibility, line-break
unpredictably, or squish glyphs together. The eight-element
contract is the desktop reader's full chrome (universal essentials

- universal in-story + reader-only chips, per the
  [2026-04-28 in-story top-bar amendment](./2026-04-28-in-story-top-bar-and-settings-routing.md)).

This isn't a contract problem — the contract is right. It's an
expression problem at narrow widths.

## Adversarial path that led to B

The session opened with three options (A inherit-as-is, B inherit
with compressions, C fresh mobile chrome). The user immediately
ruled out A (insufficient at phone widths) and asked to compare
B and C.

**C as initially proposed was bottom tabs.** A four-tab in-story
nav (Reader / World / Plot / Timeline) below the chrome. Pitched
as iOS-conventional, persistent surface visibility, one-tap
cross-surface.

User pushback caught two flaws:

1. **Desktop also doesn't have one-click cross-surface nav.**
   Desktop's cross-surface model is two-click (Actions menu) or
   many-click (right-rail Browse → peek → "Open in panel"). The
   "C fixes a problem desktop suffers" framing was wrong — desktop
   doesn't suffer; it just doesn't optimize for it. C's
   persistent-tab nav adds a _new_ affordance phone has but
   desktop lacks; cross-tier-consistency price.
2. **Tabs aren't the chat-app pattern.** Discord / Slack / ChatGPT
   / Claude / Telegram / WhatsApp all use **left-side drawer or
   sidebar** for in-app surface navigation, not bottom tabs.
   Bottom tabs in those apps are at the _app shell_ level (Chats /
   Calls / Activity), never inside a single conversation.
   Aventuras' reader is the conversation analog; World/Plot/Timeline
   are _references about that conversation_ — closer to "files" or
   "channels" than "siblings." Drawer territory, not tabs.

C-as-bottom-tabs got dismissed.

**Pivot to D — left drawer.** Drawer-based nav (hamburger icon +
left-edge swipe-in gesture) holding the in-story surface entries.
Pitched as chat-app-conventional, complementing rather than
replacing the right rail.

User pushback caught the underlying tension:

- The right rail is **glanceable** on desktop — it shows entity
  rows + indicators at the edge of the reading surface. Adding a
  left drawer doesn't strictly remove the rail (both edges can
  coexist), but it creates two side-mechanisms doing related
  cross-surface work.
- On a 390 px wide phone with edge chrome on both sides plus top
  bar plus composer, the narrative gets pinched.
- iOS reserves the left edge for swipe-back. A left-edge swipe
  gesture for the drawer would conflict; drawer would have to
  open via hamburger-tap only — losing half the discoverability
  benefit.

D-as-drawer also got dismissed under adversarial review.

**Settled on B (refined).** No new chrome layer on phone:

- Slim single-row top bar (logo + truncated title + icons +
  status pill + ⛭ + ⚲ + ←).
- Reader-only chip strip below the top bar (chapter, time,
  branch). Always shown when on reader; absent on sub-screens.
- Cross-surface nav uses the existing desktop model (Actions menu
  - rail-as-collapsed-by-session-4 + peek-drawer flow).
- Tablet inherits desktop verbatim.
- Title truncates with ellipsis if it overflows; tap reveals the
  full title in a small popover (for overflow only — not a
  general "expand chrome" affordance, no persistency, no state).

## Top-bar shape across tiers

### Phone (`< 640 px`)

```
Top bar (single row):
  [A]  [<truncated story title>]  ······  [pill]  [⛭]  [⚲]  [←]

Progress strip (slim, ~3 px):
  ▰▰▰▰▱▱▱▱▱▱▱  (chapter token usage)

Reader-only chip strip (~36 px):
  [Chap 3 ▾]   [Day 3 dusk ▾]   [⎇3]
   ⤺ horizontally scrollable if all three overflow

Body (reader narrative + composer):
  [                                           ]
  ...
```

On **sub-screens** (World, Plot, Timeline, Story Settings, app-level):

```
Top bar (single row):
  [A]  [<breadcrumb>]  ······  [pill?]  [⛭/⚙]  [⚲]  [←]

Progress strip (in-story only):
  ▰▰▰▰▱▱▱▱▱▱▱

Master-detail sub-header (World / Plot only):
  Characters / Kael

Body:
  ...
```

The top-bar's `[<breadcrumb>]` slot expresses what the desktop
single-row breadcrumb does — `Aria's Descent / World` for the
World screen, `Aria's Descent / Story Settings` for Story Settings,
`Stories` for the app-level story-list landing, etc. Same content
as desktop, just at narrower width. Truncates with ellipsis if
overflowing.

### Tablet (`640–1023 px`)

Identical to desktop. Single-row top bar with chips inline (no
chip strip). At 640–768 px the chip-strip would still mostly fit
inline — width-tier-based rule keeps the contract simple even if
the boundary is approximate. Phone-landscape (~700–900 px wide)
lands here per the width-only foundations contract; whether
height-aware override is needed is **session 4 (collapse rule)**
territory.

### Desktop (`≥ 1024 px`)

Unchanged. Existing chrome.

## Cross-surface navigation across tiers

Same model on every tier:

- **Actions menu (`⚲`)** — direct surface jumps. `Open World`,
  `Open Plot`, `Open Chapter Timeline`, `Open Story Settings`,
  `Open App Settings`. Two-tap cross-surface (open menu, pick
  destination). Same as desktop today.
- **Right rail Browse → peek → open-in-panel** — entity-level
  cross-surface for "I want to look up a specific character /
  thread / lore entry, maybe stay in reader, maybe jump to that
  panel." The rail's phone-tier collapsed form is **session 4**
  (collapse rule); session 2 only commits that it exists in some
  form on phone.
- **Per-row "Open in panel →"** — peek drawers and entity rows
  carry the same Open-in-panel link they do on desktop. Routes to
  the appropriate surface with the row pre-selected.

No drawer, no bottom tabs, no other phone-only nav mechanism.

## Stack-aware Return on mobile

[`../ui/principles.md → Stack-aware Return`](../ui/principles.md#stack-aware-return)
already pins:

- In-session-only stack, reset on app restart.
- Pop semantics: Return = pop one level.
- One-shot return targets (e.g. `Edit info` from story-list).
- **Empty stack: confirm dialog before terminating.**

That last bullet directly resolves the user's old-app pain
("system back from library exited the app silently"). On mobile,
both the chrome `←` button and OS-level back actions (Android
hardware/gesture back, iOS swipe-back from left edge) are bound
to the same stack-aware Return logic. When the stack is empty,
the confirm dialog fires regardless of which trigger fired the
Return.

Mobile inherits this rule unchanged. Session 2 affirms; doesn't
modify principles.md.

The only mobile-specific implementation detail (which is session
6 / platform territory, not session 2) is **how to bind the OS
back actions to the stack-aware Return logic** — Android requires
a `BackHandler` listener, iOS requires intercepting the swipe-back
gesture or letting the navigation library handle it. That's
implementation; the contract here just commits that they ARE bound.

## Settings routing on mobile

Inherits unchanged from
[`../ui/principles.md → Settings icon scope`](../ui/principles.md#settings-icon-scope):

- **App-level surfaces** (story-list, Vault, App Settings,
  Onboarding) — `⚙` in top bar opens App Settings.
- **In-story surfaces** (Reader, World, Plot, Story Settings,
  Chapter Timeline) — `⛭` in top bar opens Story Settings.
- **App Settings from in-story** — Actions menu entry.
- **Story Settings from story-list** — `⋯ → Edit info` boots the
  story and routes (per the existing one-shot return rule).

The two glyphs (`⚙` / `⛭`) need to be glance-distinguishable per
the existing visual-identity constraint. On phone at 24 px icon
size both are still readable at a glance.

## Title truncation on phone

The story title in the top-bar's logo+title slot is the most
likely overflow at narrow widths (`Aria's Descent of the Crown's
Bargain` doesn't fit at 390 px alongside the icon group). Rule:

- **Title truncates with single-line ellipsis** when it overflows
  the available slot.
- **Tap on the truncated title** reveals the full title in a
  small popover (anchored to the title element). Popover dismisses
  on tap-outside or after a brief idle.
- **No persistency** — popover is transient. No `app_settings`
  field, no localStorage, no expand/collapse state.
- **Sub-screens use the same rule** — if a breadcrumb like
  `Aria's Descent / World / Characters / Kael Vex Reborn` exceeds
  the slot, the head (story title) truncates first via standard
  text-ellipsis behavior; reader truncation popover affordance
  doesn't apply on sub-screens (the breadcrumb itself isn't a
  tap-able element by today's spec).

This is the only tap-to-reveal mechanism in mobile chrome.
Distinguishes it from tabs / drawers / sheets (which would all
be larger reveals).

## Adversarial pass

After section approvals, deliberately try to break it.

### Load-bearing assumption

The big assumption: **the desktop cross-surface model (Actions
menu + rail Browse + peek-drawer-then-open-in-panel) works
acceptably well on phone**. We have no direct evidence; we have
indirect evidence (desktop accepts this model, no complaints).
But "acceptable on desktop" doesn't strictly imply "acceptable
on phone" — phone users navigate more (more context-switching),
have less screen real estate to absorb friction, and have
platform expectations the desktop user doesn't have.

Mitigation: **session 4 (collapse rule)** owns the rail's
phone-tier form. If the rail's phone form ends up impractical
(too narrow to be glanceable, awkward to expand), session 4 is
where the alternative gets designed. Session 2 commits the _nav
model_, not the rail's exact rendering.

If post-v1 evidence shows phone users genuinely can't find
cross-surface entries via the existing model, post-v1 mobile
sessions can add a drawer or tab layer without the foundations
needing rewrite — the chrome layer is additive.

### Edge cases

- **Galaxy Fold mid-use transition (cover → main).** When the
  user unfolds, layout reflows from phone (chip strip) to tablet
  (chips inline). Stack survives the reflow (Expo / RN handle
  this natively). No state corruption. Confirmed.
- **Reader chip strip when story has no chapters.** Empty story
  with no chapter/time chips — strip would be empty. Two options:
  (a) hide the strip entirely when empty, (b) render with empty
  state. Lean: (a) hide. Saves vertical space, no information
  loss. Pinned in the canonical doc.
- **Branch chip when story has 1 branch.** Existing rule: branch
  chip is hidden when only 1 branch exists. Phone inherits;
  strip can be 2-element when single-branch.
- **Title truncation on extremely long titles.** If the title is
  pathologically long (50+ chars), the popover may itself be
  multi-line. Acceptable — popover is layout-flexible.
- **Status pill icon-only on phone vs label on desktop.** Status
  pill text ("reasoning…", "generating narrative…") doesn't fit
  in icon-only chrome. On phone, pill renders as icon-only with
  state-distinguished glyph; tap reveals current phase + cancel
  popover (same flow as desktop, narrower expression). This is
  arguably session 5 (touch grammar) territory; flagged but not
  pinned in this canonical doc — affirmed in the chrome sketch
  as "icon-only" placeholder, session 5 fleshes out tap behavior.
- **Actions menu opens as bottom sheet on phone.** Popovers
  near right edge of a 390 px screen would clip; convention is
  bottom sheet on mobile. Session 3 (layout primitives) decides
  the popover-vs-sheet vocabulary; session 2 just commits "the
  Actions menu opens via whatever session 3 specs."

### Read-site impact / doc-integration cascades

- `principles.md → Top-bar design rule` is unchanged in semantics
  — phone is a tier-specific expression of the same contract.
  No principle edit. The mobile-specific expression rules live in
  `mobile/navigation.md` and cite back to principles.md; no
  duplication.
- `principles.md → Stack-aware Return` already covers the
  empty-stack-confirm case the user wanted. No edit.
- `principles.md → Settings icon scope` unchanged. No edit.
- `mobile/README.md` Sessions list updates session 2 from pending
  to landed.
- `mobile/responsive.md` references "the contract everything else
  hangs off" — session 2 is one of the everything-elses. No
  cross-edit needed; the file structure handles it.
- Pre-existing `## Mobile` sections in `branch-navigator.md` and
  `rollback-confirm.md` — branch-navigator's bottom drawer
  pattern is COMPATIBLE with this nav paradigm (the branch chip
  in the chip strip taps to a bottom drawer); rollback-confirm's
  "modal renders identically on mobile" is compatible.
  Session 7's per-screen retrofits will reconcile both verbatim.

### Missing perspective

- **Sync / backup format.** Navigation is purely UI-side. No
  schema impact. ✓
- **Translation pipeline.** Navigation chrome doesn't carry
  user-translatable content (chip labels are short fixed strings
  from the calendar / chapter system, already translation-aware
  in their own surfaces). ✓
- **In-flight generation interaction.** Status pill auto-hides
  when idle, shows during pipeline phases on every in-story
  surface (per the universal-in-story-chrome rule). Nav across
  surfaces during pipeline runs: pill visible on the destination
  surface too, click-to-cancel works. Existing
  edit-restriction-during-generation rule still applies — user
  can navigate (read-only) but mutations are gated. ✓
- **Onboarding / wizard chrome.** Onboarding and Story-creation
  wizard are full-screen takeovers with minimal chrome (per their
  per-screen docs). Phone inherits — no new mobile-specific
  treatment needed; their existing chrome shape (typically just
  a `←` and a screen title) is already phone-friendly.
- **Gesture conflicts with iOS swipe-back.** The chip strip is
  horizontally scrollable; horizontal scroll within a region
  conflicts with iOS's swipe-from-left-edge gesture if scrolling
  starts at the left edge. Mitigation: chip strip starts a few
  pixels in from the screen edge (visual padding), so left-edge
  swipe-back triggers cleanly before chip-strip horizontal scroll
  engages. Standard iOS gesture handling. Flagged for session 5
  (touch grammar) implementation note; session 2 doesn't pin
  the exact pixel offset.

### Verified vs assumed

- **Verified.** Stack-aware Return rule already covers
  empty-stack-confirm (read principles.md). Existing top-bar
  contract carries 8 elements that genuinely overcrowd at 569 px
  (visible in the user's screenshot). Tablet 640–1023 px range
  fits the desktop chrome (single-row + chips inline) — verified
  against the responsive.md tier vocabulary.
- **Assumed.** Cross-surface nav via Actions menu + rail is
  acceptable on phone. Indirect evidence (desktop accepts it),
  no direct phone-user evidence. Mitigated by additive-only fallback
  (post-v1 layer-add if signal surfaces).

## Followups generated

- **Status-pill icon-only expression on phone.** Pill currently
  carries text label on desktop ("reasoning…"). Phone needs
  icon-only with tap-to-reveal phase + cancel. Session 5 (touch
  grammar) territory. Not a parked entry — bundles with session
  5's broader scope.
- **Action-menu / popover sheet behavior on phone.** Popovers
  near screen edges clip; convention is bottom sheet on mobile.
  Session 3 (layout primitives) territory. Bundles with session 3.
- **Phone-landscape disposition** (already noted in session 1's
  contract) stays a session 4 input.

No new entries in `followups.md` or `parked.md`.

## Integration plan

Files touched in the integration commit:

- **NEW** `docs/ui/foundations/mobile/navigation.md` — canonical
  contract: top-bar shape per tier, reader chip strip, cross-
  surface nav model, stack-aware Return inheritance, settings
  routing inheritance, title-truncation rule, tablet specifics.
- **NEW** `docs/ui/foundations/mobile/navigation.html` — interactive
  demo: viewport toggle showing the chrome shape on phone (slim
  top + chip strip), tablet (single-row + chips inline), desktop
  (existing chrome).
- **NEW** `docs/explorations/2026-05-01-mobile-navigation.md` —
  this session record.
- **EDIT** `docs/ui/foundations/mobile/README.md` — Files list
  adds `navigation.md` + `navigation.html`. Sessions list updates
  session 2 from pending to landed with exploration link.

Renames / heading changes: none.

Patterns adopted on a new surface: none. The new files cite
`principles.md` (top-bar rule, stack-aware Return, settings
scope) and `responsive.md` (tier vocabulary), but those are
content references, not "this surface adopts that pattern" —
no Used-by lists need updates.

Followups resolved: none in `followups.md` reference mobile
navigation. (The "old-app library-back-exits" pain wasn't a
followup; it was clarifying input.)

Followups introduced: none. Status-pill phone expression,
action-menu sheet behavior, and phone-landscape disposition
all bundle with their owning sessions (5, 3, 4 respectively),
not separate followups.

Wireframes updated: one new (`navigation.html`); no existing
wireframes touched this session.

Intentional repeated prose: the chrome-shape sketch (phone +
tablet + desktop) appears in this exploration record AND in
`mobile/navigation.md`. Standard exploration-record duplication;
the canonical home wins after integration.

## Self-review

- **Placeholders.** None — every "session N owns" forward
  reference names the session.
- **Internal consistency.** Tier boundaries match session 1
  (640 / 1024). Top-bar element list matches principles.md (5
  universal essentials + 2 universal-in-story + 3 reader-only
  chips). Stack-aware Return rule cited verbatim from
  principles.md.
- **Scope.** Single integration; navigation paradigm only. No
  layout / collapse / touch / platform rules creep in — verified
  each section ends in either the contract value or "deferred to
  session N."
- **Ambiguity.** "Tap title to reveal" — clarified as overflow-only
  (not a general expand affordance), no persistency. "Chip strip
  horizontally scrollable" — clarified as fallback when all three
  chips don't fit, single-branch case omits the branch chip per
  existing rule.
- **Doc rules.** Anchor links resolve (principles.md sections
  spot-checked). No bracketed inline phrases without backticks.
