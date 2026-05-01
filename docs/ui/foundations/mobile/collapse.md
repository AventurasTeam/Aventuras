# Collapse rule

How multi-pane surfaces collapse from desktop / tablet down to
phone-tier 1-pane expressions. Universe is small: only Reader,
World, and Plot are multi-pane in v1, all 2-pane. Tablet inherits
desktop verbatim per
[`./navigation.md → Top-bar shape across tiers`](./navigation.md#top-bar-shape-across-tiers);
the meaningful collapse happens at the phone boundary (< 640 px).

This file is session 4 of the mobile-foundations multi-session pass
(per [`./README.md → Sessions`](./README.md#sessions)). Sister to
[`./responsive.md`](./responsive.md) (tier boundaries),
[`./navigation.md`](./navigation.md) (chrome layers), and
[`./layout.md`](./layout.md) (primitives).

## What this contract pins

- **Master-detail surfaces (World, Plot) collapse list-first** on
  phone — the list is the default visible state; tapping a row
  navigates into the detail as a full-screen route within the
  surface; back returns to the list.
- **Reader collapses to narrative-only on phone** — the rail is
  forced-collapsed to its edge strip (per the existing
  [side-rail collapse spec](../../screens/reader-composer/reader-composer.md#browse-rail--collapse--expand)),
  and **strip-tap on phone opens the rail's content as a bottom
  Sheet** rather than expanding the rail in place (which would
  squeeze the narrative to nothing).
- **Phone landscape uses tablet-tier 2-pane** per the width-only
  responsive contract. The existing rail-collapse threshold
  (~900 px viewport) means the rail is forced-collapsed in
  phone-landscape regardless. World / Plot's list and detail
  remain side-by-side, cramped vertically.
- **State survives reflow** across Galaxy Fold unfold/fold,
  browser resize, orientation change, and Slide Over / Stage
  Manager. RN / Expo's Dimensions listener handles the layout
  re-render; the React tree retains component state (scroll,
  composer text, dirty save-session, etc.).
- **Open sheets dismiss on tier transition** out of phone — if
  the user has the rail-as-sheet open on phone and unfolds to
  tablet, the sheet closes (because the rail is now visible
  inline). Session-7 implementation guidance, not a foundations
  contract clause.

## Per-surface collapse

### Reader / composer (narrative + rail → narrative + rail strip)

Desktop / tablet (≥ 640 px): per the existing layout. Narrative
fills the primary column; rail on the right (open or
collapsed-to-strip per viewport / manual preference). Rail's
viewport-forced-collapse fires below ~900 px (per
[the rail collapse spec](../../screens/reader-composer/reader-composer.md#state-model--manual--viewport-decoupled)),
so iPad portrait and similar narrow tablet widths get the strip
automatically.

Phone (< 640 px):

- **Narrative and composer fill the screen width.** No 2-pane
  layout on phone.
- **Rail is always collapsed to edge strip** on phone — the
  existing viewport-forced-collapse rule (active below ~900 px)
  produces this outcome. Phone is a strict subset of the existing
  forced-collapsed range.
- **Strip tap on phone opens the rail's content as a bottom
  Sheet** (per [layout primitives → Sheet](./layout.md#sheet)).
  Initial Sheet height: medium (~50–60% per layout.md). Sheet
  contains the rail's full vocabulary — category dropdown, filter
  chips, search, row list, Import affordance — same content as
  desktop rail.
- **Tap a row inside the sheet → sheet swaps to peek view.**
  Same internal navigation as the desktop peek drawer. Sheet
  height may grow to tall (~85–95%) when peek loads. Sheet's
  own back affordance returns to the row-list state.
- **Peek's "Open in panel →" link** dismisses the sheet and
  routes to World / Plot per the cross-surface nav model
  (per [navigation.md → Cross-surface navigation](./navigation.md#cross-surface-navigation-model)).
  On phone, the destination opens at its detail-route state with
  the row pre-selected (skipping the list-first state on first
  mount).
- **Drag-down dismiss on the rail-sheet** closes the sheet
  entirely regardless of state (row-list or peek). Single-step
  dismiss; the sheet's internal back is for going from peek
  back to row-list state, not for staged dismissal.
- **Save-session quick-edit exception** carries through — in-sheet
  peek edits commit on field blur per
  [`patterns/save-sessions.md → Quick-edit exception — peek drawer`](../../patterns/save-sessions.md#quick-edit-exception--peek-drawer).

The strip-tap behavior is **tier-aware**: in-place expand on
desktop+tablet, sheet on phone. Same trigger, different action,
appropriate to the tier's available real estate.

### World — kind selector + list + detail (master-detail)

Desktop / tablet (≥ 640 px): per
[`world.md → Layout`](../../screens/world/world.md#layout). List
pane on left (~340 px), detail pane on right (flex). Sub-header
above (`Characters / Kael Vex`).

Phone (< 640 px):

- **List-first.** Surface entry shows the list with category
  dropdown / filter chips / search / rows. Sub-header sits above
  the list (`Characters` — currently active filter).
- **Tap a row → detail slides in as a full-screen route** within
  the World surface. The detail-route's chrome includes
  back-on-left (per
  [the top-bar amendment](../../../explorations/2026-05-01-top-bar-left-slot-scope.md))
  which returns to the list state. Sub-header at the route-level
  (`Characters / Kael Vex`) sits below the top bar.
- **Detail tabs** (Overview / Identity / Carrying / Connections /
  Settings / Assets / Involvements / History for characters,
  fewer for other kinds) work as on desktop — internal tab nav
  within the detail route.
- **Save-session navigate-away guard** fires on the back action
  if the detail is dirty (per
  [`patterns/save-sessions.md`](../../patterns/save-sessions.md)).
  Confirm modal asks discard / save; same as desktop.
- **Per-row import** affordance (per
  [`world.md → Per-row import`](../../screens/world/world.md#per-row-import))
  is in the list state; tap-to-import opens its modal as on
  desktop.
- **List-first on first mount** unless the user navigated to the
  surface from a peek's "Open in panel →" link — in which case
  the route-stack lands on detail with the row pre-selected.
  First back returns to list state.

### Plot — thread / happening list + detail

Same shape as World — 2-pane master-detail with same collapse
pattern. Phone behavior identical to World's: list visible by
default; tap a row → detail full-screen route; back returns to
list; save-session guard on dirty back.

The thread / happening detail content differs from World's
character / lore detail content, but the collapse pattern doesn't.

### Single-pane surfaces — no collapse

Chapter Timeline, Story Settings, Story list, Vault, App Settings,
Onboarding, Wizard are all 1-pane. No collapse rule applies;
phone tier just renders the same single content at narrower
width.

## Phone landscape

Phone landscape (~700–900 px CSS-px wide) lands in tablet tier
per the [responsive contract](./responsive.md). Width-only rule;
no height-aware override.

What this means in practice:

- **Reader in phone-landscape**: 2-pane (narrative +
  collapsed-rail-strip). Same as iPad portrait.
- **World / Plot in phone-landscape**: 2-pane (list and detail).
  List ~340 px, detail ~360–560 px in 700–900 width. Cramped
  but usable.
- **Single-pane surfaces in phone-landscape**: same as desktop /
  tablet, just at narrower width and shorter height.

If post-v1 user testing surfaces phone-landscape usability
problems — typical use case is rare for this app — a height-aware
override can be added without foundations rewrite. Width-only is
the simpler default; override is a reactive escape hatch.

## State preservation on reflow

Reflow events covered:

- **Galaxy Fold unfold** (phone → tablet): state survives.
- **Galaxy Fold fold** (tablet → phone): state survives. The
  rail's tablet "collapsed-strip" state translates to phone's
  "rail-as-sheet-on-tap" state — tap-to-expand on tablet
  re-expands the rail; tap-to-expand on phone opens the sheet.
- **Browser window resize** (desktop → tablet → phone): same
  reflow behavior; state survives.
- **Orientation change** (portrait ↔ landscape on phone or
  tablet): width-driven; layout reflows per current width tier.
- **iOS Slide Over / Stage Manager** style multi-window: app's
  reported width changes; same width-driven reflow applies.

What's NOT preserved across tier transitions:

- **Open sheets and modals on phone dismiss when the layout
  transitions out of phone tier.** User opens the rail-sheet on
  phone, then unfolds Galaxy Fold; the sheet closes because the
  rail is now visible inline on tablet. Folding the device back
  collapses the rail to strip; tap re-opens the sheet. Sheet
  state is not persisted across the reflow.

This is session-7 implementation guidance, not a foundations
contract clause.

## Interactions with other foundations

- **Edit restrictions during in-flight generation** (per
  [`principles.md`](../../principles.md#edit-restrictions-during-in-flight-generation))
  apply to detail tabs on World / Plot. Phone master-detail
  collapse doesn't change the restriction set; nav is allowed
  read-only, mutations blocked while pipeline is in flight.
- **Stack-aware Return** (per
  [`principles.md → Stack-aware Return`](../../principles.md#stack-aware-return))
  governs back actions in the detail route. List-first
  collapse means "back from detail" pops to "list state of the
  same surface," not to the prior surface — the master-detail
  is a sub-stack within World / Plot.
- **Settings-icon scope** (per
  [`principles.md → Settings icon scope`](../../principles.md#settings-icon-scope))
  applies. Detail-route on phone is in-story chrome (`⛭` for
  Story Settings).

## What this contract does NOT pin

- **Sheet drag-dismiss threshold per platform** — session 6.
- **Touch-grammar specifics** for the rail-strip tap, master-
  detail row-tap, peek's "Open in panel" tap — session 5
  (touch grammar).
- **Per-screen retrofits** of the existing wireframes (reader,
  world, plot, etc.) to render the responsive collapse — session 7. The current wireframes show desktop layout only; tap-and-see
  the phone collapse via the [collapse.html demo](./collapse.html)
  for now.
- **Open-sheet auto-dismiss on reflow** is implementation
  guidance, not a contract clause — session 7 picks the exact
  behavior.
