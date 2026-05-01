# Platform

How the contracts from sessions 1–5 honor each platform's
conventions. Different shape from prior foundations files: less
"design new rules," more "specify how to honor existing contracts
on each platform" with concrete RN library bindings.

This file is session 6 of the mobile-foundations multi-session pass
(per [`./README.md → Sessions`](./README.md#sessions)). Sister to
all other mobile-foundations files; the platform mechanism this
file pins is the implementation glue under their behavior
contracts.

## What this contract pins

- **Platform targets, explicit.** Mobile = Expo (iOS native +
  Android native). Desktop = Electron wrapping the web build via
  RN Web. **Mobile-web browsers are NOT a target.**
- **Safe-area handling** via `react-native-safe-area-context`
  with concrete rules for top-bar / bottom-edge / sheets / modals.
- **OS back integration**: Android `BackHandler` and iOS
  swipe-back gesture both bind to the existing stack-aware Return
  logic from
  [`../../principles.md → Stack-aware Return`](../../principles.md#stack-aware-return).
  Empty-stack-confirm is **Android-relevant primarily** (iOS exit
  uses the home indicator's OS default, no app-side confirm).
- **Keyboard avoidance** via RN's `KeyboardAvoidingView` with
  platform-aware `behavior` prop (`padding` on iOS, `height` /
  native `adjustResize` on Android). Save-bar hide-on-keyboard
  from [`./touch.md → Save bar on phone`](./touch.md#save-bar-on-phone)
  is implemented via `Keyboard.addListener` events.
- **Sheet drag-dismiss thresholds per platform** — adopt
  community-library defaults (iOS ~25% drag-distance OR ~600
  px/s velocity; Android ~30% / ~500 px/s).
- **Galaxy Fold mid-use reflow** — `Dimensions.change` listener
  is the binding; sheet auto-dismiss-on-tier-transition (per
  [`./collapse.md`](./collapse.md)) implementation lives here.
- **Accessibility** rules — VoiceOver / TalkBack labeling,
  focus traps, dynamic-type scaling, screen-reader announcements.
- **Status bar style** — `light-content` for dark themes,
  `dark-content` for light themes; binds to the active theme's
  `themeMode` from
  [`../theming.md`](../theming.md).

## Platform targets

- **Mobile.** Expo SDK 55 → iOS native and Android native. RN
  components, NativeWind 4 styling. Distributed via App Store,
  Play Store, sideload.
- **Desktop.** Electron 41 wraps the same Expo / RN codebase via
  RN Web. The Electron renderer loads the web build of the app.
  Distributed as Linux / macOS / Windows desktop binaries.

**Not in scope for v1:**

- **Mobile-web browsers** (Safari iOS, Chrome Android, etc.).
  The RN Web bundle is built specifically for Electron's
  renderer process; no public web URL points at it. Mobile users
  reach the app via the native iOS / Android Expo build.
- **Progressive web app / Add to Home Screen.** No web target.
- **Web push notifications.** No backend.
- **Tablet PCs running desktop browsers** (Surface, etc.) reach
  the app via the desktop Electron binary, not via a browser.

This scoping retroactively resolves any prior-session prose that
mentioned "mobile-web browsers" as a tier consideration —
canonical foundations docs going forward avoid the term.

## Safe areas

iOS and Android reserve regions of the screen for system chrome
(notch / Dynamic Island / status bar at top, home indicator /
nav bar at bottom). Apps render their chrome inside the available
safe area; content may extend edge-to-edge but interactive
elements respect the boundary.

**Library:** `react-native-safe-area-context`. Provides
`SafeAreaProvider` at the app root and `useSafeAreaInsets()` hook
returning `top` / `bottom` / `left` / `right` insets in CSS px.

**Rules:**

- **Top bar honors top safe area.** `paddingTop: insets.top` so
  content doesn't slide under the notch / status bar. Top-bar
  background extends into the safe area for visual continuity.
- **Bottom edge honors bottom safe area** when the bottom is
  interactive. Save bar (when visible), bottom-anchored sheets,
  and bottom-aligned action surfaces add `paddingBottom:
insets.bottom`.
- **Reader narrative and composer respect bottom safe area.**
  The composer's send button is interactive; sits above the home
  indicator with appropriate padding. The narrative scroll view
  extends edge-to-edge but the visible end-of-scroll has
  `paddingBottom: insets.bottom` so the last entry isn't behind
  the home indicator.
- **Modals and sheets** as overlays cover the entire viewport
  including safe areas, but their interactive content respects
  the insets. iOS page-sheets do this natively; custom RN sheets
  apply `paddingBottom: insets.bottom` on the sheet body.
- **Left / right safe areas** matter on iPhone in landscape
  (home indicator and corner curves). Phone landscape lands in
  tablet tier per
  [`./responsive.md`](./responsive.md); safe-area values still
  apply, honored via padding on the outermost surface container.

**Android gesture vs button nav:** gesture-mode reports a small
bottom safe area (~16–24 px); button-mode reports none (the
buttons are below the app's viewport entirely). Same code handles
both; just consume the inset values.

## OS back integration

[`../../principles.md → Stack-aware Return`](../../principles.md#stack-aware-return)
is the existing rule. Three triggers fire it on mobile:

- **Chrome `←` button** (top bar's left slot per the
  [top-bar amendment](../../../explorations/2026-05-01-top-bar-left-slot-scope.md)).
- **Android hardware / gesture back.** Bound via RN's
  `BackHandler.addEventListener('hardwareBackPress', handler)`.
  Handler executes stack-aware Return logic. Returns `true` to
  consume; returns `false` to allow OS default.
- **iOS swipe-from-left edge gesture.** Expo Router's navigation
  library handles this natively; the swipe pops the navigation
  stack which routes through stack-aware Return.

**Empty-stack confirm flow:**

When the navigation stack has only the root entry left:

- **Android `BackHandler`** at root → checks stack-aware Return
  → "empty stack" → fires confirm modal → if confirmed, returns
  `false` on the next back press (allowing app close).
- **iOS swipe-back at root** has no nav target. iOS's "exit the
  app" pattern is the home indicator gesture, which the OS
  handles directly (no app-side confirm, immediate close). The
  chrome `←` button is absent at the root surface (story-list)
  per the top-bar left-slot rule, so iOS doesn't have an in-app
  back trigger at the root that the empty-stack-confirm could
  intercept.

**Therefore: empty-stack-confirm is Android-relevant primarily.**
The principles.md clause was written desktop-first; on mobile,
Android honors it via `BackHandler`, iOS uses OS-native exit
semantics. This is documented explicitly here so the principles
rule doesn't mislead implementers.

## Keyboard avoidance

Session 5's save-bar contract (hide while keyboard open, reappear
on field blur) requires platform-specific keyboard handling.

**`KeyboardAvoidingView`** with platform-aware `behavior`:

- **iOS**: `behavior="padding"` — view's height shrinks by the
  keyboard's height; content reflows. Smooth animation aligned
  with iOS keyboard slide-up.
- **Android**: `behavior="height"`, OR no `KeyboardAvoidingView`
  at all if the activity uses `windowSoftInputMode="adjustResize"`
  in `AndroidManifest.xml` (Android handles natively).

**Save bar hide-on-keyboard implementation:**

The save bar's `display: none` (per
[`./touch.md → Save bar on phone`](./touch.md#save-bar-on-phone))
is triggered by keyboard events:

```js
Keyboard.addListener('keyboardDidShow', () => setSaveBarVisible(false))
Keyboard.addListener('keyboardDidHide', () => setSaveBarVisible(true))
```

`KeyboardAvoidingView` handles the layout reflow around the
visible keyboard. The save-bar-visibility state is independent of
the avoidance mechanism.

**Composer keyboard interaction (reader phone):**

- Keyboard slides up.
- Narrative scroll view shrinks; latest entry stays at top of
  visible scroll region per
  [`reader-composer.md → Scroll behavior`](../../screens/reader-composer/reader-composer.md#scroll-behavior).
- Composer textarea sits directly above the keyboard.
- Send button and mode picker remain visible above the keyboard.

Reader's autoscroll re-engagement on field blur returns the user
to the latest entry.

## Sheet drag-dismiss thresholds

Session 3's Sheet primitive supports drag-down-to-dismiss for
bottom-anchored sheets. Threshold conventions:

- **iOS**: ~25% of sheet height OR ~600 px/s downward velocity.
- **Android (Material 3)**: ~30% of sheet height OR ~500 px/s
  velocity.

**Implementation:** community libraries like `@gorhom/bottom-sheet`
ship platform-aware defaults matching these conventions.
Aventuras adopts library defaults; no custom threshold tuning at
v1.

If post-v1 user testing surfaces dismissal-feel issues, the
threshold is library-configurable without foundations rewrite.

## Galaxy Fold mid-use reflow

Per [`./responsive.md`](./responsive.md), Galaxy Fold cover
(~360 px wide) is phone tier; main (~904 px wide) is tablet tier.
Mid-use unfold reflows the layout from one tier to the other.

**RN's `Dimensions` listener:**

```js
import { Dimensions } from 'react-native'

Dimensions.addEventListener('change', ({ window }) => {
  // window.width / window.height updated
})
```

**State preservation across reflow:**

- React component state (Zustand stores, component-local state)
  survives — the React tree re-renders but doesn't unmount.
- Open phone-tier sheets dismiss when the layout transitions out
  of phone tier (per
  [`./collapse.md → State preservation on reflow`](./collapse.md#state-preservation-on-reflow)).
  Implementation: listen to dimension changes; if transitioning
  to tablet/desktop, dismiss any active phone-tier sheet.
- Component-local DOM state (focused field, scroll position,
  keyboard-open) — RN preserves these natively across re-renders.
- Keyboard state — closes on focused-field unmount; if the
  reflow doesn't unmount the focused field, keyboard stays open.

Validation at session 7 implementation: the Galaxy Fold behavior
is hardware-dependent. Session 7's per-screen retrofits include a
one-time validation pass against the user's Galaxy Fold to confirm
the sheet-dismissal-on-tier-transition fires correctly.

## Accessibility

RN supports VoiceOver (iOS) and TalkBack (Android) via
`accessibilityLabel`, `accessibilityRole`, `accessibilityState`,
`accessibilityHint` props.

**Rules:**

- **Every interactive element gets an `accessibilityLabel`.**
  Icon buttons (`⛭`, `⚲`, `←`, etc.) need explicit labels since
  their visual is a glyph not text. E.g.
  `accessibilityLabel="Story Settings"` on the `⛭` button.
- **Roles match WAI-ARIA conventions.** Buttons get
  `accessibilityRole="button"`, headings get `header`, lists get
  `list`. Custom interactions (sheet drag handle) get
  `accessibilityRole="adjustable"` with appropriate hint.
- **Sheets and modals trap focus.** VoiceOver / TalkBack focus
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
- **Truncated chrome text:** the truncated label has the full
  text as its `accessibilityLabel`, so screen-reader users hear
  the full text without needing the popover. The visible
  truncation is a sighted-user affordance; the popover is a
  recovery mechanism for sighted users who notice the ellipsis.
- **Dynamic-type scaling** — iOS Larger Text and Android Large
  Text affect the system text scale. RN respects this by default
  (`allowFontScaling=true` is the default on `<Text>`).
  [`../typography.md → Reader font-size setting`](../typography.md)
  is a separate per-app axis applied on top of system dynamic
  type.
- **Color contrast** is governed by
  [`../color.md`](../color.md); every curated theme passes WCAG
  AA contrast floors.

**Out of scope for foundations** (lands per-screen at session 7):

- Per-screen exact `accessibilityLabel` strings.
- Per-screen focus order tuning.
- Custom landmark structure for the rail / chip strip / etc.

These are implementation polish at the per-screen retrofit phase.
The foundations contract just commits _that the app is
accessible_, with rules for cross-cutting concerns.

## Status bar style

OS status bar (clock, battery, signal) sits above the app's top
bar. Its text/icon color must contrast with the app's top-bar
background.

**Mechanism:** RN's `StatusBar` component / `setBarStyle` API.
Sync with the active theme:

- **Light themes** (Parchment, Catppuccin Latte, Aventuras
  Signature light, default-light): `barStyle="dark-content"` —
  dark icons against light status-bar background.
- **Dark themes** (Catppuccin Mocha, Tokyo Night, Royal,
  Cyberpunk, Fallen Down, default-dark): `barStyle="light-content"`
  — light icons against dark status-bar background.
- **Switch on theme change.** The theme registry
  ([`../theming.md`](../theming.md)) carries
  `themeMode: 'light' | 'dark'`; status-bar style binds directly.

**Android-specific:** also set the status-bar background color
to match the top-bar's `--bg-region` token via
`StatusBar.setBackgroundColor(...)`. iOS doesn't need this (the
status bar overlays the app's chrome).

**Out-of-scope for v1:** translucent status-bar effects,
per-screen status-bar style overrides. Same style applies on
every screen for the active theme.

## What this contract does NOT pin

- **Per-screen exact accessibility labels and focus order** —
  session 7 retrofits per surface.
- **Haptic feedback** on actions — could land as polish post-v1;
  not foundational.
- **Deep links via URL scheme** — defer post-v1.
- **Splash screen / launch screen / app icon configuration** —
  Expo config, not UX-shaped.
- **Custom native modules** for any platform-specific feature —
  none anticipated in v1.
- **Mobile-web browser concerns** — not a target.
