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

- exploration-record link.

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
2. **Navigation paradigm** — pending. Whether the desktop top-bar
   rule (per [`../../principles.md → Top-bar design rule`](../../principles.md#top-bar-design-rule))
   carries to mobile or platform conventions take over per tier.
   IA: which surfaces are tab-level vs nested. Route shapes.
3. **Layout primitives** — pending. Container conventions, the
   pane / sheet / drawer / modal vocabulary, full-screen route vs
   overlay rules. The "compose from these" tokens for every
   per-screen mobile design.
4. **Collapse rule** — pending. Universal rule for desktop's 2-
   and 3-pane surfaces becoming tablet 2-pane → phone 1-pane.
   Phone-landscape disposition (height-aware vs width-aware).
   Reader / composer (3-pane) is the canary; world / plot
   (2-pane) follow.
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
