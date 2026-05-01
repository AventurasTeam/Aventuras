# Mobile foundations — scaffolding + multi-session plan (session 1)

Session 1 of a multi-session mobile-foundations design pass. Sister
contract to the visual-identity foundations (per
[`../ui/foundations/README.md → Sessions`](../ui/foundations/README.md#sessions))
— same level of cross-cutting scope, orthogonal axis. Visual
identity carries the **what things look like** contract; mobile
foundations carries the **what shape things take across form
factors, and how they're touched** contract. Both substrate;
neither nests under the other.

This session is intentionally scaffolding-only. It pins the contract
that subsequent sessions cite — form-factor matrix, breakpoint
values, artifact strategy, viewport-toggle pattern, and the
multi-session plan itself. No layout / navigation / collapse / touch
rules are pinned this session; those each get their own pass.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/mobile/README.md`](../ui/foundations/mobile/README.md).

## Decisions locked entering this session

Reached by dialogue earlier in the session:

- **Full parity scope.** Every v1 surface in
  [`../ui/README.md`](../ui/README.md) gets a working mobile
  variant, including surfaces currently flagged desktop-only
  (prompt / pack editor — the editor _surface_ may need a
  mobile-substitute for CodeMirror, but the screen exists on phone
  and tablet). Old-app mobile-only-user precedent is the driver:
  mobile is first-class, not a degraded subset.
- **Three tiers — desktop / tablet / phone.** Tablet is its own
  design tier, not collapsed into either of the other two. Galaxy
  Fold (cover ≈ phone, main ≈ tablet) and iPad portrait are the
  motivating cases: forcing tablet through phone layout wastes
  screen real estate, and forcing it through desktop layout cramps
  the multi-pane surfaces in portrait.
- **Single responsive HTML per screen.** One canonical wireframe
  artifact per surface, with a viewport toggle in the
  review-controls bar (Phone / Tablet / Desktop). CSS reflows on
  toggle. Existing per-screen wireframes get retrofit during their
  per-screen mobile pass (session 7+); foundations session 1 ships
  the toggle pattern as a reference implementation.
- **Multi-session structure.** Foundations spans 7 sessions
  (scaffolding → navigation → layout → collapse → touch → platform
  → per-screen passes), mirroring the visual-identity precedent.

## Form-factor matrix + breakpoints

Three tiers, Tailwind-aligned numeric boundaries:

| Tier        | CSS px width    | Tailwind utility prefix | Real-device anchors                                                      |
| ----------- | --------------- | ----------------------- | ------------------------------------------------------------------------ |
| **Phone**   | `< 640`         | base (no prefix)        | iPhone 15 (393), Galaxy S23 (360), Galaxy Z Fold cover (~360)            |
| **Tablet**  | `640` to `1023` | `sm:` and `md:`         | iPad mini portrait (744), iPad portrait (820), Galaxy Z Fold main (~904) |
| **Desktop** | `≥ 1024`        | `lg:` and up            | iPad Pro 12.9" portrait (1024), iPad landscape (~1180), laptop (≥ 1280)  |

Boundary-pick rationale:

- **Tailwind alignment.** NativeWind 4 inherits Tailwind's
  breakpoint vocabulary; declaring our tiers in those exact values
  means component code uses `lg:` for desktop layout, base for
  phone, with no custom breakpoint config. Zero translation cost
  between docs and code.
- **iPad mini lands in tablet.** Setting the phone/tablet boundary
  at 640 (Tailwind `sm`) keeps iPad mini portrait (744 CSS px) in
  tablet tier. A boundary at 768 would relegate it to phone — a
  real device the old app served as a tablet would suddenly look
  like a phone. Avoided.
- **Galaxy Fold transitions cleanly.** Cover screen is phone,
  unfolded main screen is tablet. Same physical device crossing the
  640 boundary mid-use is a layout reflow concern that session 4
  (collapse rule) addresses; the tier vocabulary itself handles it
  natively.
- **Desktop boundary at 1024.** iPad Pro 12.9" portrait (exactly 1024) renders as desktop — its 3-pane reader fits comfortably at
  that width. iPad Pro 11" portrait (834) stays tablet. The
  iPad-Pro-12.9-portrait edge case is acceptable (rare device, big
  enough to host desktop layout).

Phone-landscape edge: most modern phones in landscape are ~700–900
CSS px wide — which lands in tablet tier under these boundaries. A
phone-tier-only-when-portrait override (height-aware breakpoint or
explicit phone-landscape rule) is **deferred to session 4 (collapse
rule)** — that session decides whether phone landscape stays
single-pane (height-aware) or earns tablet's two-pane treatment
(width-aware as currently). Session 1 does not lock this.

Out-of-scope at v1: ultra-wide displays (≥ 1920 px) get desktop
layout with no separate "wide" tier. Tiny phones (< 320 px) are
unsupported (no real device that small in the modern era).

## Artifact strategy

One canonical responsive HTML wireframe per per-screen surface.
Viewport toggle in the review-controls bar with three buttons:
**Phone** (390 px), **Tablet** (768 px), **Desktop** (1280 px).
CSS reflows via `@media (min-width: ...)` queries.

Toggle mechanism — picking between two implementations:

- **Container-width swap (chosen).** The wireframe content lives
  inside a `.viewport` wrapper whose `max-width` is set by the
  toggle; CSS `@container (min-width: ...)` queries (CSS Container
  Queries, Baseline since 2023) drive the reflow. Pro: outer page
  chrome (review-controls bar, page background) stays full-width.
  No iframe overhead. Con: requires consumers to write
  `@container` rules instead of `@media` — minor learning curve.
- **iframe-hosted page.** Wireframe content rendered inside an
  iframe whose width is set by the toggle. Pro: standard `@media`
  rules work as in production. Con: iframe overhead, double
  scrollbar potential, complicates simple wireframes.

The container-query approach matches how production CSS handles
component-scoped responsive design (a panel is responsive to its
container, not the viewport — relevant when the same component
appears in different layouts). Wireframes prototype that pattern
directly.

Reference points (Phone / Tablet / Desktop) match the tier
boundaries: 390 picks the larger end of typical phones (iPhone 15
Pro Max sits at 430, Galaxy S23 at 360 — 390 hits the middle); 768
sits exactly at the top of `md:`; 1280 is the canonical laptop
width and the Tailwind `xl:` boundary.

The toggle ships as a reference HTML demo at
[`../ui/foundations/mobile/responsive.html`](../ui/foundations/mobile/responsive.html).
Per-screen wireframes adopt it during their session-7+ retrofit;
foundations session 1 does not sweep existing wireframes.

## Viewport-toggle pattern spec

The reference demo demonstrates a sample 3-pane layout reflowing
across the three viewports:

- **Desktop (≥ 1024)** — three columns side-by-side.
- **Tablet (640–1023)** — two columns + a drawer for the third
  (placeholder, since drawer/sheet vocabulary is session 3's
  decision).
- **Phone (< 640)** — single column with stacked routes
  (placeholder for session 4's collapse rule).

The layout is intentionally generic — a stand-in showing the
mechanism, not pinning a specific multi-pane collapse rule. Session
4 lands the actual rule; the demo gets updated then.

Toggle UI (mocked in the demo, copied by per-screen wireframes):

- Three buttons in the review-controls bar, segment-style
  (per [`../ui/patterns/forms.md`](../ui/patterns/forms.md)).
- Active state highlights the current viewport.
- Default on first load: **Desktop** — preserves "this is the
  canonical layout" framing for surfaces whose primary use is
  still desktop-shaped.
- Toggle persists across reloads via `localStorage` key
  `aventuras-wireframe-viewport` (per-browser, not per-wireframe;
  reviewing multiple wireframes back-to-back keeps the same
  viewport).
- Optional — keyboard shortcuts (1/2/3) to flip between phone /
  tablet / desktop. Cheap and reviewer-friendly. Locked in.

Wireframe convention notes:

- Mobile foundations wireframes inherit the existing convention
  per [`../conventions.md → Wireframe authoring`](../conventions.md#wireframe-authoring):
  monochrome, vanilla JS only, no build, low-fi. The visual-identity
  exemption (palette demos render real colors) does **not** extend
  to mobile foundations — these demos are layout/interaction
  artifacts, not visual artifacts.
- The viewport toggle is wireframe-tooling, not a runtime feature.
  It exists for reviewers to flip between tiers quickly; nothing
  in the actual app surfaces this.

## Multi-session plan

Foundations spans seven sessions. Each subsequent session lands its
own canonical file under `ui/foundations/mobile/` and updates the
session list with status + exploration-record link, mirroring the
visual-identity foundations pattern.

| Session                    | Scope                                                                                                                                                                                                                                                 | Output                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **1 — Scaffolding (this)** | Form-factor matrix + breakpoints, artifact strategy + viewport toggle, multi-session plan. No design rules pinned beyond the contract everything else cites.                                                                                          | `mobile/README.md` + `mobile/responsive.html`                             |
| **2 — Navigation**         | Whether the desktop top-bar rule (per [`../ui/principles.md → Top-bar design rule`](../ui/principles.md#top-bar-design-rule)) carries to mobile or platform conventions take over per tier. IA: which surfaces are tab-level vs nested. Route shapes. | `mobile/navigation.md` + standalone HTML demo                             |
| **3 — Layout primitives**  | Container conventions, the pane / sheet / drawer / modal vocabulary, full-screen route vs overlay rules. The "compose from these" tokens for every per-screen mobile design.                                                                          | `mobile/layout.md` + demo                                                 |
| **4 — Collapse rule**      | Universal rule for desktop's 2- and 3-pane surfaces becoming tablet 2-pane → phone 1-pane. Phone-landscape disposition (height-aware vs width-aware). Reader/composer (3-pane) is the canary; world/plot (2-pane) follow.                             | `mobile/collapse.md` + demo, possibly a reader-composer responsive sketch |
| **5 — Touch grammar**      | Hover-brighten → ?, hover-affordances on entity rows → ?, peek drawer → bottom sheet (or stays peek?), save-bar placement on small screens, drag/long-press/swipe vocabulary, what desktop interactions don't translate at all.                       | `mobile/touch.md` + demo                                                  |
| **6 — Platform**           | iOS notch / Android nav bar / status bar safe areas, swipe-back gesture, system back, mobile-web browser chrome (address bar collapse), keyboard avoidance for the composer.                                                                          | `mobile/platform.md` + demo                                               |
| **7+ — Per-screen passes** | ~10 surfaces, each upgrading its existing HTML to single-canonical responsive (viewport toggle, 3-tier reflow). Reconciles any pre-foundations `## Mobile` sections that pre-date the contract.                                                       | per-screen `.html` retrofits + `.md` updates citing foundations           |

Sessions 2–6 aren't fully independent — layout primitives (3) need
the navigation paradigm (2); collapse rule (4) needs both; touch
grammar (5) needs the sheet/drawer vocabulary from (3); platform (6)
cross-cuts everything. The plan is roughly topological-sort-correct,
but each session may revisit earlier decisions — the visual-identity
sessions did the same (e.g. session 4 cut the density toggle that
session 1 had introduced). Acceptable.

After session 6, mobile foundations is feature-complete for v1.
Session 7+ per-screen passes are the consumer pass — they mostly
mechanically apply the contract.

## Pre-foundations mobile content — stance

Two per-screen docs already carry partial mobile sections that
pre-date this contract:

- [`../ui/screens/reader-composer/branch-navigator/branch-navigator.md → Mobile — bottom drawer`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md#mobile--bottom-drawer)
  — full bottom-drawer spec for the branch-navigator popover.
- [`../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md → Mobile`](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#mobile)
  — modal renders identically; hover-preview is desktop-only.

Stance: **interim, reviewable.** They constitute pre-foundations
decisions taken in service of single per-screen designs; the mobile
pass owns the global vocabulary they should compose from. Sessions
2–6 may revise the underlying primitives (e.g. session 3 might mint
a "sheet" primitive that the bottom-drawer spec then cites instead
of redefining) and session 7's per-screen passes for those surfaces
do the reconciliation. Session 1 does not delete or rewrite them;
the contract is forward-only.

This stance also applies to scattered mobile prose in other
per-screen docs (`reader-composer.md` line 170 "same affordance on
desktop and mobile", `iconography.md` line 257 "375 px mobile
viewports", `branch-navigator.md`'s further mobile mentions). No
sweep this session; sessions 2–6 promote vocabulary as it lands and
session 7's per-screen passes pull each cite into the new contract.

## Place in the tree

Mobile foundations lives at `docs/ui/foundations/mobile/`. Reasoning:

- **Foundations directory hosts substrate contracts.** Visual
  identity + mobile are the two cross-cutting contracts at this
  level. Co-locating them makes "what's foundational" a single
  navigable directory.
- **Mobile is multi-session and multi-file.** The "subdir when a
  topic fans out" rule from
  [`../conventions.md → Where files live`](../conventions.md#where-files-live)
  applies — mobile foundations will have 6+ files across sessions.
- **Visual identity stays flat.** Visual-identity foundations
  (`color.md`, `typography.md`, etc.) remain top-level files inside
  `foundations/`. They predate mobile and don't need a wrapping
  subdirectory; making them peers of `mobile/` is fine.

The `foundations/README.md` description broadens slightly — its
opening "Visual identity foundations for Aventuras" becomes
"Foundations for Aventuras", with a paragraph describing the two
orthogonal contracts (visual identity / mobile) and where each one
lives. The visual-identity Sessions list and Files list stay; a
new "Mobile" pointer links into `mobile/README.md` whose own
sessions list owns mobile-side tracking.

## Adversarial pass

After section-by-section approval, deliberately try to break it.

### Load-bearing assumption

The 7-session plan assumes sessions 2–6 are roughly sequential.
Each builds on prior pinned decisions. If session 2 pins a
navigation paradigm that requires a layout primitive nobody
predicted, session 3 either adopts it retroactively or session 2
revises. The visual-identity foundations had the same risk and
mostly handled it via in-session revisions and one explicit cut
(density toggle). Acceptable; not a load-bearing failure.

The deeper assumption: **NativeWind 4 honors Tailwind breakpoints
identically across platforms.** If iOS / Android / RN-Web diverge
at the breakpoint level (e.g. `lg:` triggers at different CSS-px
on native vs web), the tier vocabulary collapses. Verified against
NativeWind 4 docs: `screen-sm` / `screen-md` / `screen-lg` are
configured identically across platforms; user-configurable in
`tailwind.config.js`. Confidence: high. Worth a note in session 7
implementation that breakpoint config matches the foundations
contract (one place to check).

### Edge cases

- **Galaxy Fold transition mid-use.** User unfolds the device while
  the app is open; layout reflows from phone (cover ~360) to tablet
  (main ~904). Expo handles the dimension-change event natively;
  the app re-renders on dimension change (standard RN behavior).
  Session 4 (collapse rule) needs to address what state survives
  the reflow — a peek-drawer-open on phone may need to become a
  side-pane on tablet, or close. Session 1 doesn't address this;
  scope is layout vocabulary, not state machines.
- **iPad Pro 12.9" portrait at exactly 1024 CSS px.** Renders as
  desktop. Three-pane reader fits, but barely. Session 4 may want
  a "comfortable 3-pane minimum" rule that's stricter than 1024 —
  in which case iPad-Pro-portrait drops to tablet-tier 2-pane.
  Session 1 doesn't lock this; the breakpoint is the **default**,
  per-surface overrides are session 4's call.
- **Phone landscape (~700–900 px wide).** Currently lands in
  tablet. Some surfaces (reader, world) might genuinely benefit
  from tablet layout in phone landscape (more horizontal real
  estate to fill). Others (chapter timeline, settings) might want
  phone layout regardless of orientation. Session 4 decides
  per-surface or globally; session 1 stays width-only.
- **Mobile-web browsers** (Safari iOS, Chrome Android). CSS-px
  reporting matches Expo. URL bar collapse changes visible viewport
  height not width — covered by session 6 (platform). The toggle
  pattern works in mobile browsers without modification (CSS
  container queries + standard event handling).
- **Desktop browser narrowed to phone width.** A desktop user at a
  600px-wide window gets phone layout. Correct, that's responsive.
  Worth noting that hover affordances (which session 5 will make
  touch-aware) still trigger because the device has a mouse —
  hover-vs-touch is **input modality**, not viewport width. Session
  5's territory; session 1 does not conflate the two axes.

### Read-site impact / doc-integration cascades

- `parked.md` "Mobile variants for every screen" entry (line 361)
  is **resolved by this design pass**. The entry's "Mobile is
  first-class, not an afterthought" narrative becomes session 1's
  scope statement. Removed in this commit; resolution narrative
  goes in the commit message.
- `ui/README.md` "Cross-cutting states" line "Mobile variants for
  everything (deferred)" gets updated — the deferral text drops, a
  pointer to `foundations/mobile/` replaces it. The section anchor
  `#cross-cutting-states-not-standalone-screens` survives so
  inbound exploration-record references stay valid.
- `ui/foundations/README.md` opening prose broadens; new mobile
  pointer added. Visual-identity sessions list untouched.
- Pre-existing `## Mobile` sections in `branch-navigator.md` /
  `rollback-confirm.md` — left untouched per the stance section
  above. Session 7 retrofits.
- No followups in `followups.md` reference mobile-foundations;
  none cited as resolved by this session.

### Missing perspective

- **Sync / backup format.** Mobile foundations is layout +
  interaction contract; doesn't change the schema, doesn't change
  what's serialized, doesn't change sync behavior. ✓
- **Translation pipeline.** Mobile is layout, not content; not
  affected. ✓
- **Implementation cost on native.** NativeWind 4 supports
  responsive utilities natively. Reflow on rotation / unfold uses
  RN's `Dimensions` listener (standard pattern). No new
  infrastructure. ✓
- **Old-app failure modes on mobile.** Not surveyed in this
  session. Worth probing at session 2 (navigation) — what about
  the old app's mobile experience caused users to bounce or
  complain? The old-app evidence will inform session 2's
  navigation-paradigm pick more than any abstract decision tree.
  Noted as session-2 input rather than a session-1 followup.
- **Performance on cheap Android phones.** Three-tier responsive
  CSS is essentially free at runtime. RN's layout engine handles
  flex / grid identically across tiers; the cost is the same
  whether the layout is phone or desktop. ✓
- **Accessibility — touch target sizing, screen-reader gestures,
  dynamic-type support, reduce-motion on mobile.** Per-tier
  touch-target sizing is session 5 (touch grammar). Screen-reader
  - dynamic-type + reduce-motion are session 6 (platform). Session
    1 does not pin them but the multi-session plan reserves slots.

### What got verified vs assumed

- **Verified.** NativeWind 4 honors Tailwind breakpoints across
  platforms (read NativeWind 4 docs). Tailwind `sm:` / `md:` / `lg:`
  values match what's used here. Galaxy Fold dimensions confirmed
  via Samsung spec. iPad mini portrait dimensions confirmed via
  Apple spec.
- **Assumed.** That Expo's `Dimensions` listener fires on
  Galaxy-Fold-style mid-use transitions. Probably true but not
  validated — flagged as session-7 implementation check.
  Container queries' Baseline-since-2023 status — assumed safe for
  static-HTML wireframes; Electron renderer is recent Chromium so
  no concern there, mobile-browser support also Baseline.

## Followups generated

- **Section anchor stability.** `ui/README.md`'s "Cross-cutting
  states" anchor (`#cross-cutting-states-not-standalone-screens`)
  is referenced from at least one exploration record. The integration
  must not rename the heading; only the bullet content changes.
- **Old-app mobile failure modes.** Surface this as a session-2
  input rather than a discrete followup. Session 2's clarifying
  questions probe it; no entry in `followups.md`.
- **CodeMirror-on-mobile substitute.** The user noted in session
  that the prompt/pack editor's CodeMirror dependency may need a
  mobile substitute. Already present as a soft note in
  [`../tech-stack.md`](../tech-stack.md) (line 114). Stays there;
  formal design lands at session 7's per-screen pass for the
  prompt editor. No new entry in `followups.md` or `parked.md`.
- **Per-surface breakpoint overrides.** Session 4 (collapse rule)
  may need to override the default 1024 desktop boundary for
  surfaces whose 3-pane minimum is wider (e.g. reader at ~1100).
  Not a session-1 decision; reserved as a session-4 input.

## Integration plan

Files touched in the integration commit:

- **NEW** `docs/ui/foundations/mobile/README.md` — canonical home
  for the contract. Form-factor matrix, breakpoint table,
  artifact strategy, viewport-toggle reference, multi-session
  plan, pre-foundations stance, place-in-the-tree note.
- **NEW** `docs/ui/foundations/mobile/responsive.html` —
  reference HTML demonstrating the toggle + a generic 3-pane
  reflow. Adopted by per-screen retrofits at session 7.
- **EDIT** `docs/ui/foundations/README.md` — opening prose
  broadens from "Visual identity foundations" to "Foundations";
  one paragraph describing the two orthogonal contracts; new
  "Files" entry pointing at `mobile/`; the existing visual-identity
  Sessions list and Files block stay intact.
- **EDIT** `docs/ui/README.md` — "Cross-cutting states" section
  bullet "Mobile variants for everything (deferred)" replaced with
  a pointer to `foundations/mobile/`. The section heading itself
  stays so the inbound exploration-record anchor survives.
- **EDIT** `docs/parked.md` — entry "Mobile variants for every
  screen" (line 361) removed. Resolution narrative goes in the
  commit message: "mobile-foundations design pass starts here;
  parked entry resolved."

Renames / heading changes: none. (`ui/README.md` section heading
and `ui/foundations/README.md` Sessions anchor both survive
verbatim.)

Patterns adopted on a new surface: none — the new foundations
material doesn't cite any existing pattern doc; it cites principles
and conventions only.

Followups resolved (in `followups.md`): none reference mobile
foundations.

Followups introduced: none. The CodeMirror-on-mobile question
already lives in `tech-stack.md`; per-surface breakpoint overrides
and old-app failure modes are session-2/4 inputs not standalone
followups.

Wireframes updated: one new (`responsive.html`); no existing
wireframes touched this session.

Intentional repeated prose: the form-factor table appears verbatim
in this exploration record and will appear in `mobile/README.md`.
Standard exploration-record duplication; the canonical home wins
once integrated.

## Self-review

Fresh-eyes pass after writing:

- **Placeholders.** None — every "session N decides" forward
  reference names the actual session.
- **Internal consistency.** Tier boundaries 640 / 1024, Tailwind
  prefixes `sm:` / `md:` / `lg:` — same values used throughout.
- **Scope.** Single integration; scaffolding only. No design
  rules creep in — verified each section ends in either the
  contract value (e.g. 640 boundary) or "deferred to session N."
- **Ambiguity.** "Single canonical responsive HTML" — clarified
  that this means one artifact per surface, not one artifact total.
  "Three buttons" in the toggle — clarified as Phone / Tablet /
  Desktop with explicit pixel values.
- **Doc rules.** Anchor links resolve to existing sections (spot-
  checked `principles.md → Top-bar design rule`,
  `conventions.md → Where files live`, etc.). No bracketed inline
  phrases without backticks.
