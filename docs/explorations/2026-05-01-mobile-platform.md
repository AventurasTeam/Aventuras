# Mobile foundations — platform (session 6)

Session 6 of the mobile-foundations design pass (per
[`../ui/foundations/mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)).
Pins **how the contracts from sessions 1–5 are implemented on the
actual platforms** the app ships to. Different shape from the
prior sessions: less "design new rules," more "specify how to
honor existing contracts on each platform." Several items land as
session-7 implementation guidance rather than locked rules.

This file is an exploration record. Once integrated, the canonical
home is [`../ui/foundations/mobile/platform.md`](../ui/foundations/mobile/platform.md).

## Decisions locked entering this session

Reached through dialogue:

- **Platform targets, explicit.** Mobile = Expo (iOS native +
  Android native). Desktop = Electron wrapping the web build via
  RN Web. **Mobile-web browsers are NOT a target.** The web build
  exists only as the source RN Web bundle that Electron loads;
  no standalone browser deployment, no PWA, no
  add-to-homescreen, no web-push.
- **Out-of-scope items confirmed.** Mobile-web browser chrome
  (URL bar collapse, address bar viewport changes) — not in
  scope. Web push notifications — no backend, no scope. Haptic
  feedback — could land as polish, not foundational. Deep links
  via URL — defer post-v1. Splash screen / app icon configuration
  — Expo config, not UX-shaped.

## Background — prior session deferrals that land here

Sessions 2–5 each deferred specific items to "session 6 (platform)":

- **Session 2 — Stack-aware Return on mobile.** OS back actions
  (Android hardware/gesture back, iOS swipe-from-left) bind to
  the same stack-aware Return logic. Session 6 specs the
  binding mechanism.
- **Session 3 — Sheet drag-dismiss thresholds.** Library /
  platform conventions vary; session 6 picks defaults.
- **Session 4 — Galaxy Fold reflow validation.** RN's
  `Dimensions` listener fires; needs implementation-time
  validation that state truly survives.
- **Session 5 — Save-bar keyboard avoidance mechanism.**
  Behavior contract pinned (save bar hides while keyboard open);
  the RN mechanism (`KeyboardAvoidingView` modes) lands here.
- **Session 5 — Accessibility specifics.** Screen-reader
  announcements, focus traps, dynamic-type scaling.
- **Session 5 — Status pill phase announcements.** Screen-reader
  notification when phase changes.

These all land in this session.

## Platform targets

Aventuras ships in two product packages:

- **Mobile.** Expo SDK 55 → iOS native and Android native.
  React Native components, NativeWind 4 styling. Distributed via
  App Store, Play Store, sideload.
- **Desktop.** Electron 41 wrapping the same Expo / RN codebase
  via RN Web. The Electron renderer loads the web build of the
  app. Distributed as Linux / macOS / Windows desktop binaries.

**Not in scope:**

- **Mobile-web browsers** (Safari iOS, Chrome Android, etc.).
  The RN Web bundle is built specifically for Electron's renderer
  process; there's no public web URL pointing at it. Mobile users
  reach the app via the native iOS / Android Expo build.
- **Progressive web app / Add to Home Screen.** No web target.
- **Web push notifications.** No backend, no notification
  infrastructure.
- **Tablet PCs running desktop browsers** (Surface, etc.) reach
  the app via the desktop Electron binary, not via a browser.

This scoping resolves any prior session prose that mentioned
"mobile-web browsers" as a tier consideration — those references
become moot. The frozen exploration records (sessions 1, 5) will
stay as historical (per
[`../explorations/README.md`](../explorations/README.md));
canonical foundations docs going forward avoid the term.

## Safe areas

iOS and Android both reserve regions of the screen for system
chrome — the notch / Dynamic Island / status bar at top, the home
indicator / nav bar at bottom. Apps render their own chrome
_inside_ the available safe area, with content that may extend
edge-to-edge but with interactive elements respecting the
boundary.

**Library:** `react-native-safe-area-context` is the standard
React Native handler. Provides `SafeAreaProvider` and
`useSafeAreaInsets()` hook returning `top` / `bottom` / `left` /
`right` insets in CSS px.

**Rules:**

- **Top bar honors top safe area.** Render the top bar with
  `paddingTop: insets.top` so its content doesn't slide under the
  notch / status bar. Background color extends into the safe area
  for visual continuity.
- **Bottom edge honors bottom safe area** when the bottom is
  interactive. Save bar (when visible), bottom-anchored sheets,
  and any bottom-aligned action surfaces add `paddingBottom:
insets.bottom` (or equivalent) so the home indicator doesn't
  occlude tappable elements.
- **Reader narrative and composer respect bottom safe area.**
  The composer's send button is interactive; it sits above the
  home indicator with appropriate padding. The narrative scroll
  view's content area extends edge-to-edge but the _visible_
  end-of-scroll has bottom padding equal to `insets.bottom` so
  the last entry isn't behind the home indicator.
- **Modals and sheets** rendered as overlays cover the entire
  viewport including safe areas, but their _interactive content_
  respects the insets. iOS page-sheets do this natively at the
  OS level for native UIKit; for custom RN sheets, apply
  `paddingBottom: insets.bottom` on the sheet body.
- **Left / right safe areas** — relevant on iPhone in landscape
  (the home indicator and corner curves). Phone landscape lands
  in tablet tier per session 1's responsive contract; the
  safe-area values still apply. Honor them via padding on the
  outermost surface container.

**Visualization on Android with gesture nav vs button nav.**
Gesture-mode Android phones report a small bottom safe area
(~16-24 px); button-mode reports none (the buttons are below the
app's viewport entirely). Same code handles both; just consume the
inset values.

## OS back integration

Stack-aware Return (per
[`../ui/principles.md → Stack-aware Return`](../ui/principles.md#stack-aware-return))
is the existing rule. On mobile, three triggers fire it:

- **Chrome `←` button** (in the top bar's left slot per the
  amendment).
- **Android hardware / gesture back.** Bound via RN's
  `BackHandler.addEventListener('hardwareBackPress', handler)`.
  The handler executes the same stack-aware Return logic. Returns
  `true` to consume (prevent default Android behavior of
  closing the activity); returns `false` to allow native default
  (which would close the app — fires only when the empty-stack
  confirm dialog hasn't already handled it).
- **iOS swipe-from-left edge gesture.** RN's navigation library
  (Expo Router 6 in this project) handles the swipe-back gesture
  by default; the swipe pops the navigation stack which routes
  through stack-aware Return.

**Empty-stack confirm flow on mobile:**

When the navigation stack has only the root entry left:

- Android `BackHandler` fires → handler checks stack-aware Return
  → "empty stack" → fires confirm modal → if confirmed, returns
  `false` (allows app close) on the next back press.
- iOS swipe-back at root has no nav target → falls through to OS
  default (which is a no-op at the root of a navigation stack).
  The chrome `←` button is absent at the root surface (story-list)
  per the top-bar left-slot rule, so the only way to trigger
  empty-stack-confirm on iOS is the system back gesture sliding
  from the home indicator (which closes the app immediately at
  the root). On iOS, "exit the app" doesn't have an explicit
  back action like Android; the OS handles it via the home
  indicator. The empty-stack-confirm rule is **Android-relevant
  primarily**; iOS's native exit pattern doesn't have a confirm
  step the way Android's hardware back does.

This is a real platform difference that the principles.md
empty-stack-confirm clause (written desktop-first) didn't
explicitly address. **Resolution for v1:** Android's hardware
back at root triggers confirm; iOS's home-indicator gesture
closes the app per OS default (no app-side confirm). Document
this in `platform.md` as "Android-specific behavior."

## Keyboard avoidance

Session 5's save-bar contract requires the bar to hide when the
soft keyboard is open. The RN mechanism:

**`KeyboardAvoidingView`** with platform-aware behavior:

- **iOS**: `behavior="padding"` — the view's height shrinks by
  the keyboard's height; content reflows accordingly. Smooth
  animation aligned with iOS keyboard slide-up.
- **Android**: `behavior="height"` (or no `KeyboardAvoidingView`
  at all if the activity uses `windowSoftInputMode="adjustResize"`,
  which Android handles natively).

**Save bar hide-on-keyboard implementation:**

The save bar's `display: none` (per session 5's contract) is
triggered by a keyboard-event listener (`Keyboard.addListener('keyboardDidShow', ...)`
and `keyboardDidHide`). On show: set save-bar visibility to
hidden. On hide: set save-bar visibility to shown. The
`KeyboardAvoidingView` handles the layout reflow around the
actual visible keyboard.

Same on iOS and Android in code; the platform difference is in
how `KeyboardAvoidingView` calculates the avoidance amount.

**Composer keyboard interaction (reader phone):**

The reader's composer textarea is the most-used keyboard surface.
When focused:

- Keyboard slides up (~290 px).
- Narrative scroll view shrinks; the latest entry stays at the
  top of the visible scroll region (per
  [`reader-composer.md → Scroll behavior`](../ui/screens/reader-composer/reader-composer.md#scroll-behavior)
  autoscroll rules).
- Composer textarea sits directly above the keyboard.
- Send button and mode picker remain visible above the keyboard
  (composer chrome respects the keyboard avoidance).

The reader's autoscroll re-engagement on field blur (keyboard
dismiss) returns the user to the latest entry.

## Sheet drag-dismiss thresholds per platform

Session 3's Sheet primitive supports drag-down to dismiss
(bottom-anchored sheets). The exact threshold (how far the user
drags before release dismisses vs snaps back) varies by platform
convention:

- **iOS**: ~25% of the sheet's height OR ~600 px/s downward
  velocity. Whichever fires first dismisses.
- **Android (Material 3)**: ~30% of the sheet's height OR
  ~500 px/s velocity.

**Implementation:** sheet libraries like `@gorhom/bottom-sheet`
(community-standard for RN) ship with platform-aware defaults
that match these conventions. Aventuras adopts the library's
defaults; no custom threshold tuning at v1.

If post-v1 user testing surfaces dismissal feel issues, the
threshold is library-configurable without foundations rewrite.

## Galaxy Fold mid-use reflow

Per session 1's responsive contract, the Galaxy Fold cover
(~360 px wide) is phone tier; main (~904 px wide) is tablet tier.
Mid-use unfold reflows the layout from one tier to the other.

**RN's `Dimensions` listener** fires on screen-dimension changes:

```js
import { Dimensions } from 'react-native'

Dimensions.addEventListener('change', ({ window }) => {
  // window.width / window.height updated
})
```

**State preservation across reflow:**

- React component state (Zustand stores, component-local state)
  survives — the React tree re-renders but doesn't unmount.
- Open sheets / modals on phone-tier dismiss when the layout
  transitions out of phone tier (per session 4's collapse rule);
  this is implementation guidance, not an automatic RN behavior.
  Implementation: listen to dimension changes and dismiss any
  active phone-tier sheet when transitioning to tablet/desktop.
- Component-local DOM state (focused field, scroll position,
  keyboard-open) — RN preserves these natively across re-renders.
- Keyboard state — closes on any focused-field unmount; if the
  reflow doesn't unmount the focused field, keyboard stays open.

**Validation at session 7 implementation:** the Galaxy Fold
behavior is hardware-dependent. Session 7's per-screen retrofits
include a one-time validation pass against the user's Galaxy Fold
to confirm the sheet-dismissal-on-tier-transition implementation
fires correctly.

## Accessibility

RN supports VoiceOver (iOS) and TalkBack (Android) via the
`accessibilityLabel`, `accessibilityRole`, `accessibilityState`,
`accessibilityHint` props. Aventuras uses these consistently.

**Rules:**

- **Every interactive element gets an `accessibilityLabel`.**
  Icon buttons (`⛭`, `⚲`, `←`, etc.) need explicit labels since
  their visual is a glyph not text. E.g. `accessibilityLabel="Story
Settings"` on the `⛭` button.
- **Roles match WAI-ARIA conventions.** Buttons get
  `accessibilityRole="button"`, headings get `header`, lists get
  `list`, etc. Custom interactions (sheet drag handle) get
  `accessibilityRole="adjustable"` with appropriate hint.
- **Sheets and modals trap focus** — VoiceOver / TalkBack focus
  cycles within the open sheet / modal until dismissed. RN's
  `accessibilityViewIsModal` prop handles this on iOS.
- **Status pill phase changes announce** via
  `accessibilityLiveRegion="polite"` (Android) /
  `AccessibilityInfo.announceForAccessibility(...)` (iOS).
  Phase transitions ("reasoning…" → "generating narrative…")
  fire announcements; idle state silences the live region.
- **Popover and Sheet open / close announce** — popover open
  fires "Story Settings menu, opened" or similar; sheet open
  fires "Browse rail, opened, 5 categories." Same on phone and
  tablet.
- **Truncated chrome text and the tap-to-tooltip rule.** The
  truncated label has the full text as its `accessibilityLabel`,
  so screen-reader users hear the full text without needing the
  popover. The visible truncation is a sighted-user affordance;
  the popover is a recovery mechanism for sighted users who
  notice the ellipsis.
- **Dynamic-type scaling** — iOS Larger Text and Android
  Large Text settings affect the system text scale. RN respects
  this by default (`allowFontScaling=true` is the default on
  `<Text>` components). Reader prose font size already has its
  own user setting per
  [`foundations/typography.md → Reader font-size setting`](../ui/foundations/typography.md);
  that's separate from system dynamic type and applies on top.
- **Color contrast** is governed by
  [`foundations/color.md`](../ui/foundations/color.md) — every
  curated theme passes the WCAG AA contrast floors.

**Out of scope for foundations** (lands per-screen at session 7):

- Per-screen exact `accessibilityLabel` strings.
- Per-screen focus order tuning.
- Custom landmark structure for the rail / chip-strip / etc.

These are implementation polish at the per-screen retrofit phase.
The foundations contract just commits _that the app is
accessible_, with rules for the cross-cutting concerns.

## Status bar style

The OS status bar (clock, battery, signal indicators) sits above
the app's top bar. Its text/icon color must contrast with the
app's top-bar background.

**Mechanism:** RN's `StatusBar` component / `setBarStyle` API.
Sync with the active theme:

- **Light themes** (Parchment, Catppuccin Latte, Aventuras
  Signature light, default-light): `barStyle="dark-content"` —
  dark icons against light status-bar background.
- **Dark themes** (Catppuccin Mocha, Tokyo Night, Royal,
  Cyberpunk, Fallen Down, default-dark): `barStyle="light-content"`
  — light icons against dark status-bar background.
- **Switch happens on theme change.** The theme registry already
  carries `themeMode: 'light' | 'dark'`; the status-bar style
  binds to this directly.

**Android-specific:** also set the status-bar background color
to match the top-bar's `--bg-region` token via
`StatusBar.setBackgroundColor(...)`. iOS doesn't need this (the
status bar overlays the app's chrome).

**Out-of-scope for v1:** translucent status-bar effects,
per-screen status-bar style overrides. Same style applies on
every screen for the active theme.

## Adversarial pass

### Load-bearing assumption

The big assumption: **the platform contracts in this session are
implementable as specified using the listed RN libraries
(`react-native-safe-area-context`, `BackHandler`,
`KeyboardAvoidingView`, `@gorhom/bottom-sheet`)**.

These are all community-standard libraries; documented behaviors;
used by thousands of RN apps. Confidence: high. Validation
happens at session 7 implementation; if any library fails to
deliver as documented, the alternative is fork-and-extend or pick
a different library — both library-level concerns, not foundations
rewrites.

### Edge cases

- **iOS Dynamic Island vs notch.** Both report the same `top`
  inset value via `react-native-safe-area-context`. Same code
  handles both.
- **Android gesture-nav with no bottom safe area** (some Samsung
  configurations show 0 px). Save bar honors the inset; with 0
  px inset, save bar sits flush at the bottom edge. Acceptable.
- **iOS swipe-back during keyboard-open.** Standard iOS behavior
  dismisses keyboard first, then completes navigation. Already
  handled by RN's nav library.
- **Galaxy Fold reflow with sheet open.** Sheet dismisses on
  tier transition (session 4's rule). Implementation: listen
  for dimension change, check current tier, dismiss any
  phone-tier sheet if transitioning out.
- **Theme change while app is in foreground.** Status-bar style
  updates immediately via the registry binding. Brief flash
  acceptable; matches iOS / Android native behavior on system
  theme switches.
- **Accessibility announcements during in-flight pipeline.** The
  status pill's live region fires on phase transitions; if the
  user navigates between in-story sub-screens during a pipeline,
  the announcement repeats per surface (since the pill renders
  on every in-story surface). Could be noisy. Mitigation:
  `aria-live` consolidation by the live-region container at the
  app root. Implementation detail; session 7 validates.
- **Dynamic-type at extreme scales** — iOS goes up to 310% via
  Accessibility settings. Top-bar chrome at 310% would overflow.
  Mitigation: `allowFontScaling` defaults are sufficient for
  reader prose; chrome elements may opt out of scaling for fixed
  hit-target sizes (`allowFontScaling=false` on icon buttons).
  Session 7 implementation tunes per element.

### Read-site impact / doc-integration cascades

- `principles.md → Stack-aware Return` already covers
  empty-stack-confirm; this session adds the "Android-relevant
  primarily" note for mobile. Could be added inline in
  principles.md as a clarification, but keeping the note in
  `mobile/platform.md` (where the platform-specific binding
  lives) is cleaner. principles.md remains tier-agnostic.
- `mobile/touch.md` references "session 6 (platform)" for
  keyboard mechanism, sheet drag thresholds, accessibility
  specifics. This session resolves all those references; the
  text in `touch.md` doesn't need editing (the references still
  point at the right place).
- Prior exploration records mentioning "mobile-web browsers"
  (sessions 1, 5) stay as frozen historical per the explorations
  convention. The mobile-web scoping in this session
  retroactively clarifies them.
- The `mobile/README.md` Sessions list session 6 entry currently
  mentions "mobile-web browser chrome (URL bar collapse)" —
  needs update to remove this reference when marking session 6
  landed.

### Missing perspective

- **Sync / backup format.** Platform contracts are UI-side; no
  schema impact. ✓
- **Translation pipeline.** Platform contracts don't carry
  user-translatable content beyond the accessibility labels (which
  are translation-aware). ✓
- **Implementation cost.** Standard RN libraries; no custom
  native code. ✓
- **Performance.** Safe-area / keyboard / dimension listeners
  fire infrequently; no performance concern.
- **Old-app evidence on accessibility.** Not surveyed; mobile-only
  users may have included VoiceOver / TalkBack users. Not
  pinned in this session beyond the standard rules; if old-app
  had specific accessibility patterns, they'd need to be
  surfaced in session 7.

### Verified vs assumed

- **Verified.** Library behaviors against their official
  documentation. Stack-aware Return rule (already pinned).
  Safe-area inset semantics across iOS / Android.
- **Assumed.** Galaxy Fold reflow fires `Dimensions.change`
  reliably (industry-standard, validate at session 7). Theme
  registry binding to status-bar style is straightforward
  (it is — a single `useEffect` watching the active theme).

## Followups generated

- **Sheet auto-dismiss on tier transition implementation
  pattern.** Bundles into session 7's first per-screen retrofit
  that uses a sheet on phone. Not a freestanding followup.
- **Galaxy Fold validation pass at session 7.** Same.
- **Accessibility per-screen polish** (focus order, custom
  landmarks). Bundles into session 7's per-screen retrofits.
- **Haptic feedback on actions.** Post-v1 polish; not pre-v1
  followup. Could be added if user testing surfaces signal.

No new entries in `followups.md` or `parked.md`.

## Integration plan

Files in the integration commit:

- **NEW** `docs/ui/foundations/mobile/platform.md` — canonical
  platform contract: targets, safe areas, OS back integration,
  keyboard avoidance mechanism, sheet drag thresholds, Galaxy
  Fold reflow, accessibility, status bar style. Out-of-scope
  items declared.
- **NEW** `docs/ui/foundations/mobile/platform.html` —
  interactive demo: phone outline showing safe area regions
  (notch / status / home indicator), theme-toggle showing status
  bar style switch.
- **NEW** `docs/explorations/2026-05-01-mobile-platform.md` —
  this session record.
- **EDIT** `docs/ui/foundations/mobile/README.md` — Files list
  adds `platform.md` and `platform.html`. Sessions list session
  6 status changes from "pending" to "landed 2026-05-01" with
  exploration link plus substantive summary. **Updates the
  session 6 description** to remove the "mobile-web browser
  chrome (URL bar collapse)" mention since that's now declared
  out of scope.

Renames / heading changes: none.

Patterns adopted on a new surface: none. The new files cite
`principles.md` (stack-aware Return), `responsive.md` (tier
vocab), `navigation.md` (chrome layers, status pill),
`layout.md` (Sheet primitive), `collapse.md` (sheet dismissal
on reflow), `touch.md` (save bar hide-on-keyboard, accessibility
hints, gesture vocabulary), `foundations/typography.md` (reader
font-size scaling), `foundations/color.md` (theme contrast),
`reader-composer.md` (scroll behavior, autoscroll). All content
references; no Used-by updates.

Followups resolved: none in `followups.md`.

Followups introduced: none. Galaxy Fold validation, sheet
auto-dismiss-on-reflow implementation, accessibility per-screen
polish all bundle with session 7's per-screen retrofits.

Wireframes updated: one new (`platform.html`); no existing
wireframes touched.

Pre-foundations content stance: existing per-screen docs not
modified. Their references to "session 6" or to platform
specifics resolve via this session's pinning; no per-screen
prose edits needed (those happen at session 7 retrofit time).

Intentional repeated prose: platform-target list and
out-of-scope items appear in both the exploration record and
`mobile/platform.md`. Standard exploration-record duplication.

## Self-review

- **Placeholders.** None.
- **Internal consistency.** All references to other foundations
  files resolve. Library names match their canonical npm
  package names. Tier boundaries match session 1.
- **Scope.** Single integration; platform contract only. No
  per-screen retrofit creep — each implementation-detail item
  notes which session-7 retrofit does the validation.
- **Ambiguity.** Empty-stack-confirm clarified as
  Android-relevant. iOS-vs-Android keyboard avoidance modes
  spelled out per platform. Safe-area rules concretely list
  what padding goes where.
- **Doc rules.** Anchor links resolve. No `+` separators in
  prose per the saved feedback memory.
