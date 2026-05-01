# Mobile foundations

Mobile / responsive contract for Aventuras. Sister to the
visual-identity foundations carried by the parent
[`../README.md`](../README.md) — same level of cross-cutting scope,
orthogonal axis. Visual identity carries the **what things look
like** contract; mobile foundations carries the **what shape things
take across form factors, and how they're touched** contract. Both
substrate; neither nests under the other.

Multi-session pass — see [Sessions](#sessions) below. Each session
lands its own file(s) and updates the session list with its status
and exploration-record link.

## Files

- [`responsive.md`](./responsive.md) — responsive contract: three
  form-factor tiers (phone / tablet / desktop), Tailwind-aligned
  breakpoint boundaries (640 / 1024), single-canonical responsive
  HTML artifact strategy, viewport-toggle pattern adopted by
  per-screen wireframes, pre-foundations stance on existing
  per-screen `## Mobile` sections.
- [`responsive.html`](./responsive.html) — interactive reference:
  viewport toggle in the review-controls bar driving a generic
  3-pane reflow across the three tiers via container queries.
  Adopted by per-screen wireframes at session 7+ retrofit.
- [`navigation.md`](./navigation.md) — navigation paradigm: top-bar
  shape per tier (phone slim single-row + reader-only chip strip;
  tablet / desktop unchanged), cross-surface nav inheriting the
  desktop model (Actions menu + rail Browse + peek-then-open),
  stack-aware Return + settings-icon-scope inheritance from
  principles.md, title-truncation rule on phone.
- [`navigation.html`](./navigation.html) — interactive demo of the
  chrome shape across viewport tiers and three representative
  surfaces (reader, World sub-screen, story-list app-level), with
  status-pill toggle.
- [`layout.md`](./layout.md) — layout primitives: four-primitive
  vocabulary (Popover, Modal, Sheet, Full-screen route), decision
  tree for picking a primitive, desktop-to-mobile mapping rules,
  stacking rules, sheet behavior (anchors, heights, drag dismissal),
  per-surface primitive bindings table for session-7 retrofits.
- [`layout.html`](./layout.html) — interactive demo of each
  primitive across viewport tiers (popover, modal, sheet at three
  heights, full-screen route).
- [`collapse.md`](./collapse.md) — collapse rule for multi-pane
  surfaces. Universe is small (only Reader, World, Plot are
  multi-pane in v1, all 2-pane). Master-detail (World, Plot)
  collapses list-first on phone (tap row to detail-route, back to
  list). Reader collapses to narrative-only; rail-strip-tap on
  phone opens the rail's content as a bottom Sheet (tier-aware
  divergence from desktop's in-place expand). Phone landscape
  stays width-only per the responsive contract. State preserved
  across reflow (Galaxy Fold, browser resize, orientation).
- [`collapse.html`](./collapse.html) — interactive demo: surface
  toggle (Reader, World, Plot) crossed with viewport toggle, plus
  a master-detail "show detail" toggle to demonstrate the phone
  collapse on World / Plot.

## Sessions

The mobile contract spans seven sessions. Sessions 2–6 each pin a
specific cross-cutting concern; session 7 starts the per-screen
consumer pass. Each session lands its own file(s); the list below
reflects the current plan and updates as work progresses.

1. **Scaffolding + multi-session plan** — landed 2026-05-01
   ([exploration record](../../../explorations/2026-05-01-mobile-foundations.md)).
   Form-factor matrix (phone / tablet / desktop) with Tailwind-aligned
   breakpoint boundaries (640 / 1024) and Galaxy-Fold + iPad-mini
   real-device anchors. Single-canonical responsive HTML wireframe
   artifact strategy with viewport toggle in the review-controls
   bar. Container-query-driven reflow inside the toggle viewport.
   `localStorage` toggle persistence + 1/2/3 keyboard shortcuts.
   Pre-foundations stance: existing `## Mobile` sections in
   per-screen docs are interim and reviewable; sessions 2–6 promote
   vocabulary as it lands and session 7's per-screen retrofits
   reconcile each surface. Files: [`responsive.md`](./responsive.md),
   [`responsive.html`](./responsive.html).
2. **Navigation paradigm** — landed 2026-05-01
   ([exploration record](../../../explorations/2026-05-01-mobile-navigation.md)).
   Phone gets a slim single-row top bar plus a reader-only chip
   strip below (chapter / time / branch chips migrate vertically
   when the row overcrowds at narrow widths); tablet inherits the
   desktop chrome verbatim; desktop unchanged. **No new chrome
   layer** — adversarial review rejected bottom tabs (wrong
   category fit for chat-app analogs) and a left-side drawer
   (redundant with the right rail's cross-surface role + iOS
   swipe-back conflict). Cross-surface nav uses the desktop model
   on every tier (Actions menu + rail Browse + peek-then-open).
   Stack-aware Return and settings-icon-scope rules inherit from
   principles.md unchanged; the empty-stack-confirm clause already
   resolves the old-app library-back-exits pain. Title truncates
   with ellipsis at narrow widths; tap reveals full title in a
   transient popover (overflow-only, no persistency). Files:
   [`navigation.md`](./navigation.md),
   [`navigation.html`](./navigation.html).
3. **Layout primitives** — landed 2026-05-01
   ([exploration record](../../../explorations/2026-05-01-mobile-layout.md)).
   Four-primitive vocabulary: **Popover** (anchored, transient,
   tiny content), **Modal** (centered, scrim, focus-demanding),
   **Sheet** (edge-anchored sliding panel with anchor / height
   variants), **Full-screen route** (navigable destination with
   internal nav). Sheet consolidates the previous `drawer` /
   `bottom sheet` / `right-anchored drawer` terms — peek drawer
   becomes a named usage of Sheet (right ~440px desktop, bottom
   tall ~95% phone — iOS page-sheet pattern preserves overlay
   feel via swipe-dismiss). Decision tree keys on
   focus-demanding vs browse-and-pick vs rich-detail vs
   navigable-destination. Desktop-to-mobile mappings: rich
   popovers become bottom sheets on phone; tiny popovers stay
   anchored; modals stay modal; long modals (rare) become routes
   on phone. Pre-foundations naming preserved (existing
   `bottom drawer` references unify in session 7). No new tokens
   minted; depth metaphor / padding / radii inherit from spacing.md.
   Files: [`layout.md`](./layout.md), [`layout.html`](./layout.html).
4. **Collapse rule** — landed 2026-05-01
   ([exploration record](../../../explorations/2026-05-01-mobile-collapse.md)).
   Universe is smaller than the original plan sketched: only
   Reader, World, and Plot are multi-pane in v1, all 2-pane (no
   3-pane surfaces exist). Master-detail (World, Plot) collapses
   list-first on phone — tap row to detail-route (full-screen
   route within the surface, back-on-left returns to list).
   Reader collapses to narrative-only on phone; rail forced-
   collapsed to 28-px edge strip per the existing
   [side-rail collapse spec](../../screens/reader-composer/reader-composer.md#browse-rail--collapse--expand).
   **Tier-aware strip-tap behavior**: in-place expand on
   tablet+desktop, opens rail content as a bottom Sheet on phone
   (since in-place expand would squeeze the narrative to nothing
   at 390 px). Phone landscape stays width-only per session 1's
   responsive contract — height-aware override deferred until
   user testing surfaces complaints. State survives reflow
   natively (Galaxy Fold unfold/fold, browser resize,
   orientation, iOS Slide Over) — open sheets dismiss on tier
   transitions out of phone (session 7 implementation guidance).
   Files: [`collapse.md`](./collapse.md),
   [`collapse.html`](./collapse.html).
5. **Touch grammar** — pending. Hover-brighten replacements,
   hover-affordance translation on entity rows, peek drawer →
   bottom sheet decision, save-bar placement on small screens,
   drag / long-press / swipe vocabulary, what desktop interactions
   don't translate at all.
6. **Platform** — pending. iOS notch / Android nav bar / status
   bar safe areas, swipe-back gesture, system back, mobile-web
   browser chrome (URL bar collapse), keyboard avoidance for the
   composer.
7. **Per-screen passes** — pending. ~10 surfaces, each upgrading
   its existing HTML to single-canonical responsive (viewport
   toggle, 3-tier reflow). Reconciles any pre-foundations
   `## Mobile` sections.

After session 6, mobile foundations is feature-complete for v1.
Session 7 is the consumer pass that mechanically applies the
contract to every surface.

## Wireframe convention

Mobile foundations wireframes inherit the existing convention per
[`../../../conventions.md → Wireframe authoring`](../../../conventions.md#wireframe-authoring):
monochrome, vanilla JS only, no build, low-fi. **The visual-identity
exemption (palette demos rendering real curated colors) does NOT
extend to mobile foundations** — these demos are layout / interaction
artifacts, not visual artifacts. Stay monochrome.

The viewport toggle is wireframe-tooling, not a runtime feature.
It exists for reviewers to flip between tiers quickly inside a
single canonical artifact; nothing in the actual app surfaces this.
