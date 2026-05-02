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

- **Two-pane navigation surfaces (World, Plot, Settings) collapse
  list-first** on phone — the list is the default visible state;
  tapping a row navigates into the content as a full-screen route
  within the surface; back returns to the list. Same rule across
  all three; desktop visual primitive differs (separate panes for
  World/Plot, left rail for Settings) but the phone collapse
  mechanism is identical.
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
- **Rail is not visible in-place on phone.** Phone width is a
  strict subset of the existing viewport-forced-collapse range
  (~900 px). The right-edge strip — a desktop folded-rail
  affordance — is dropped on phone; right-edge trigger plus a
  bottom-anchored sheet creates a directional mismatch the strip
  was carrying as vestigial desktop chrome. The rail column hides
  entirely.
- **Browse trigger lives in the reader chip strip on phone** as a
  right-anchored `[☰ Browse]` chip per
  [`navigation.md → Reader chip strip`](./navigation.md#reader-chip-strip-phone-only).
  Bottom-anchored chip plus a bottom-anchored sheet — direction
  matches.
- **Tap the Browse chip on phone → opens the rail's content as
  a bottom Sheet** (per [layout primitives → Sheet](./layout.md#sheet)).
  Initial Sheet height: medium (~50–60% per layout.md). Sheet
  contains the rail's full vocabulary — category dropdown, filter
  chips, search, row list, Import affordance — same content as
  desktop rail.
- **Tap a row inside the sheet → sheet swaps to peek view.**
  Same internal navigation as the desktop peek drawer, but a
  single sheet element morphs content (not Sheet over Sheet,
  which is disallowed per [`./layout.md → Stacking`](./layout.md#stacking)).
  Sheet height may grow to tall (~85–95%) when peek loads.
- **In peek state, sheet head shows an icon-only `←` back
  affordance at the top-left** in place of the desktop `×`. Tap
  returns to row-list state. Icon-only — the arrow is the
  universal back affordance, no text label needed; the head uses
  flex-start so the entity meta sits close after the arrow
  (iOS nav-header layout). The desktop × is desktop chrome —
  sheets on phone dismiss via the handle (drag-down) or backdrop
  (tap-outside) per the Sheet primitive contract; the head's
  left affordance is internal navigation, not dismissal.
- **Peek's "Open in panel →" link** dismisses the sheet and
  routes to World / Plot per the cross-surface nav model
  (per [navigation.md → Cross-surface navigation](./navigation.md#cross-surface-navigation-model)).
  On phone, the destination opens at its detail-route state with
  the row pre-selected (skipping the list-first state on first
  mount).
- **Drag-down handle and backdrop tap** dismiss the whole sheet
  regardless of state (row-list or peek). The sheet's `←`
  internal back is for going from peek back to row-list, not for
  staged dismissal.
- **Save-session quick-edit exception** carries through — in-sheet
  peek edits commit on field blur per
  [`patterns/save-sessions.md → Quick-edit exception — peek drawer`](../../patterns/save-sessions.md#quick-edit-exception--peek-drawer).

The Browse trigger is **tier-aware**: right-edge strip with
in-place expand on desktop+tablet, chip-strip Browse chip with
bottom Sheet on phone. Different trigger, different action,
appropriate to the tier's available real estate.

### Two-pane navigation surfaces (World, Plot, Settings)

Desktop / tablet (≥ 640 px): a navigation list region on the left
plus a content region on the right. Visual primitive differs by
surface:

- **World** — separate list pane (~340 px) + detail pane (flex)
  with sub-header above (`Characters / Kael Vex`). Per
  [`world.md → Layout`](../../screens/world/world.md#layout).
- **Plot** — same separated 2-pane shape as World. Per
  [`plot.md → Layout`](../../screens/plot/plot.md#layout).
- **Story Settings, App Settings** — left rail (~200 px) with
  uppercase section headers grouping tabs + content pane (flex).
  No search / filter / footer-action chrome on the rail, but the
  navigation function is the same: pick a row, see content. Per
  [`story-settings.md → Layout`](../../screens/story-settings/story-settings.md#layout)
  and
  [`app-settings.md → Layout`](../../screens/app-settings/app-settings.md#layout).

Phone (< 640 px) — same collapse for all three surface families:

- **List-first.** Surface entry shows the navigation list as the
  default visible state. World/Plot's list shows entity rows with
  category dropdown / filter chips / search / footer "+ New".
  Settings's list shows the section-grouped tabs as a vertical
  scroll list with uppercase section headers as non-tappable
  group separators.
- **Tap a row → content slides in as a full-screen route** within
  the surface. The content-route's chrome includes back-on-left
  (per
  [the top-bar amendment](../../../explorations/2026-05-01-top-bar-left-slot-scope.md))
  which returns to the list state. Sub-header / breadcrumb at the
  route level shows the selected row context
  (`Characters / Kael Vex`, `Story Settings / Generation`).
- **Surface-specific content shape carries over** — World/Plot
  detail-routes have their own internal tab navigation (handled
  by the [Group C tab-strip overflow rule](../../../explorations/2026-05-01-mobile-group-c-master-detail.md#tab-strip-overflow-rule));
  Settings content-routes are flat form-field surfaces (no nested
  tabs).
- **Save-session navigate-away guard** fires on the back action
  if the content is dirty (per
  [`patterns/save-sessions.md`](../../patterns/save-sessions.md)).
  Confirm modal asks discard / save; same as desktop.
- **Per-row import** (World/Plot only) and other list-state
  affordances open their modals as on desktop.
- **List-first on first mount** unless the user navigated to the
  surface from a deep link (e.g., a peek's "Open in panel →"
  routes World/Plot directly to detail with the row pre-selected;
  App Settings global-error-banner CTAs route directly to a
  specific tab). First back returns to list state.

### Vault home — rail-hidden phone deviation (v1)

Vault home (Layer 0+1 per
[`calendars.md → Layout — Vault home`](../../screens/vault/calendars/calendars.md#layout--vault-home-layer-01))
has a categories rail with one active entry (Calendars) plus
three disabled placeholders (Packs / Scenarios / Templates — all
deferred per the existing per-screen note). The two-pane
navigation collapse rule above doesn't apply cleanly because the
"list" is mostly empty navigation:

- **Phone (v1)**: rail hidden entirely; surface opens directly on
  the active category's content (Calendars grid). Top-bar
  breadcrumb reads `Vault / Calendars`.
- **Tablet / desktop**: 2-pane (rail + grid) unchanged.
- **When a second vault category ships**: switch to the standard
  two-pane navigation collapse rule (rail flattens to a list,
  tap → category content as inner route).

Vault calendar detail (Layer 2) is a single-pane full canvas with
sections stacked vertically (DETAIL HEAD / DEFINITION / LABELS /
DISPLAY PREVIEW / SAVE BAR) — no collapse applies; phone reflows
each section naturally.

### Single-pane surfaces — no collapse

Chapter Timeline, Story list, Onboarding, Wizard are all 1-pane.
No collapse rule applies; phone tier just renders the same single
content at narrower width.

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
  world, plot, etc.) to render the responsive collapse — session 7.
  Groups A / B / C have landed; the per-screen wireframes for those
  surfaces now carry their own viewport toggle and container-query
  reflow. The [collapse.html demo](./collapse.html) remains useful
  as the foundations-level reference, and applies to Group D's
  surfaces (story-settings, app-settings, vault calendars,
  prompt-pack editor) until those retrofits land.
- **Open-sheet auto-dismiss on reflow** is implementation
  guidance, not a contract clause — session 7 picks the exact
  behavior.
