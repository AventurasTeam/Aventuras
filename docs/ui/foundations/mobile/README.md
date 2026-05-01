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
- [`touch.md`](./touch.md) — touch grammar: minimal-translation
  philosophy, hover replacement (always-visible-muted via the
  generalized icon-actions rule), gesture vocabulary (no
  long-press, no swipe-on-row, no pull-to-refresh), save bar
  hide-on-keyboard, status pill tap to popover, chip-strip
  ~16 px safe zone for iOS swipe-back, tap-to-tooltip on inert
  truncated chrome text, tooltip and keyboard-shortcut scope.
- [`touch.html`](./touch.html) — interactive demo: hover-vs-touch
  toggle on icon-actions, status-pill tap-to-popover, save-bar
  hide-on-keyboard, tap-to-tooltip on a truncated label.
- [`platform.md`](./platform.md) — platform contract: target
  scoping (Expo iOS / Android, Electron desktop; mobile-web NOT
  a target), safe-area handling via
  `react-native-safe-area-context`, OS back integration
  (Android `BackHandler`, iOS swipe-back) bound to stack-aware
  Return, keyboard avoidance via `KeyboardAvoidingView`, sheet
  drag-dismiss thresholds per platform, Galaxy Fold reflow,
  accessibility (VoiceOver / TalkBack labeling, focus traps,
  dynamic-type, status-pill phase announcements), status-bar
  style binding to active theme.
- [`platform.html`](./platform.html) — interactive demo: phone
  outline showing safe-area regions across iOS notch / iOS
  Dynamic Island / Android gesture-mode / Android button-mode,
  with theme-mode toggle showing status-bar style switch.

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
5. **Touch grammar** — landed 2026-05-01
   ([exploration record](../../../explorations/2026-05-01-mobile-touch.md)).
   **Minimal-translation philosophy** — touch is a subset of
   desktop interactions, not a parallel rich-gesture vocabulary.
   Hover-bound affordances translate to **always-visible-muted**
   via the generalized
   [icon-actions visibility rule](../../patterns/icon-actions.md).
   No long-press for actions, no swipe-on-row, no pull-to-refresh
   (open to additive triggers post-v1 if usage signal surfaces).
   Drag uses explicit handles, not long-press-to-grab. Save bar
   on phone **hides while keyboard is open**, reappears on field
   blur (navigate-away guard remains active throughout). Status
   pill on phone is icon-only, tap reveals phase plus cancel in a
   Popover (not Sheet — content fits the tiny-popover threshold).
   Chip-strip ~16 px left padding doubles as iOS-swipe-back safe
   zone. **Tap-to-tooltip on inert chrome text** (story title,
   current breadcrumb segment when truncated) — narrowly scoped to
   text not tappable for navigation. Tooltips and keyboard
   shortcuts are desktop-only. Bundled small **breadcrumb
   tappability amendment** to principles.md (parent segments
   tappable for navigation, current segment inert).
   Files: [`touch.md`](./touch.md), [`touch.html`](./touch.html).
6. **Platform** — landed 2026-05-01
   ([exploration record](../../../explorations/2026-05-01-mobile-platform.md)).
   **Platform targets explicit**: Expo (iOS / Android native) and
   Electron (desktop). **Mobile-web browsers are NOT
   a target** — the RN Web bundle exists only as Electron's
   renderer source; no public web URL, no PWA, no
   add-to-homescreen, no web-push. **Safe-area handling** via
   `react-native-safe-area-context` with concrete top-bar /
   bottom-edge / sheet / modal padding rules (iOS notch /
   Dynamic Island / home indicator, Android status bar / nav
   bar gesture-vs-button). **OS back integration**: Android
   `BackHandler` and iOS swipe-back gesture both route through
   stack-aware Return; **empty-stack-confirm is Android-relevant
   primarily** (iOS uses OS-native exit semantics). **Keyboard
   avoidance** via RN's `KeyboardAvoidingView` (iOS `padding`,
   Android `height` or native `adjustResize`); save-bar
   hide-on-keyboard from session 5 implemented via
   `Keyboard.addListener`. **Sheet drag-dismiss thresholds**
   adopt community-library platform-aware defaults. **Galaxy
   Fold reflow** uses RN's `Dimensions.change` listener;
   sheet-auto-dismiss-on-tier-transition is implementation
   guidance. **Accessibility** rules: VoiceOver / TalkBack
   labeling, focus traps for sheets / modals, dynamic-type
   scaling, status-pill phase announcements via
   `accessibilityLiveRegion`. **Status bar style** binds to the
   active theme's `themeMode`. **Out of scope for v1**: haptics,
   deep links, splash screen config, web-target concerns.
   Files: [`platform.md`](./platform.md),
   [`platform.html`](./platform.html).
7. **Per-screen retrofits (grouped)** — in progress.
   ~13 surfaces upgrade to render the responsive contract
   (viewport toggle, container-query reflow, mobile expression
   in per-screen `.md` docs, reconciliation of pre-foundations
   `## Mobile` sections). **Grouped by surface family** to balance
   commit focus against ceremony cost — per-screen sessions are
   too ceremonial for the volume; one big session is unreviewable.
   Groups (each its own commit, own exploration record):
   - **A — Entry flow** — landed 2026-05-01
     ([exploration record](../../../explorations/2026-05-01-mobile-group-a-entry-flow.md)).
     story-list, wizard, onboarding gain a `## Mobile expression`
     section citing the substrate contracts; their wireframes
     pick up the foundations viewport toggle and container-query
     reflow. story-list's grid is already `auto-fill minmax`-
     responsive (no shape change); ⋯ menu rebinds to Sheet
     (short) on phone per the layout binding table. wizard's
     step-pill row scrolls horizontally on phone (preserves
     named-pill semantics over dot-only compression);
     calendar-pickrow's two-column `1fr 1fr` stacks vertically;
     AI-assist popover becomes Sheet (medium) on phone; footer
     hides while keyboard is open (extending the save-bar
     contract from session 5 — the bottom-edge button row shape
     is identical even though the wizard isn't a save-sessions
     surface). onboarding's centered card → full-bleed on phone
     (no max-width / shadow / radius); padding compresses across
     header / body / footer.
   - **B — Reading flow** (pending): reader-composer,
     branch-navigator, rollback-confirm.
   - **C — In-story master-detail** (pending): world, plot,
     chapter-timeline.
   - **D — Settings + power-user** (pending): story-settings,
     app-settings, vault calendars, prompt-pack editor.

   Cross-cutting pattern docs (`patterns/icon-actions.md`,
   `save-sessions.md`, `calendar-picker.md`, `data.md`,
   `lists.md`, `forms.md`, `entity.md`) get touched as needed
   during per-screen passes; minor edits only, not separate
   sessions.

After session 6, the substrate is feature-complete for v1.
Session 7's grouped consumer pass mechanically applies the
contract to every surface; once all four groups land, mobile
foundations work is fully done.

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
