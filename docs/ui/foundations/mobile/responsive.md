# Responsive contract

Form-factor tiers, breakpoint boundaries, and the wireframe artifact
strategy that subsequent mobile-foundations sessions cite. This file
is session 1's substantive deliverable per
[`./README.md → Sessions`](./README.md#sessions); it carries the
contract everything else hangs off.

## Three tiers

Mobile foundations operates on three form-factor tiers — desktop,
tablet, phone — declared on a single CSS-px width axis. The tier
vocabulary is Tailwind-aligned so component code (NativeWind 4

- Tailwind 3) uses the same prefixes the docs declare.

| Tier        | CSS px width    | Tailwind utility prefix | Real-device anchors                                                      |
| ----------- | --------------- | ----------------------- | ------------------------------------------------------------------------ |
| **Phone**   | `< 640`         | base (no prefix)        | iPhone 15 (393), Galaxy S23 (360), Galaxy Z Fold cover (~360)            |
| **Tablet**  | `640` to `1023` | `sm:` and `md:`         | iPad mini portrait (744), iPad portrait (820), Galaxy Z Fold main (~904) |
| **Desktop** | `≥ 1024`        | `lg:` and up            | iPad Pro 12.9" portrait (1024), iPad landscape (~1180), laptop (≥ 1280)  |

### Boundary-pick rationale

- **Tailwind alignment.** Component code uses `lg:` for desktop,
  base for phone, `sm:` / `md:` for tablet. Zero translation cost
  between docs and code; no custom breakpoint config in
  `tailwind.config.js`.
- **iPad mini lands in tablet.** Setting the phone / tablet
  boundary at 640 (Tailwind `sm`) keeps iPad mini portrait
  (744 CSS px) in tablet tier. A boundary at 768 would relegate
  it to phone — a real device the old app served as a tablet
  would suddenly look like a phone. Avoided.
- **Galaxy Fold transitions cleanly.** Cover screen (~360) is
  phone, unfolded main screen (~904) is tablet. Same physical
  device crossing the 640 boundary mid-use is a layout reflow
  concern that session 4 (collapse rule) addresses; the tier
  vocabulary itself handles it natively.
- **Desktop boundary at 1024.** iPad Pro 12.9" portrait (exactly 1024) renders as desktop — its 3-pane reader fits comfortably
  at that width. iPad Pro 11" portrait (834) stays tablet. The
  iPad-Pro-12.9-portrait edge case is acceptable (rare device,
  big enough to host desktop layout).

### Out of scope for the tier vocabulary

- **Phone landscape** (~700–900 CSS px wide on most modern phones)
  currently lands in tablet tier. Whether this should override to
  phone tier (height-aware breakpoint) is **deferred to session 4
  (collapse rule)**. Session 1 stays width-only.
- **Ultra-wide displays (≥ 1920 CSS px)** get desktop layout. No
  separate "wide" tier in v1.
- **Tiny phones (< 320 CSS px)** are unsupported. No real device
  that small in the modern era.

## Artifact strategy

One canonical responsive HTML wireframe per per-screen surface.
Viewport toggle in the review-controls bar with three buttons:
**Phone** (390 px), **Tablet** (768 px), **Desktop** (1280 px). CSS
reflows on toggle. Subsequent per-screen mobile passes (session 7+)
retrofit existing wireframes; foundations session 1 ships the toggle
pattern as a reference implementation only — no existing wireframes
swept this session.

The reference points match the tier boundaries:

- **390 px** — middle of typical phones (Galaxy S23 at 360, iPhone
  15 Pro Max at 430). Lands inside phone tier.
- **768 px** — exactly the top of `md:`. Lands inside tablet tier.
- **1280 px** — canonical laptop width and the Tailwind `xl:`
  boundary. Lands inside desktop tier.

### Toggle mechanism

Container-width swap via CSS Container Queries (Baseline since 2023).
The wireframe content lives inside a `.viewport` wrapper whose
`max-width` is set by the toggle; `@container (min-width: ...)`
queries inside drive the reflow.

Why container queries instead of media queries:

- **Component-scoped responsive.** The same component appears in
  different layouts (a panel inside a side rail vs the same panel
  full-screen on phone). Container queries respond to the
  component's container, not the viewport — the production pattern
  for component-scoped responsive design. Wireframes prototype that
  pattern directly.
- **No iframe overhead.** Outer page chrome (review-controls bar,
  page background) stays full-width. No double scrollbar.
- **Consistent with how the app actually renders responsive
  components.** A media-query-driven wireframe would need
  translation when the component lands in production code; a
  container-query wireframe doesn't.

The minor learning curve: per-screen wireframes write `@container`
rules instead of `@media`. The reference demo at
[`./responsive.html`](./responsive.html) shows the pattern.

### Toggle UI specification

The reference demo establishes the toggle contract that per-screen
retrofits adopt verbatim:

- **Three buttons** in the review-controls bar, segment-style (per
  [`../../patterns/forms.md`](../../patterns/forms.md)). Each
  carries a `data-vp` attribute (`phone` / `tablet` / `desktop`)
  and a `data-width` attribute (`390` / `768` / `1280`).
- **Active state highlights the current viewport** using the same
  `.rb-btn.active` class other wireframes use. Visual treatment
  matches existing review-bar buttons.
- **Default on first load: Desktop.** Preserves "this is the
  canonical layout" framing for surfaces whose primary use is
  still desktop-shaped at v1. The default flips on per-surface
  basis if a surface is meaningfully phone-first; session 7's
  per-screen retrofit decides.
- **Persistence via `localStorage` key `aventuras-wireframe-viewport`.**
  Per-browser, not per-wireframe. Reviewing multiple wireframes
  back-to-back keeps the same viewport — the reviewer thinks in
  tiers, not in per-screen settings.
- **Keyboard shortcuts: `1` / `2` / `3`** for phone / tablet /
  desktop. Skipped when focus is inside a form input. Cheap and
  reviewer-friendly.

### Outside the per-screen artifact

Cross-cutting mobile demos (the foundations-internal demos for
sessions 2–6) live as standalone HTML inside `mobile/`, alongside
their owning `.md`. Per-session demos may use the same toggle UI
but aren't required to — a navigation-paradigm demo demonstrating
how a tab-bar moves at one tier might not need to demonstrate the
other two tiers, and the toggle would be visual noise.

## Pre-foundations mobile content — stance

Two per-screen docs already carry partial mobile sections that
pre-date this contract:

- [`../../screens/reader-composer/branch-navigator/branch-navigator.md → Mobile — bottom drawer`](../../screens/reader-composer/branch-navigator/branch-navigator.md#mobile--bottom-drawer)
  — full bottom-drawer spec for the branch-navigator popover.
- [`../../screens/reader-composer/rollback-confirm/rollback-confirm.md → Mobile`](../../screens/reader-composer/rollback-confirm/rollback-confirm.md#mobile)
  — modal renders identically; hover-preview is desktop-only.

**Stance: interim, reviewable.** They constitute pre-foundations
decisions taken in service of single per-screen designs; the mobile
contract owns the global vocabulary they should compose from.
Sessions 2–6 may revise the underlying primitives (session 3 might
mint a "sheet" primitive that the bottom-drawer spec then cites
instead of redefining itself); session 7's per-screen retrofits do
the reconciliation per surface. Session 1 does not delete or rewrite
them; the contract is forward-only.

The same stance applies to scattered mobile prose elsewhere in the
docs (`../../screens/reader-composer/reader-composer.md` line 170
"same affordance on desktop and mobile",
[`../iconography.md`](../iconography.md) reference to "375 px mobile
viewports", further mobile mentions in `branch-navigator.md`). No
sweep this session; sessions 2–6 promote vocabulary as it lands.
