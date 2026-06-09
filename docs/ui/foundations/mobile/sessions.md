# Mobile-foundations sessions

Retrospective chronicle for the mobile / responsive contract.
Substrate sessions 1–6 landed 2026-05-01; the substrate is
feature-complete for v1. Session 7 is the grouped per-screen
retrofit pass — groups A / B / C landed 2026-05-01, group D
landed 2026-05-02 (3 surfaces — story-settings, app-settings,
vault calendars; the fourth, prompt-pack editor, is deferred
past v1). Mobile foundations work is feature-complete for v1.
Visual-identity sessions are chronicled separately at
[`../sessions.md`](../sessions.md).

## Session list

Six substrate sessions (1–6) landed 2026-05-01, pinning the cross-
cutting mobile contract. Session 7 is the per-screen consumer
pass — four surface-family groups, A / B / C landed 2026-05-01,
D landed 2026-05-02 (prompt-pack editor surface deferred past v1).
Per session below: date landed, exploration record, scope summary,
files produced.

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
   active theme's `mode`. **Out of scope for v1**: haptics,
   deep links, splash screen config, web-target concerns.
   Files: [`platform.md`](./platform.md),
   [`platform.html`](./platform.html).
7. **Per-screen retrofits (grouped)** — landed
   (A / B / C done 2026-05-01; D done 2026-05-02 with the three
   v1 surfaces; prompt-pack editor surface deferred past v1).
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
     step-pill row collapses to dots-only on phone (top-bar's
     `step N of 5` carries textual context; pivoted from initial
     horizontal-scroll choice after wireframe review);
     calendar-pickrow's two-column `1fr 1fr` stacks vertically;
     AI-assist popover becomes Sheet (medium) on phone; footer
     hides while keyboard is open (extending the save-bar
     contract from session 5 — the bottom-edge button row shape
     is identical even though the wizard isn't a save-sessions
     surface). onboarding's centered card → full-bleed on phone
     (no max-width / shadow / radius); padding compresses across
     header / body / footer.
   - **B — Reading flow** — landed 2026-05-01
     ([exploration record](../../../explorations/2026-05-01-mobile-group-b-reading-flow.md)).
     reader-composer, branch-navigator, rollback-confirm gain
     `## Mobile expression` sections and viewport-toggle wireframes.
     reader-composer is the substantive surface — phone-tier
     forced-collapse to 1-pane (rail to edge strip), strip-tap
     opens the rail content as a bottom Sheet (medium initial,
     grows to tall on peek), reader chip strip below the top-bar,
     status-pill icon-only with tap-to-popover, composer
     keyboard-avoidance per platform.md. branch-navigator's
     pre-foundations `## Mobile — bottom drawer` section
     reconciled to `## Mobile expression` using Sheet (short)
     vocabulary; the 480 px width cap dropped (bottom Sheets are
     full-width on phone). rollback-confirm's pre-foundations
     `## Mobile` heading renamed; modal stays Modal at every
     tier; hover-preview is desktop-only. Five inbound anchor
     refs to the renamed headings updated in the same commit.
   - **C — In-story master-detail** — landed 2026-05-01
     ([exploration record](../../../explorations/2026-05-01-mobile-group-c-master-detail.md)).
     world, plot, chapter-timeline gain `## Mobile expression`
     sections and viewport-toggle wireframes. World and Plot
     follow the master-detail collapse contract (list-first on
     phone, detail as full-screen route, back returns to list);
     chapter-timeline is single-pane and reflows naturally.
     **Substantive substrate touch**: detail-pane tab navigation
     reroutes through the existing Select primitive when the
     desktop Tab strip overflows — Tab strip on desktop always
     and tablet when count ≤ 3; Select segment on phone when
     count ≤ 2; Select dropdown otherwise (Sheet short on phone,
     anchored Popover on tablet). [`forms.md`](../../patterns/forms.md#select-primitive)
     amended to retire the dangling "responsive pass finalizes"
     note and pin phone-tier dropdown surface bindings; World
     and Plot added to its Used-by list.
   - **D — Settings + power-user** — landed 2026-05-02
     ([exploration record](../../../explorations/2026-05-02-mobile-group-d-settings.md)).
     The three v1 surfaces — story-settings, app-settings, vault
     calendars — gain `## Mobile expression` sections and
     viewport-toggle wireframes. Settings (story-settings,
     app-settings) collapse list-first on phone per the extended
     two-pane navigation collapse rule (left rail flattens to a
     vertical scroll list of section-grouped tabs, tap → tab
     content as inner full-screen route). Vault calendars takes a
     v1 deviation: rail hidden on phone since the only active
     category is Calendars (3 placeholders deferred); switches to
     standard list-first when a second vault category ships.
     **Substantive substrate touch**: `collapse.md` reframes its
     "World" section to "Two-pane navigation surfaces (World, Plot,
     Settings)" with one shared rule; the Settings family joins
     the master-detail collapse contract. The prompt-pack editor
     surface is deferred past v1 (no desktop spec yet); tracked in
     [`parked.md → UX (post-v1) → Prompt-pack editor`](../../../parked.md#prompt-pack-editor-desktop-spec--mobile-retrofit)
     and will retrofit when the desktop spec lands.

   Cross-cutting pattern docs (`patterns/icon-actions.md`,
   `save-sessions.md`, `calendar-picker.md`, `data.md`,
   `lists.md`, `forms.md`, `entity.md`) got touched as needed
   during per-screen passes; minor edits only, not separate
   sessions.

The substrate (sessions 1–6) is feature-complete for v1; session
7's consumer pass is complete across every surface v1 ships.
The prompt-pack editor mobile retrofit will land alongside its
post-v1 desktop spec.

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
