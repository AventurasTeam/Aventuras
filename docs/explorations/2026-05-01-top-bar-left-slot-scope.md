# Top-bar left slot — scope rule (amendment)

Small amendment to the
[Top-bar design rule](../ui/principles.md#top-bar-design-rule).
Tightens the LEFT slot's contents: Logo only on the root surface
(story-list); ← Return on every non-root surface; the two are
mutually exclusive in the leftmost slot. Same rule across desktop,
tablet, phone.

This was caught during mobile foundations session 3 review when
the user noted "most wireframes show back icon on the right and
logo on the left. I believe this should be changed. Logo on the
left only on story list, no back button, every other page, no
logo and back button on the left."

The current principle leaves placement underspecified — it lists
both Logo and ← Return as universal essentials without pinning
their slot. The wireframes evolved an implicit "logo left, back
right" convention which is desktop-conventional but inconsistent
with iOS / Android conventions where back lives in the top-left
corner.

This file is the amendment record. The canonical home is
[`../ui/principles.md → Top-bar design rule → Universal essentials`](../ui/principles.md#universal-essentials).

## Why

- **Platform convention.** iOS / Android / mobile-web all place
  back in the top-left. The current right-side back placement is
  desktop-conventional but doesn't transfer to mobile.
- **Logo on every screen wastes the left slot.** The leftmost
  position is the highest-attention region of the chrome. On
  non-root surfaces the user already has identity context (story
  title, breadcrumb); the app logo adds little. On root surfaces
  the logo IS the identity — no breadcrumb beyond `Stories`.
- **Mutual exclusivity is a clean rule.** Logo and back never
  coexist; root has logo (no back-target), non-root has back (and
  doesn't need logo for identity). No "where do they both go"
  layout puzzles.
- **Old-app mobile users.** Mobile-only users from the old app
  arrive conditioned to platform conventions. Right-side back
  would feel "off" without justification.

## The rule

The top-bar's leftmost slot carries one of two affordances based
on position in the navigation stack:

- **Root surface** (story-list — the app's home): **Logo** on the
  left. No ← Return.
- **Non-root surfaces** (everything else with chrome — Reader,
  World, Plot, Story Settings, Chapter Timeline, Vault, App
  Settings, ...): **← Return** ([stack-aware](../ui/principles.md#stack-aware-return))
  on the left. No logo.

**Special cases:**

- **Onboarding** — chromeless (per
  [`../ui/screens/onboarding/onboarding.md`](../ui/screens/onboarding/onboarding.md)).
  Empty stack at this point; the empty-stack-confirm clause of
  stack-aware Return still fires if the user attempts back via
  hardware / gesture.
- **Wizard** — its own minimal chrome (`[← Cancel]` on left, step
  indicator centered, no logo). Already conforms.
- **Modals** — full overlays, no top bar. Out of scope.

## Adversarial review

- **Loss of brand presence on non-root surfaces.** Trade-off: app
  logo on every screen is "the app reminds you what app you're
  in." iOS / Android apps don't do this — the navigation bar's
  title carries identity. Acceptable: brand presence is at the
  root, splash, and app icon; non-root surfaces have story-shaped
  identity (story title, breadcrumb).
- **Visual symmetry.** Logo-everywhere is consistent; logo-on-
  root-only signals position. The asymmetry is informative — the
  user can tell at a glance whether they're at the root or
  navigated in.
- **Existing 10+ wireframes show the old layout.** They'll be
  visually inconsistent with the new rule until session 7 of
  mobile-foundations sweeps them. **Deliberately not sweeping
  this commit** — the wireframe sweep is already in scope for
  session 7's per-screen retrofits, and bundling it now would
  bloat this amendment.
- **Right slot stays right slot.** The right side of the top bar
  carries Actions menu, Settings icon, status pill. None of those
  move; only the left slot changes scope. Symmetry of the right
  group preserved.
- **What about screens reached via deep link / one-shot return?**
  `Edit info` from story-list boots a story and routes to its
  Story Settings; the one-shot return target is story-list (per
  stack-aware Return). The Story Settings surface is non-root, so
  the back arrow renders on the left. First Return goes to
  story-list per the existing one-shot rule. No rule change
  needed; the new left-slot rule plays cleanly with one-shot
  returns.
- **Cross-tier consistency.** Same rule on desktop, tablet, phone.
  No tier-specific override.

## Integration plan

Files in the amendment commit:

- **EDIT** `docs/ui/principles.md` — modify "Universal essentials"
  bullet list. Replace the separate `Logo` and `← Return` bullets
  with a single "Left slot" bullet that pins the root-vs-non-root
  rule. Add an Onboarding special-case note. Other sub-sections
  (Universal in-story chrome, Reader-only chrome, Settings icon
  scope, Master-detail sub-header) preserved verbatim. Heading
  anchors `#universal-essentials`, `#universal-in-story-chrome`,
  `#reader-only-chrome`, `#settings-icon-scope`,
  `#master-detail-sub-header`, `#top-bar-design-rule` all preserved.
- **EDIT** `docs/ui/foundations/mobile/navigation.md` — chrome
  shape sketches updated. Reader phone: `[←]` on left, no `[A]`.
  Sub-screen phone: same. App-level non-root phone: `[←]` on
  left. Story-list phone (root): `[A]` on left, no `←`. Tablet
  and desktop equivalents implied by "tablet inherits desktop"
  reference, but the chrome sketches in navigation.md are
  phone-focused so this is the main edit.
- **EDIT** `docs/ui/foundations/mobile/navigation.html` — same
  correction in the demo's three surface sketches. Reader: `[←]`
  trigger on left. World: `[←]` on left. Story-list: `[A]` on
  left, no back.
- **NEW** `docs/explorations/2026-05-01-top-bar-left-slot-scope.md`
  — this record.

**Not** sweeping per-screen wireframes — already in scope for
session 7. The existing wireframes will continue showing the old
layout until each surface's per-screen retrofit; the amendment
record explicitly notes this divergence.

Renames / heading changes: none. All inbound anchors preserved.

Patterns adopted on a new surface: none.

Followups resolved: none. The user's feedback wasn't a followup
entry; it was clarifying input during session 3 review.

Followups introduced: none. The 10+ wireframe-sweep is already in
session 7's scope.

Wireframes updated: one (`navigation.html`); existing per-screen
wireframes deferred to session 7.

## Self-review

- **Placeholders.** None.
- **Internal consistency.** The new rule references stack-aware
  Return for the empty-stack-confirm path; uses the same anchor
  the original principle uses. No naming drift.
- **Scope.** Single integration; left-slot scope only. No other
  chrome rules touched.
- **Ambiguity.** "Root surface" defined as story-list (the app's
  home); non-root explicitly enumerated. Onboarding and Wizard
  special cases called out.
- **Doc rules.** Anchor links resolve. No `+` separators in prose.
