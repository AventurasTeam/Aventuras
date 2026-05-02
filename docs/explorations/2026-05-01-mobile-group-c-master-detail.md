# Mobile foundations — session 7 group C (in-story master-detail)

Per-screen retrofit pass for the three "in-story master-detail"
surfaces:
[world](../ui/screens/world/world.md),
[plot](../ui/screens/plot/plot.md), and
[chapter-timeline](../ui/screens/chapter-timeline/chapter-timeline.md).
Third of four grouped consumer-pass sessions per
[`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions).

The substrate (sessions 1–6) carries every contract these surfaces
consume. None of the three has a pre-foundations `## Mobile`
section, and no inbound anchor refs target one — verified clean by
grep. Group C is mostly mechanical retrofit. The single substantive
design question is the **detail-tab strip on narrow widths**
(World's character detail has 8 tabs, doesn't fit on phone or
narrow tablet); resolved as a tier-aware substitution to the
existing Select primitive's dropdown render mode, with a small
[`forms.md`](../ui/patterns/forms.md) amendment to retire a dangling
"finalizes with the responsive pass" note that was waiting for this
session.

## Surface inventory

| Surface          | Pre-foundations Mobile section? | Tier shape                               | Reconciliation work                                                                                      |
| ---------------- | ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| world            | No                              | 2-pane → 1-pane on phone (master-detail) | New `## Mobile expression`; list-first collapse; tab-strip → Select dropdown when overflowing            |
| plot             | No                              | 2-pane → 1-pane on phone (master-detail) | New `## Mobile expression`; same collapse pattern; segment toggle (Threads / Happenings) preserved       |
| chapter-timeline | No                              | Single-pane card list, all tiers         | New `## Mobile expression`; per-card action-row wrap on phone; chapter-close modal stays Modal all tiers |

Two are master-detail per
[`collapse.md → World / Plot`](../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings);
chapter-timeline is single-pane per
[`collapse.md → Single-pane surfaces`](../ui/foundations/mobile/collapse.md#single-pane-surfaces--no-collapse).

## Tab-strip overflow rule

The substantive substrate touch in Group C. Pinned here, mirrored
into [`forms.md`](../ui/patterns/forms.md) for general application
beyond this group.

**Tab counts by kind** (for grounding):

- 8 — character (World)
- 7 — location / item / faction (World, Carrying hidden)
- 4 — happenings (Plot)
- 3 — lore (World)
- 2 — threads (Plot)
- 0 — chapter-timeline (single-pane, no tabs)

**Three render forms** the detail-pane's tab navigation can take:

1. **Tab strip** — the desktop primitive. Used on desktop at every
   count, and on tablet when count ≤ 3.
2. **Select segment** ("button-type" — bordered horizontal button
   group). Used on phone when count ≤ 2 — the Select primitive's
   auto-derivation cascade picks this mode at low cardinality on
   mobile per [`forms.md`](../ui/patterns/forms.md#select-primitive).
3. **Select dropdown** — collapsed picker chip. Used on phone when
   count ≥ 3, and on tablet when count > 3.

**The consumer's decision is binary.** Either render Tab strip
(desktop always; tablet when count ≤ 3), or hand the tab list to
the Select primitive and let its cascade pick segment vs dropdown.
No new logic inside Select; no new primitive.

**Per-tier rule** (collapsing the three forms):

| Tier    | Tab count ≤ 2  | Tab count = 3   | Tab count > 3   |
| ------- | -------------- | --------------- | --------------- |
| Desktop | Tab strip      | Tab strip       | Tab strip       |
| Tablet  | Tab strip      | Tab strip       | Select dropdown |
| Phone   | Select segment | Select dropdown | Select dropdown |

**Threshold of 3 on tablet** comes from wireframe review at iPad
portrait (768 px → ~430 px detail pane). 4-tab happenings with
involvements / awareness count chips wrapped vertically at that
width during review, so the threshold tightened from an initial
draft of 5 (everything fits) → 4 (4 borderline) → 3 (4 overflows
in practice). The 3 threshold falls between lore (3, fits) and
happenings (4, doesn't), so no kind sits on the boundary zone.
**Threshold of 2 on phone** is the Select primitive's existing
mobile-cardinality cutoff, applied unchanged.

**Per-kind matrix** (verifying the rule lands right):

| Kind             | Tabs | Desktop   | Tablet          | Phone           |
| ---------------- | ---- | --------- | --------------- | --------------- |
| Threads          | 2    | Tab strip | Tab strip       | Select segment  |
| Lore             | 3    | Tab strip | Tab strip       | Select dropdown |
| Happenings       | 4    | Tab strip | Select dropdown | Select dropdown |
| Loc/Item/Faction | 7    | Tab strip | Select dropdown | Select dropdown |
| Character        | 8    | Tab strip | Select dropdown | Select dropdown |

**Surface primitives for the Select branches:**

- **Select segment** — flat inline rendering at every tier; same
  shape as Plot's `[Threads | Happenings]` segment toggle and the
  wizard's narration-mode segment.
- **Select dropdown on tablet** — anchored Popover (no
  edge-clipping risk at tablet widths).
- **Select dropdown on phone** — Sheet (short) per
  [`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
  Aligns with `Actions menu`, `model picker`, `calendar picker` —
  all small chrome popovers route to Sheet on phone for the same
  reason.

**Not a new primitive — tier-aware substitution.** Tab strip and
Select stay distinct primitives. The detail-pane component picks
which to render based on tier and tab count. Same shape as the
Reader rail's tier-aware swap (in-place expand on desktop → Sheet
on phone — same data, different primitive).

## Per-surface design

### world

**Master-detail collapse on phone** per
[`collapse.md → World`](../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
List-first; tap row → detail full-screen route within the World
surface; back returns to list state. Sub-header at the route level
(`Characters / Kael Vex`) sits below the slim phone top bar.

**Top-bar shape on phone.** Slim single-row per
[`navigation.md → Phone`](../ui/foundations/mobile/navigation.md#phone--640-px):
`[←] [story-title / World] [pill] [⛭] [⚲]`. List state shows
breadcrumb `<title> / World`; detail-route shows
`<title> / World / <kind>` (parent segments tappable per the
breadcrumb-tappability amendment, current segment inert with
tap-to-tooltip on truncation per touch.md).

**List-pane category dropdown.** `[Characters ▾]` chip stays the
project's Select primitive at every tier per `forms.md` — already
custom-rendered (not a native `<select>`). Phone-tier expression
follows the substrate: dropdown render mode opens via Sheet (short)
on phone since the option list is flat and small (5 categories:
Characters / Locations / Items / Factions / Lore).

**Search + filter chips.** Stack vertically inside the list pane
on phone — search input one row, filter chips wrapping below.
Existing layout already breaks via `flex-wrap` on the chip row;
phone reflow lets it wrap naturally.

**Detail-route tab navigation** — see
[Tab-strip overflow rule](#tab-strip-overflow-rule) above.
Character (8 tabs): Tab strip on desktop, Select dropdown on tablet
and phone. Location / item / faction (7 tabs): same. Lore (3 tabs):
Tab strip on desktop and tablet, Select dropdown on phone (3 > 2,
the mobile cardinality cutoff).

**Save bar in detail-route.** Stays anchored to the bottom of the
detail-route's scroll region per
[`save-sessions.md`](../ui/patterns/save-sessions.md). Phone
keyboard avoidance: per
[`platform.md → Keyboard avoidance`](../ui/foundations/mobile/platform.md#keyboard-avoidance),
`KeyboardAvoidingView` reflows the detail content above the keyboard;
save bar **hides while keyboard is open** per
[`touch.md → Save bar on phone`](../ui/foundations/mobile/touch.md#save-bar-on-phone),
reappears on field blur. Navigate-away guard stays active throughout.

**Per-row import affordance** (`+ New <kind>` button at list-pane
foot) sits below the row list, full-width on phone for tap-target
clarity. Import-counterparts dropdown (`Blank` / `From JSON file…`
/ `From Vault…`) opens as Sheet (short) on phone per the layout
binding for popover-style menus.

**Detail-head overflow menu (`⋯`).** Per
[`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces),
Popover on desktop / tablet, Sheet (short) on phone. Same content
(`Set as lead` / `Export entity as JSON` / `View raw JSON` /
`Delete entity`).

**Raw JSON viewer.** Already specced as Sheet (right ~440 px) on
desktop, Sheet (bottom, tall ~95 %) on phone per the layout binding
table. Inherits.

**Recently-classified badge.** Inline next to the entity name in
detail-head per
[`patterns/entity.md → Recently-classified row accent`](../ui/patterns/entity.md#recently-classified-row-accent).
No tier-specific change.

**Stack-aware Return + dirty-state guard.** On phone, the chrome
`←` plus Android `BackHandler` plus iOS swipe-back all bind to
stack-aware Return per
[`navigation.md → Stack-aware Return`](../ui/foundations/mobile/navigation.md#stack-aware-return-on-mobile).
List ↔ detail navigation is a sub-stack within the World surface;
back from detail routes to list, not to the prior top-level surface.
Dirty-state navigate-away guard fires before the back action when
the detail is dirty.

### plot

Same shape as World — 2-pane master-detail, same collapse, same
chrome rules. The differences track Plot's data shape, not the
mobile expression.

**Top-level segment toggle `[Threads | Happenings]`.** 2-cell
segment via the Select primitive's segment render mode; fits on
phone (segment cells stretch with `flex: 1 1 0` per the wizard
fix from Group A). Drives both list-pane content and detail-pane
tab composition.

**List-pane filter chips.** Threads side: All / Active / Pending /
Resolved / Failed. Happenings side: All / This chapter / Common
knowledge / Out-of-narrative. Wrap as needed on phone; existing
chip-row layout uses `flex-wrap`.

**Detail-route tab navigation.** Threads (2 tabs: Overview /
History): Tab strip on desktop and tablet, Select segment on phone
(2 ≤ 2, mobile cascade hits segment mode). Happenings (4 tabs:
Overview / Involvements / Awareness / History): Tab strip on
desktop, Select dropdown on tablet and phone (4 > 3, the tablet
cardinality cutoff).

**Common-knowledge interaction.** Toggling `common_knowledge` on
the Overview tab makes the Awareness tab body a notice ("Common
knowledge — every character is aware of this"). Tab switch on
phone goes through the Select dropdown; the notice and add-affordance
shape stays identical to desktop. No tier-specific change.

**Per-row indicators** (recently-classified accent, common-knowledge
⊙ icon, status pill) all stay always-visible per
[`patterns/icon-actions.md`](../ui/patterns/icon-actions.md);
unchanged on phone.

**Detail-head overflow menu, save bar, raw JSON viewer.** Identical
to World — see World section.

### chapter-timeline

Single-pane vertical card list. No master-detail collapse applies;
the existing layout reflows naturally at narrow widths.

**Top-bar shape.** Standard in-story chrome on phone:
`[←] [<title> / Chapters] [pill] [⛭] [⚲]`. Reader-only chips (chapter,
time, branch) absent — chapter-timeline is itself the chapter
management surface, so the chapter chip would be redundant per the
existing per-screen note.

**Card list.** Stacks vertically; cards already responsive via
their existing styling. Card padding compresses on phone (12 px
side-padding instead of desktop's 20 px). Collapsed-card metadata
line (`<time range> · <token count> · <theme>`) wraps when content
exceeds the line.

**Per-card action row** (`[Jump to chapter →] [Regenerate summary]
[Delete…]`) — wraps to multi-row on phone via `flex-wrap`. The three
buttons stack vertically at the narrowest widths if labels can't
fit horizontally; intermediate widths fit two-up.

**In-card save bar.** Per
[`patterns/save-sessions.md`](../ui/patterns/save-sessions.md);
appears at the card's bottom edge when dirty. Phone keyboard
avoidance: same `KeyboardAvoidingView` + hide-on-keyboard rule as
World detail.

**In-progress chapter card.** Specialized last card (no DB row
yet). `[Close chapter…]` button full-width on phone for tap-target
clarity. Token-progress bar reflows naturally.

**Chapter-close modal.** Stays Modal at every tier per
[`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
Modal width caps at viewport-minus-padding on phone (per the modal
contract). End-entry picker dropdown opens **in-flow** within the
modal (modal grows vertically; scrolls if the picker would push
content past viewport height). No Modal-over-Sheet stacking
introduced — keeps the surface stack flat.

**Entry-row anatomy** (start row + picker trigger + dropdown items)
unchanged on phone. Single-line truncation already handles narrow
widths via `text-overflow: ellipsis`. Time chip right-aligned.

**Empty state.** "0 closed + 1 in progress" header copy renders
identically; only the in-progress card surfaces. No tier-specific
change.

**Stack-aware Return + dirty-state guard.** Same as World —
chrome `←`, Android `BackHandler`, iOS swipe-back all route through
stack-aware Return. Dirty card guard fires when navigating away
from the timeline with an expanded card unsaved.

## Adversarial pass

**Load-bearing assumption.** The 3-tab tablet threshold assumes
label widths cluster around ~80–96 px each ("Overview", "Identity",
"Carrying", "Connections", "Settings", "Assets", "Involvements",
"History"), plus optional count chips on tabs that surface row
totals (Involvements 7, Connections 3, etc). Wireframe review at
iPad portrait (~430 px detail pane) showed 4-tab happenings with
its count chips wrapping vertically inside each tab — the strip
overflows in practice even though raw label widths theoretically
add up. Threshold tightened from 5 (initial) → 4 (review pass 1)
→ 3 (review pass 2). 3 cleanly excludes happenings (4 tabs). If
a future kind has 4 short labels with no counts, the strip might
still fit on tablet; rule errs on the side of dropdown, which is
consistent and acceptable.

**Edge cases.**

- **Kind switch with active tab not present in new kind** (e.g.,
  user is on Carrying for a character, switches to a location row
  in the list — locations have no Carrying tab). The detail-pane
  component must reset to a default tab (Overview) on row-tap.
  Existing desktop behavior; no phone-specific issue.
- **Detail-route mounted from a peek's "Open in panel →" link**
  (per `collapse.md`'s "skipping the list-first state on first
  mount" clause). Detail route lands at Overview; back returns to
  list state, not to the reader. Verified by the collapse contract.
- **Dirty detail + tier transition** (Galaxy Fold unfold during
  edit). State preserved per
  [`collapse.md → State preservation on reflow`](../ui/foundations/mobile/collapse.md#state-preservation-on-reflow);
  detail-route is the same component on tablet inline, so no
  surface remount.
- **Plot segment-toggle switch with dirty detail.** Switching from
  Threads to Happenings would orphan the dirty detail; the
  navigate-away guard intercepts. Existing pattern; no
  phone-specific change.
- **Chapter-close modal end-entry picker on phone with many entries**
  (open chapter spans hundreds of entries). Picker panel is
  scrollable per the modal's existing spec; modal scrolls when total
  height exceeds viewport. Verified.
- **Tab dropdown overflow on phone with very long entity name**
  (sub-header truncates). Sub-header `<kind> / <name>` truncates
  with ellipsis; tap-to-tooltip per touch.md reveals the full
  name. Verified rule.

**Read-site impact.** No headings renamed; no inbound anchor refs
to update. Verified by grep on `world.md#mobile`,
`plot.md#mobile`, `chapter-timeline.md#mobile` — zero hits. Clean.

**Doc-integration cascades.**

- [`forms.md → Select primitive`](../ui/patterns/forms.md#select-primitive)
  has a dangling note: _"Cardinality threshold... bumps to 2 on
  mobile, deferred. Mobile threshold finalizes with the responsive
  pass."_ This session is the responsive pass. Update the note to
  pin the phone-tier dropdown surface (Sheet short / medium based
  on content) and remove the "deferred" qualifier.
- [`collapse.md → What this contract does NOT pin`](../ui/foundations/mobile/collapse.md#what-this-contract-does-not-pin)
  carries the line: _"The current wireframes show desktop layout
  only; tap-and-see the phone collapse via the collapse.html demo
  for now."_ After Group C lands (and given Group A and B have
  already retrofitted reader, branch-nav, rollback, story-list,
  wizard, onboarding), every multi-pane surface in v1 has phone
  reflow in its own wireframe. Update the line to reflect that the
  collapse.html demo is now redundant for groups A, B, C and only
  Group D's surfaces remain.
- [`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)
  Group C status updates from `(pending)` to `landed 2026-05-01`
  with a link to this exploration record.

**Patterns adopted on a new surface.** Citations to foundations
docs are already in place from prior sessions on these surfaces.
The new citation is to `forms.md → Select primitive` (consumed for
the list-pane category dropdown, detail-pane form fields, and the
tab-strip overflow rule). Currently `forms.md → Used by` lists
App Settings, Story Settings, Wizard, Reader composer, Onboarding,
Vault calendars — but **not** World or Plot. Adding World and Plot
to that Used-by list is the standard pattern-adoption hygiene
called for in `.claude/rules/docs.md`.

**Followups in / out.** No followup or parked entry covers Group
C's mobile retrofit; nothing to remove. None introduced.

**Missing perspective.**

- **Tablet detail-pane width at the boundary.** iPad portrait
  (768 px) gives detail pane ~430 px; iPad landscape (1024 px) is
  desktop tier. The 3-threshold lands characters/locations/items/
  factions on dropdown on iPad portrait, which is the right call;
  iPad landscape gets the full strip (desktop tier). No surprises
  at the device-class boundary.
- **Phone landscape (~700–900 px).** Lands in tablet tier per the
  responsive contract; World/Plot are 2-pane (cramped but usable).
  Tab strip / Select dropdown rule applies per tablet column —
  same outcomes as iPad portrait. Verified by composing
  responsive.md and the tab-strip rule.
- **Galaxy Z Fold cover screen** (~320 px wide, below phone tier
  minimum 360 px). Out of supported range; degradation is
  acceptable. Same disclaimer Group B carried.

**Verified vs assumed.**

- **Verified.** Master-detail collapse contract, list-first on
  phone, detail-route within surface, back-on-left semantics,
  navigate-away guard, no pre-foundations Mobile sections to
  reconcile, no inbound anchor refs to renamed headings (none
  renamed), modal-stays-modal rule, in-flow picker inside modal
  (no Modal-over-Sheet stacking), `forms.md`'s dangling note about
  the responsive pass, layout binding table coverage of
  `Actions menu` / `model picker` / `calendar picker` as Sheet on
  phone.
- **Assumed.** Tab label widths cluster around 80–96 px per label
  at detail-pane font scale (font scale per `typography.md`
  inferred from existing wireframe sizing). If real implementation
  font scale differs and labels render wider, the 3-threshold rule
  may misroute one kind; the misroute would be benign (Select
  dropdown when strip would have fit, not the reverse).

## Integration plan

**Files changed.**

- [`docs/ui/screens/world/world.md`](../ui/screens/world/world.md)
  — add `## Mobile expression` section before `## Layout` (or after,
  matching Group A/B placement). Cite responsive / navigation /
  layout / collapse / touch / platform foundations and `forms.md`
  for the tab-strip overflow rule.
- [`docs/ui/screens/world/world.html`](../ui/screens/world/world.html)
  — add viewport-toggle review-bar group. Container-query reflow:
  list-pane vs detail-pane state toggle on phone (only one visible);
  top-bar slim variant; tab strip ↔ Select dropdown swap based on
  tab count (visual demo via state toggle in the review bar).
- [`docs/ui/screens/plot/plot.md`](../ui/screens/plot/plot.md)
  — same as World, mirroring shape.
- [`docs/ui/screens/plot/plot.html`](../ui/screens/plot/plot.html)
  — same retrofit as world.html.
- [`docs/ui/screens/chapter-timeline/chapter-timeline.md`](../ui/screens/chapter-timeline/chapter-timeline.md)
  — add `## Mobile expression` section. Cite layout / collapse
  (single-pane clause) / touch / platform.
- [`docs/ui/screens/chapter-timeline/chapter-timeline.html`](../ui/screens/chapter-timeline/chapter-timeline.html)
  — viewport-toggle review-bar group; container-query reflow for
  card list and chapter-close modal at narrow widths.
- [`docs/ui/patterns/forms.md`](../ui/patterns/forms.md)
  — amend the `Cardinality threshold` clause: pin phone-tier
  dropdown surface (Sheet short / medium based on content) and
  remove the "deferred" qualifier. Add World + Plot to the Used-by
  list (currently missing).
- [`docs/ui/foundations/mobile/collapse.md`](../ui/foundations/mobile/collapse.md)
  — update the `What this contract does NOT pin` line about
  wireframes-show-desktop-only to reflect Group A/B/C retrofits.
- [`docs/ui/foundations/mobile/README.md`](../ui/foundations/mobile/README.md)
  — Sessions list, mark Group C as landed with link to this
  exploration record.

**Renames.** None.

**Followups in/out.** None on either side.

**Patterns adopted on a new surface.** `forms.md` Used-by gains
World and Plot citations (currently absent — both consume the
Select primitive on the list-pane category dropdown, on detail-pane
form fields, and via the new tab-strip overflow rule).

**Wireframes updated.** Three per-screen wireframes gain the
viewport toggle and container-query reflow. Two foundations docs
(forms.md, collapse.md) get small updates. Mobile README's Sessions
list updates Group C status.

**Intentional repeated prose.** Each surface's `## Mobile
expression` opening sentence follows the Group A/B template ("Phone
forces..."). Surface-specific content diverges immediately — the
master-detail collapse details for World/Plot, the single-pane
clause for chapter-timeline. No boilerplate concern.
