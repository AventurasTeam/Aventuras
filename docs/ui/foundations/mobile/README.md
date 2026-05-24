# Mobile foundations

Mobile / responsive contract for Aventuras. Sister to the
visual-identity foundations carried by the parent
[`../README.md`](../README.md) — same level of cross-cutting scope,
orthogonal axis. Visual identity carries the **what things look
like** contract; mobile foundations carries the **what shape things
take across form factors, and how they're touched** contract. Both
substrate; neither nests under the other.

Multi-session pass chronicled at
[`sessions.md`](./sessions.md). Each session lands its own file(s)
and updates the sessions doc with its status and exploration-record
link.

## Files

- [`responsive.md`](./responsive.md) — responsive contract: three
  form-factor tiers (phone / tablet / desktop), Tailwind-aligned
  breakpoint boundaries (640 / 1024), single-canonical responsive
  HTML artifact strategy, viewport-toggle pattern adopted by
  per-screen wireframes, pre-foundations stance on existing
  per-screen `## Mobile` sections.
- [`responsive.html`](./responsive.html) — interactive reference:
  viewport toggle driving a generic 3-pane reflow via container
  queries.
- [`navigation.md`](./navigation.md) — navigation paradigm: top-bar
  shape per tier, cross-surface nav inheriting the desktop model,
  stack-aware Return + settings-icon-scope inheritance.
- [`navigation.html`](./navigation.html) — interactive demo of the
  chrome shape across viewport tiers.
- [`layout.md`](./layout.md) — layout primitives: four-primitive
  vocabulary (Popover, Modal, Sheet, Full-screen route), decision
  tree, desktop-to-mobile mapping rules, stacking rules, sheet
  behavior, per-surface primitive bindings table.
- [`layout.html`](./layout.html) — interactive demo of each
  primitive across viewport tiers.
- [`collapse.md`](./collapse.md) — collapse rule for multi-pane
  surfaces. Master-detail (World, Plot, Settings) collapses
  list-first on phone; Reader collapses to narrative-only with
  rail-strip-tap opening rail content as a bottom Sheet on phone.
- [`collapse.html`](./collapse.html) — interactive demo: surface
  toggle crossed with viewport toggle.
- [`touch.md`](./touch.md) — touch grammar: minimal-translation
  philosophy, hover replacement (always-visible-muted via
  icon-actions rule), gesture vocabulary, save bar
  hide-on-keyboard, status pill tap-to-popover, tap-to-tooltip
  scope.
- [`touch.html`](./touch.html) — interactive demo: hover-vs-touch
  toggle, status-pill tap-to-popover, save-bar hide-on-keyboard.
- [`platform.md`](./platform.md) — platform contract: target
  scoping (Expo iOS / Android, Electron desktop), safe-area
  handling, OS back integration, keyboard avoidance, sheet
  drag-dismiss thresholds, Galaxy Fold reflow, accessibility,
  status-bar style.
- [`platform.html`](./platform.html) — interactive demo: phone
  outline showing safe-area regions across iOS / Android variants.
- [`sessions.md`](./sessions.md) — multi-session chronicle for the
  mobile-foundations track + the wireframe convention scope.
