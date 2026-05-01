# Mobile foundations — collapse rule (session 4)

Session 4 of the mobile-foundations design pass (per
[`../ui/foundations/mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)).
Pins **how multi-pane surfaces collapse from desktop / tablet
into phone-tier 1-pane expressions**. Universe is smaller than the
multi-session plan initially sketched: there are zero 3-pane
surfaces in v1; only 2-pane (Reader, World, Plot) and 1-pane
(everything else). The "3 → 2 → 1" framing in the original plan
was inaccurate.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/mobile/collapse.md`](../ui/foundations/mobile/collapse.md).

## Decisions locked entering this session

Reached through dialogue:

- **Master-detail (World, Plot) on phone — list-first,
  navigate-into-detail pattern.** Phone shows the list by default;
  tap a row → detail slides into a full-screen route within the
  surface; back returns to list. Standard iOS
  `UISplitViewController` collapse behavior; Material's
  master-detail-on-mobile pattern. Universal, predictable.
- **Reader rail edge strip retained on phone.** 16–24 px strip
  (exact value visual-identity pass) sits at the right edge.
  Same affordance as desktop+tablet (tap to expand). Cross-tier
  consistency wins over saving the screen-width sliver.
- **Phone landscape stays width-only per the foundations
  contract.** Phones in landscape (~700–900 px wide) land in
  tablet tier and get the desktop-like 2-pane layout with rail
  forced collapsed (per the existing
  [side-rail collapse spec](./2026-04-29-side-rail-collapse.md)
  threshold of ~900 px). No height-aware override. Validated
  later if usability complaints surface.
- **Galaxy Fold mid-use unfold preserves state.** Layout reflows
  from phone-tier (cover ~360) to tablet-tier (main ~904); the
  underlying React tree survives. RN / Expo's Dimensions listener
  fires on the reflow; component state (scroll position, peek
  drawer state, composer text, save-session dirty flag) carries
  through naturally.

## Background — existing rail-collapse spec is load-bearing

The reader rail's collapse / expand was specced in the
[2026-04-29 side-rail collapse exploration](./2026-04-29-side-rail-collapse.md)
and codified in
[`reader-composer.md → Browse rail — collapse / expand`](../ui/screens/reader-composer/reader-composer.md#browse-rail--collapse--expand).
Key behaviors that carry forward:

- **Collapsed state** is a full-height vertical edge strip on the
  right (~16–24 px wide, no functional content, pure click target
  for re-expand).
- **Manual preference** persists app-globally across launches.
- **Viewport-forced collapse** fires below ~900 px width with
  ~80 px hysteresis (re-expand at ~980 px), event-driven not
  continuous.
- **Peek drawer requires open rail** — collapsing the rail while
  peek is open closes the peek; peek and collapsed-rail are
  mutually exclusive states.

This already covers tablet portrait (iPad ~820 → forced collapsed)
and the high end of phone tier (~640 → still forced collapsed).
The phone-tier rail behavior is, mechanically, the same as
"viewport-forced collapsed at any narrow width." Session 4 inherits
this spec; doesn't rewrite it.

What session 4 needs to ADD on top of the existing spec:

- The rail strip's tap behavior on phone — the existing spec says
  "tap to expand the rail back to its full state." But on phone,
  expanding to full rail state would squeeze the narrative to
  zero or a sliver. The expand mechanism on phone needs to differ:
  the rail's content opens as a **bottom Sheet** (per session 3's
  layout primitives) rather than expanding in place.
- Peek drawer interaction inside the phone rail-sheet (the sheet
  delivers both row-browse and peek-content states, transitioning
  between them via internal navigation; sheet height may grow
  when peek loads).

## Surface-by-surface collapse

### Reader / composer — narrative + rail

**Desktop / tablet (≥ 640 — but rail forced collapsed below ~900):**

Per the existing layout. Narrative occupies most width; rail
on right (open or collapsed-to-strip per viewport / manual
preference).

**Phone (< 640):**

- **1-pane primary**: narrative and composer fill the screen width.
- **Rail is always collapsed to edge strip** on phone — the
  existing viewport-forced-collapse rule already produces this
  outcome at any width below ~900 px. Phone is a strict subset
  of this.
- **Strip tap on phone opens the rail's content as a bottom
  Sheet** (not as an in-place expand — that would squeeze the
  narrative). Sheet starts at medium height (~50–60% per session
  3); contains category dropdown / filter chips / search / row
  list / Import affordance — same content as desktop rail.
- **Tap a row inside the sheet → sheet content swaps to peek
  view** (the entity overview that the desktop peek drawer shows).
  Sheet height may grow to tall (~85–95%) to fit the richer
  content. Sheet's own internal back affordance returns to the
  row-list state.
- **Peek content's "Open in panel →" link** dismisses the sheet
  and routes to World / Plot per the existing flow.
- **Peek save-session quick-edit exception** carries through —
  in-sheet peek edits commit on field blur per
  [`patterns/save-sessions.md → Quick-edit exception — peek drawer`](../ui/patterns/save-sessions.md#quick-edit-exception--peek-drawer).
- **Composer text and scroll position survive** sheet open / close
  — sheet is overlay, parent (narrative and composer) stays alive.

### World — kind selector + list + detail (master-detail)

**Desktop / tablet (≥ 640):**

Per the existing 2-pane layout. List pane on left (~340 px),
detail pane on right (flex). User picks a row in the list, detail
populates with the selected entity. Master-detail sub-header
(`Characters / Kael Vex`) sits above both panes.

**Phone (< 640):**

- **List is the default visible state.** Surface entry shows the
  list with category dropdown / filter chips / search / rows.
- **Tap a row → detail slides in as a full-screen route within
  the World surface.** The route's chrome includes back-on-left
  (per the [top-bar amendment](./2026-05-01-top-bar-left-slot-scope.md))
  which returns to the list. The master-detail sub-header sits in
  the route's chrome too (`Characters / Kael Vex`).
- **Save-session navigate-away guard** fires on the back action
  if the detail is dirty (per the existing
  [save-sessions pattern](../ui/patterns/save-sessions.md)).
  Confirm modal asks discard / save; same as desktop.
- **Detail tabs** (Overview / Identity / Carrying / Connections
  / Settings / Assets / Involvements / History for characters,
  fewer for other kinds) work as on desktop — internal tab
  navigation within the detail route.
- **Per-row import** affordance (per
  [`world.md → Per-row import`](../ui/screens/world/world.md#per-row-import))
  is in the list; tap-to-import opens its modal as on desktop.

### Plot — thread / happening list + detail

Same shape as World — 2-pane master-detail. Phone collapse is
identical: list visible by default; tap row → detail as
full-screen route with back-on-left; save-session guard on back.

The thread/happening detail content differs from World detail
content but the collapse pattern doesn't.

### Single-pane surfaces — no collapse needed

- **Chapter Timeline** is single-content (chapter list with a
  side panel for selected chapter context). Per
  [`chapter-timeline.md`](../ui/screens/chapter-timeline/chapter-timeline.md)
  it has its own internal navigation but isn't 2-pane. No
  collapse rule applies.
- **Story Settings** is single-content with category internal
  nav. No collapse.
- **Story list, Vault, App Settings, Onboarding, Wizard** —
  single-content. No collapse.

## Phone landscape disposition

Width-only per the
[responsive contract](../ui/foundations/mobile/responsive.md).
Phone landscape (~700–900 px wide) lands in tablet tier; gets
desktop-like 2-pane with rail forced collapsed via the existing
~900 px threshold.

What this means in practice:

- **Reader in phone-landscape**: 2-pane with narrative and
  collapsed-rail-strip. Same as iPad portrait. Cramped vertically
  (~360 px height) but functional.
- **World / Plot in phone-landscape**: 2-pane (list and detail).
  List ~340 px, detail ~360–560 px in 700–900 width. Tight but
  usable. Save-session bar still fits at the bottom.
- **Single-pane surfaces in phone-landscape**: same as desktop /
  tablet, just at narrower width.

If post-v1 user testing surfaces complaints about phone-landscape
usability — typical use case is rare for a writing app where
portrait reading dominates — a height-aware override can be added
without foundations rewrite. The width-only rule is the simpler
default; height-aware is a reactive escape hatch.

## State preservation on reflow

Reflow events covered:

- **Galaxy Fold unfold** (phone → tablet): state survives.
- **Galaxy Fold fold** (tablet → phone): state survives; layout
  reflows; rail's tablet "collapsed-strip" state translates to
  phone's "rail-as-sheet-on-tap" state — tap-to-expand on tablet
  re-expands the rail; tap-to-expand on phone opens the sheet.
  The same "manual preference for rail" still applies on phone
  but now manifests as "sheet currently open" rather than "rail
  expanded inline."
- **Browser window resize** (desktop → tablet → phone): same as
  Galaxy Fold; layout reflows, state survives.
- **Orientation change** (portrait ↔ landscape on phone or
  tablet): width-driven; layout reflows per current width tier.
- **iOS Slide Over / Stage Manager** style multi-window: app's
  reported width changes; same width-driven reflow applies.

What's NOT preserved across reflow:

- **Open sheets and modals on phone** dismiss when the layout
  transitions out of phone tier (e.g., user opens the rail-sheet
  on phone, then unfolds Galaxy Fold; the sheet closes because
  the rail is now visible inline on tablet). Same applies in
  reverse — folding the device closes any open right-rail panel
  and opens the rail-as-sheet only when the user re-taps the
  strip on phone.

This is a quality-of-life behavior; not pinned in the foundations
contract but flagged as session 7 implementation guidance.

## Adversarial pass

### Load-bearing assumption

The big assumption: **the rail's "tap strip → sheet" pattern on
phone composes cleanly with the existing rail-collapse spec**.
The desktop spec says "tap strip = expand rail"; phone changes
this to "tap strip = open sheet." Different action, same trigger.

Risk: someone reading both specs together could be confused.
Mitigation: clarify in the canonical `collapse.md` that the
strip's tap behavior is tier-aware (in-place expand on
desktop+tablet, sheet on phone). One sentence; not load-bearing
beyond clarity.

### Edge cases

- **Rail-sheet dismiss while peek-content is showing.** User taps
  rail strip → sheet opens at row-list state → user taps a row →
  sheet swaps to peek content. User now drag-down dismisses the
  sheet. Two options:
  - (a) Sheet dismisses entirely; user is back on the reader
    narrative. Next tap on the strip re-opens the sheet at
    row-list state (peek context lost).
  - (b) Sheet dismisses to row-list state first; second drag-down
    closes entirely.

  Lean: (a). Simpler; matches "drag-down = leave the sheet"
  expectation. Sheet's own internal back affordance is for going
  from peek → row-list within the sheet. Pinned in the canonical
  doc.

- **Save-session navigate-away guard during in-sheet peek edit.**
  Peek drawer's quick-edit exception means most fields commit on
  blur (no save bar). If the user has a dirty in-progress edit
  AND drag-down dismisses the sheet, the navigate-away guard
  fires per the existing pattern. Mobile inherits.
- **Master-detail back during in-flight pipeline.** User on World
  detail (full-screen route on phone), pipeline is generating in
  the reader. User taps back to return to list. Pipeline doesn't
  block read-only nav (per the
  [edit-restrictions principle](../ui/principles.md#edit-restrictions-during-in-flight-generation)).
  Detail tab edits ARE gated. If detail save-session is dirty
  AND pipeline is in flight, the navigate-away guard's confirm
  text needs to convey both — "you have unsaved changes AND a
  pipeline is running; saving now will queue behind the
  pipeline." Or the simpler path: detail edits are fully blocked
  during in-flight pipeline (existing rule). Save-session can't
  be dirty. No conflict. ✓
- **Reader rail's manual preference vs phone reality.** User
  prefers rail-open (set on desktop). Now opens app on phone.
  The "manual preference" is moot on phone (rail is always
  collapsed to strip; no expand-in-place option). The preference
  is preserved (storage isn't tier-specific), and re-applies when
  the user is back on tablet / desktop. Acceptable.
- **List-first vs detail-first on initial mount.** What if the
  user just navigated FROM a peek's "Open in panel →" link?
  Desktop: World opens with the row pre-selected; detail
  populated. Phone: World should open at the detail route for
  that row (skipping the list state on first mount). Back from
  the detail route returns to the list — standard pattern.
  Pinned: peek's "Open in panel →" pushes detail-route on phone,
  list-then-detail on desktop equivalents.
- **Peek's "Open in panel →" mid-edit.** User is editing in
  peek (quick-edit, in-sheet). Taps "Open in panel →". Sheet
  dismisses, navigates to World detail route. Any in-progress
  field edit commits-on-blur per quick-edit semantics. ✓

### Read-site impact / doc-integration cascades

- `reader-composer.md → Browse rail — collapse / expand` describes
  the rail's behavior on desktop and lower-than-900-px viewports.
  Phone's "tap strip = sheet" is a divergence the rail spec
  doesn't itself describe. Adding a one-paragraph note pointing
  at `mobile/collapse.md` would be ideal but bumps into the
  "session 7 retrofits per-screen docs" principle. **Defer the
  reader-composer.md update to session 7**; foundations
  `mobile/collapse.md` carries the full phone-tier expression and
  cites the desktop spec.
- `world.md` and `plot.md` describe the desktop master-detail
  layout. Phone's list-first navigate-into-detail is similarly
  described in `mobile/collapse.md` only. **Defer per-screen
  doc updates to session 7.**
- `patterns/save-sessions.md` — quick-edit exception applies to
  in-sheet peek the same way as desktop peek. No edit needed.
- `principles.md → Edit restrictions during in-flight generation`
  — already covers read-only nav; collapse doesn't change it.

### Missing perspective

- **Sync / backup format.** Layout is UI; no schema impact. ✓
- **Translation pipeline.** Collapse rule doesn't carry
  translatable content. ✓
- **Implementation cost.** RN's flexbox and media-query handling
  via NativeWind covers the layout reflow natively. Sheet
  primitive (per session 3) has multiple library options; same
  decision pattern as the virtual-list followup. ✓
- **Performance during reflow.** Galaxy Fold transition is a
  layout-only re-render; no re-fetch, no SQLite reads. Should be
  fast on modern hardware; older Android devices may show a
  brief flash. Out of scope; session 6 (platform) addresses if
  needed.
- **Accessibility.** Master-detail collapse navigation should
  announce route changes ("World / Characters / Kael Vex") via
  the system accessibility layer. Bundles with session 6
  (platform) for the screen-reader specifics.

### Verified vs assumed

- **Verified.** Existing rail-collapse spec covers viewport <
  ~900 px (forced-collapse threshold). Per-surface layouts
  (reader narrative with rail; world list with detail; plot
  list with detail) confirmed via current docs. Stack-aware
  Return and the back-on-left rule from session 2 plus the
  top-bar amendment carry to phone master-detail back action.
- **Assumed.** Galaxy Fold's Dimensions-listener-firing reflow
  is graceful in practice; older Android devices fold without
  visible flash. Indirect evidence (RN documents this as the
  expected behavior); validate at session 7 implementation.

## Followups generated

- **Reader rail strip tap behavior tier-awareness.**
  Bundles into the canonical doc directly (one paragraph clarifying
  "in-place expand on desktop+tablet, sheet on phone"). Not a
  separate followup.
- **Open-sheet dismissal on tier transition.** Quality-of-life
  behavior (sheet auto-dismisses when reflow takes the user out
  of phone tier). Flag for session 7 implementation, not a
  separate followup.

No new entries in `followups.md` or `parked.md`.

## Integration plan

Files in the integration commit:

- **NEW** `docs/ui/foundations/mobile/collapse.md` — canonical
  collapse-rule contract: per-surface (reader, world, plot)
  collapse expressions, master-detail collapse pattern,
  rail-strip-tap tier-awareness, phone-landscape disposition,
  state preservation on reflow.
- **NEW** `docs/ui/foundations/mobile/collapse.html` — interactive
  demo: surface toggle (Reader, World, Plot) crossed with
  viewport toggle, showing the collapse expression at each tier.
- **NEW** `docs/explorations/2026-05-01-mobile-collapse.md` —
  this record.
- **EDIT** `docs/ui/foundations/mobile/README.md` — Files list
  adds `collapse.md` and `collapse.html`. Sessions list session
  4 status changes from "pending" to "landed 2026-05-01" with
  exploration-record link plus the substantive summary.

Renames / heading changes: none. All inbound anchors preserved.

Patterns adopted on a new surface: none. The new files cite
`reader-composer.md` (rail collapse), `world.md` (master-detail
layout), `plot.md`, `patterns/save-sessions.md` (quick-edit,
navigate-away guard), `principles.md` (edit restrictions),
`responsive.md` (tier vocab), `navigation.md` (chrome layers),
`layout.md` (Sheet primitive). All content references; no Used-by
updates.

Followups resolved: none in `followups.md`.

Followups introduced: none. Reader-composer / world / plot
per-screen doc edits deferred to session 7's per-screen retrofits
(already in scope).

Wireframes updated: one new (`collapse.html`); existing per-screen
wireframes deferred.

Intentional repeated prose: per-surface collapse description
appears in both the exploration record and `mobile/collapse.md`.
Standard exploration-record duplication.

## Self-review

- **Placeholders.** None.
- **Internal consistency.** Tier boundaries match session 1.
  Sheet primitive references match session 3. Top-bar amendment
  references match the recent commit. Existing rail-collapse spec
  cited verbatim where it applies.
- **Scope.** Single integration; collapse rule only. No touch
  grammar / platform / per-screen retrofit creep — verified each
  forward reference names the correct future session.
- **Ambiguity.** "Master-detail on phone" defined as
  list-first-navigate-into-detail with full-screen-route detail.
  "Rail strip tap on phone" defined as opens-bottom-sheet (not
  expand-in-place). Phone-landscape defined as width-only.
- **Doc rules.** Anchor links resolve. No `+` separators in prose
  per the saved feedback memory.
