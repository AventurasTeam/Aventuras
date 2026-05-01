# Mobile foundations — session 7 group B (reading flow)

Per-screen retrofit pass for the three "reading flow" surfaces:
[reader-composer](../ui/screens/reader-composer/reader-composer.md),
[branch-navigator](../ui/screens/reader-composer/branch-navigator/branch-navigator.md),
and
[rollback-confirm](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md).
Second of four grouped consumer-pass sessions per
[`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions).

The substrate (sessions 1–6) carries every contract these surfaces
consume; this pass is **mechanical retrofit plus reconciliation**.
Reconciliation matters here because two of the three surfaces have
pre-foundations `## Mobile` sections written before the substrate
landed:

- `branch-navigator.md → ## Mobile — bottom drawer` was written
  before the layout primitive vocabulary existed; "bottom drawer"
  is the same primitive as a bottom-anchored Sheet. Renames to
  `## Mobile expression`, prose updated to use Sheet (short)
  terminology.
- `rollback-confirm.md → ## Mobile` similarly renames to
  `## Mobile expression`; content already aligns with the
  substrate (modal stays modal, hover-preview is desktop-only).
- `reader-composer.md` has scattered inline phone mentions but no
  dedicated section — gains a fresh `## Mobile expression`
  section.

## Surface inventory

| Surface          | Pre-foundations Mobile section?   | Tier shape                          | Reconciliation work                                                    |
| ---------------- | --------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| reader-composer  | No (scattered inline mentions)    | 2-pane → 1-pane on phone            | New `## Mobile expression`; rail strip-tap-as-sheet; chip strip below  |
| branch-navigator | Yes (`## Mobile — bottom drawer`) | Single popover; Sheet (short) phone | Rename heading; rewrite to use Sheet vocabulary; drop 480 px width cap |
| rollback-confirm | Yes (`## Mobile`)                 | Modal all tiers                     | Rename heading; cite layout / touch foundations                        |

## Per-surface design

### reader-composer

The most substantive surface in the group — the core 2-pane
narrative+rail layout collapses to 1-pane on phone per
[`collapse.md → Reader / composer`](../ui/foundations/mobile/collapse.md#reader--composer-narrative--rail--narrative--rail-strip),
and several phone-tier behaviors layer on top.

**Top-bar shape.** Phone gets the slim single-row top-bar plus the
reader-only chip strip below per
[`navigation.md → Reader (phone)`](../ui/foundations/mobile/navigation.md#phone--640-px).
Layout: `[←] [story-title…] [status-pill] [⛭] [⚲]`. The story
title truncates with ellipsis; tap reveals the full title in a
transient popover per
[`touch.md → Tap-to-tooltip on inert chrome text`](../ui/foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text).

**Reader chip strip (phone-only).** Below the top-bar:
`[Chapter ▾] [<time chip>] [⎇N]`. Horizontally scrollable when
overflowing; ~16 px left padding doubles as iOS swipe-back safe
zone per
[`touch.md → Chip-strip safe zone`](../ui/foundations/mobile/touch.md#chip-strip-safe-zone).
Chip popover bindings:

- **Chapter chip popover** → Sheet (medium, bottom) on phone per
  [`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
  Multi-row content (chapter list, progress bar, manage-chapters
  link) exceeds the tiny-popover threshold.
- **Time chip popover** → stays Popover all tiers — tiny content
  (era label and `Flip era…` action).
- **Branch chip popover** → Sheet (short, bottom) on phone per
  the same binding table; same primitive specced in
  branch-navigator's `## Mobile expression` section below.

**Status pill on phone.** Icon-only (the desktop label
`reasoning…` doesn't fit narrow chrome). Tap reveals current
phase plus cancel in a Popover anchored to the pill per
[`touch.md → Status pill on phone`](../ui/foundations/mobile/touch.md#status-pill-on-phone).
Same cancel-pipeline flow as desktop.

**Browse rail collapse.** Phone is a strict subset of the existing
viewport-forced-collapse threshold (~900 px per
[`reader-composer.md → State model — manual + viewport, decoupled`](../ui/screens/reader-composer/reader-composer.md#state-model--manual--viewport-decoupled)),
so the rail is always strip-collapsed on phone. The
strip-tap-on-phone behavior is **tier-aware** per
[`collapse.md → Reader / composer`](../ui/foundations/mobile/collapse.md#reader--composer-narrative--rail--narrative--rail-strip):

- **Desktop / tablet:** strip-tap restores the rail in place
  (existing behavior).
- **Phone:** strip-tap opens the rail's content as a **Sheet
  (bottom, medium ~50–60 % initially)** — would-be in-place
  expansion would squeeze the narrative to nothing at 390 px.

The Sheet contains the full rail vocabulary (category dropdown,
filter chips, search, row list, Import affordance). Tap a row
inside the sheet → sheet swaps to peek view (Sheet may grow to
tall ~85–95 % when peek loads, matching the
[Peek drawer mapping](../ui/foundations/mobile/layout.md#mapping--desktop-to-mobile)).
Sheet's own back affordance returns row-list state. Peek's
`Open in panel →` link dismisses the sheet and routes to World /
Plot per the cross-surface nav model. Drag-down on the rail-sheet
dismisses entirely regardless of state.

The peek-drawer / rail mutual-exclusion invariant per
[`reader-composer.md → Peek drawer — peek implies rail open`](../ui/screens/reader-composer/reader-composer.md#peek-drawer--peek-implies-rail-open)
holds on phone — peek is reachable only via row-tap inside the
rail-as-sheet, never independently.

**Composer keyboard handling.** Per
[`platform.md → Keyboard avoidance`](../ui/foundations/mobile/platform.md#keyboard-avoidance):
`KeyboardAvoidingView` reflows narrative and composer above the
keyboard. The narrative scroll view shrinks; latest entry stays at
the top of the visible scroll region per the existing scroll-
behavior rule. Composer textarea sits directly above the keyboard;
send button and mode picker remain visible.

**Suggestion panel** (between latest entry and composer per
[`reader-composer.md → Screen-specific notes`](../ui/screens/reader-composer/reader-composer.md#screen-specific-notes))
moves up with the composer when the keyboard opens — it's content,
not chrome, and keyboard avoidance treats it the same as the
composer.

**Per-entry actions** stay always-visible-muted per
[`patterns/icon-actions.md → Visibility`](../ui/patterns/icon-actions.md#visibility--always-rendered-muted-default-brighten-on-hover);
no tier-specific change. Touch users see the icons at the muted
default; taps trigger normally.

**Modals.** Branch creation, rollback confirm, era flip, and
chapter close all stay Modal all tiers per the layout binding
table.

**Stack-aware Return.** The chrome `←` plus Android `BackHandler`
plus iOS swipe-back all bind to the existing stack-aware Return
logic per
[`navigation.md → Stack-aware Return on mobile`](../ui/foundations/mobile/navigation.md#stack-aware-return-on-mobile).
Empty-stack-confirm is Android-relevant primarily per
[`platform.md → OS back integration`](../ui/foundations/mobile/platform.md#os-back-integration).

### branch-navigator

Pre-foundations `## Mobile — bottom drawer` heading reconciles to
`## Mobile expression`; the prose moves to Sheet vocabulary. The
underlying primitive doesn't change — "bottom drawer" was the
same primitive a bottom-anchored Sheet now is — so existing prose
maps almost line-for-line:

- "Slides up from the bottom edge of the viewport" → Sheet
  (bottom-anchored) per
  [`layout.md → Sheet`](../ui/foundations/mobile/layout.md#sheet).
- "Full viewport width, capped to ~480 px" → **drop the 480 px
  cap.** Bottom Sheets on phone are full-width edge-to-edge per
  the foundations contract; the cap was a pre-foundations guess
  from before the substrate landed.
- "Grab handle at the top edge as the dismissal cue" → matches
  [`layout.md → Sheet behavior`](../ui/foundations/mobile/layout.md#sheet-behavior--additional-rules)
  ("Bottom-anchored sheets render a small drag handle"). Same
  primitive.
- "Drag-down on the handle or tap-on-backdrop dismisses" →
  matches the layout contract.
- "Same content, same per-row layout. Action icons follow the
  icon-actions pattern" → unchanged; touch grammar's
  hover-translation rule already lives in `touch.md` and the
  pattern doc.
- "Inline rename and delete-confirm work identically" → unchanged.
- "The creation modal is unchanged on mobile — modals already
  work the same way" → matches layout binding (Modal all tiers).

**Sheet height variant**: short per the binding table —
single-purpose row list with header and minimal chrome fits the
~30 % viewport height.

**Tablet** inherits desktop verbatim — anchored Popover, not
Sheet. The phone-tier Sheet expression is a phone-specific
deviation.

### rollback-confirm

Heading rename from `## Mobile` to `## Mobile expression`; content
already aligns with the substrate so the body is mostly preserved:

- "Modal renders identically on mobile (modals already
  cross-platform)" → matches
  [`layout.md → Modal`](../ui/foundations/mobile/layout.md#modal)
  ("Same expression on every tier").
- "Hover-preview is desktop-only; touch has no hover state" →
  matches
  [`touch.md → Hover translation`](../ui/foundations/mobile/touch.md#hover-translation)
  (rollback-row hover-preview row "desktop-only; no touch
  fallback (taps trigger)").
- "Tap-and-hold as a fallback is deferred — same treatment as the
  icon-actions mobile rule (touch sits at muted default, taps
  trigger directly)" → matches the gesture vocabulary explicitly
  (no long-press for actions per
  [`touch.md → Gesture vocabulary`](../ui/foundations/mobile/touch.md#gesture-vocabulary)).

The cross-reference to branch-navigator's mobile note updates to
the new anchor (`#mobile-expression` instead of
`#mobile--bottom-drawer`).

## Adversarial pass

**Load-bearing assumption.** The reader's existing rail-collapse
viewport threshold (~900 px) is strict enough that phone (< 640)
always lands in forced-collapse. Verified by reading the existing
threshold spec — phone is unambiguously below. If the threshold
ever loosens, phone could lose the strip-tap-as-sheet behavior;
the contract is stable as long as the threshold > 640.

**Edge cases.**

- **Composer with keyboard open while status pill is active**
  (generation in flight). Status pill tap opens a Popover; with
  keyboard open, the popover may overlap the keyboard. The
  popover is tiny (single phase line plus cancel) and anchors to
  the pill in the top bar; popover sits above the keyboard
  visually. No new contract clause needed.
- **Rail-as-sheet open, then branch chip tap** (would normally open
  branch nav as Sheet). Sheet over Sheet not allowed per
  [`layout.md → Stacking`](../ui/foundations/mobile/layout.md#stacking)
  — the rail-sheet dismisses, branch-nav-sheet replaces. Verified
  by the layout stacking rule.
- **Peek with awareness link to entity not yet introduced** —
  same data shape as desktop; peek surface unchanged. No
  phone-specific issue.
- **Long story title at narrow phone width** — truncates with
  ellipsis; tap reveals via popover per touch.md. Verified rule.
- **Chip strip overflow at extreme narrow** (320 px Galaxy Z Fold
  cover, below the supported tier minimum). Strip horizontal-
  scroll degrades; `[⎇N]` already drops on single-branch stories
  per
  [`navigation.md → Reader chip strip`](../ui/foundations/mobile/navigation.md#reader-chip-strip-phone-only).
  Acceptable.
- **Rollback confirm modal during generation** — branch-navigator
  spec already disables the trigger during generation, so the
  modal can't open. No phone-specific change.

**Read-site impact.** Five inbound anchor references to the
old `#mobile--bottom-drawer` and `#mobile` slugs need updating:

- `docs/ui/foundations/mobile/responsive.md:137` (pre-foundations
  stance section — now resolved).
- `docs/ui/foundations/mobile/layout.md:277` (pre-foundations
  naming section — now resolved).
- `docs/ui/screens/reader-composer/rollback-confirm/rollback-confirm.md:130`
  (cross-ref to branch-navigator — handled in this same commit).
- `docs/explorations/2026-05-01-mobile-foundations.md:207, 209`
  (historical record — anchor updates only, content preserved).
- `docs/explorations/2026-05-01-mobile-layout.md:59` (historical
  record — anchor update only).

**Doc-integration cascades.** The pre-foundations stance section
in `responsive.md` (lines 132–149) becomes partially obsolete —
two of its three example surfaces now have `## Mobile expression`
sections that consume the substrate. Rather than delete the
section (which carries the forward-only stance about the third
surface — `reader-composer.md` line 170 "same affordance on
desktop and mobile" — and any other future drift), update its
prose to reflect that two of the three are now reconciled, and
the third (reader-composer's inline mentions) folds into Group
B's new section.

The `layout.md → Pre-foundations naming` section (lines 264–286)
similarly references "bottom drawer" as a pre-foundations term;
update to note the reconciliation.

**Missing perspective.**

- **Tablet expression for the reader chip strip.** Per
  navigation.md the chip strip is phone-only; tablet inherits the
  desktop chip-inline-in-top-bar pattern. Verified.
- **Phone landscape** (~700–900 px) lands in tablet tier —
  reader's rail is forced-collapsed (because tablet width is
  still below the 900 px rail threshold), but no chip strip
  (because that's phone-only). Verified by composing
  navigation.md and reader's rail-collapse spec.

**Verified vs assumed.**

- **Verified.** Rail-collapse threshold, layout binding table
  entries, hover-translation rule scope, modal-stays-modal rule,
  chip-strip safe zone, status-pill icon-only on phone, peek-rail
  mutual exclusion.
- **Assumed.** Rail-as-sheet starts at medium height, grows to
  tall when peek loads — extending
  [`layout.md → Sheet`](../ui/foundations/mobile/layout.md#sheet)
  height variants by sequence rather than picking one. Reasoning:
  row-list state (medium) and peek state (tall) are distinct
  visual densities; growing the sheet on state transition matches
  the natural content. If implementation finds the height
  transition janky, locking to tall throughout is the fallback.

## Integration plan

**Files changed.**

- [`docs/ui/screens/reader-composer/reader-composer.md`](../ui/screens/reader-composer/reader-composer.md)
  — add `## Mobile expression` section before
  `## Data-model touchpoints`. Cite responsive / navigation /
  layout / collapse / touch / platform.
- [`docs/ui/screens/reader-composer/reader-composer.html`](../ui/screens/reader-composer/reader-composer.html)
  — add viewport toggle review-bar group; container-query reflow
  for top-bar collapse, chip strip below at phone, rail forced-
  collapsed on phone, status-pill icon-only on phone.
- [`docs/ui/screens/reader-composer/branch-navigator/branch-navigator.md`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md)
  — rename `## Mobile — bottom drawer` to `## Mobile expression`;
  rewrite prose to Sheet (short) vocabulary; drop the 480 px
  width cap. Cite layout / touch foundations.
- [`docs/ui/screens/reader-composer/branch-navigator/branch-navigator.html`](../ui/screens/reader-composer/branch-navigator/branch-navigator.html)
  — add viewport toggle; container-query reflow showing popover
  on tablet+ vs Sheet on phone.
- [`docs/ui/screens/reader-composer/rollback-confirm/rollback-confirm.md`](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md)
  — rename `## Mobile` to `## Mobile expression`; cite layout /
  touch foundations; update inbound cross-ref to branch-navigator.
- [`docs/ui/screens/reader-composer/rollback-confirm/rollback-confirm.html`](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.html)
  — add viewport toggle; container-query reflow (modal stays
  centered all tiers).
- [`docs/ui/foundations/mobile/responsive.md`](../ui/foundations/mobile/responsive.md)
  — update the pre-foundations stance section to reflect Group B
  reconciliation of branch-navigator and rollback-confirm sections.
- [`docs/ui/foundations/mobile/layout.md`](../ui/foundations/mobile/layout.md)
  — update the pre-foundations naming section to reflect that
  branch-navigator now uses Sheet (short) terminology.
- [`docs/ui/foundations/mobile/README.md`](../ui/foundations/mobile/README.md)
  — Sessions list, mark Group B as landed with link to this
  exploration record.
- [`docs/explorations/2026-05-01-mobile-foundations.md`](./2026-05-01-mobile-foundations.md)
  — anchor-only updates on lines 207 and 209 (`#mobile--bottom-drawer`
  → `#mobile-expression`; `#mobile` → `#mobile-expression`).
- [`docs/explorations/2026-05-01-mobile-layout.md`](./2026-05-01-mobile-layout.md)
  — anchor-only update on line 59.

**Renames.**

- `branch-navigator.md` heading: `## Mobile — bottom drawer` →
  `## Mobile expression`. Slug change: `mobile--bottom-drawer` →
  `mobile-expression`. All 5 inbound anchor refs updated in this
  commit.
- `rollback-confirm.md` heading: `## Mobile` → `## Mobile expression`.
  Slug change: `mobile` → `mobile-expression`. All 2 inbound
  anchor refs updated in this commit.

**Followups in/out.** No followup or parked entry covers Group B's
mobile retrofit on these surfaces; nothing to remove. None
introduced.

**Patterns adopted on a new surface.** None — all citations are to
foundations docs, not patterns. icon-actions is already cited by
reader-composer (per-entry actions); branch-navigator already
cites it; rollback-confirm already cites it. No Used-by drift.

**Wireframes updated.** Three per-screen wireframes gain the
viewport toggle and container-query reflow. Two foundations docs
get pre-foundations-stance updates. The mobile README's Sessions
list updates Group B status.

**Intentional repeated prose.** Each surface's `## Mobile
expression` section opens with a similar framing sentence
(consistent with Group A's pattern). Surface-specific content
diverges immediately. No boilerplate concern beyond what Group A
already accepted.
