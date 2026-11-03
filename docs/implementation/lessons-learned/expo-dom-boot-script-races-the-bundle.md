# expo-dom's boot script can run after the document's bundle on Android

A `'use dom'` document needs two globals before its bundle runs: the
host OS and the first props. expo 55's wrapper
(`node_modules/expo/src/dom/webview-wrapper.tsx`) passes them as
react-native-webview's `injectedJavaScriptBeforeContentLoaded`. On
Android, react-native-webview (13.16 and 14.0) runs that script with
`evaluateJavascript` from `onPageStarted` on the UI thread, and nothing
orders it before the page's own scripts. Its docs call the prop "not
100% reliable" on Android.

**Symptom.** The document never mounts. The renderer is alive, the
`#root` element is empty, and the host waits forever for a signal the
document never sends: on the reader, `Loading story…` stays up. The
first document of a session paints, and later ones fail often. A
release build drops the WebView's console, so nothing shows.

## Why

Unpatched, expo's document runtime reads the globals once.
`registerDOMComponent` (`dom-entry.tsx`) throws
`Top OS ($$EXPO_DOM_HOST_OS) is not defined` when the bundle finds them
missing, and `marshal.tsx` decided at module evaluation whether native
actions may post at all. The script still runs, a few milliseconds
after the bundle, in the same document. Too late: the throw has already
happened.

Measured on the Galaxy Z Fold (SM-F966B; release build, 8 back-to-back reader
opens per run): 7 of 16 opens stuck before the patch, and 8 of 16 on a
build from before Slice 5.1, so that slice didn't cause it. A probe
read over CDP showed every stuck document evaluating its bundle before
the script, which ran 0.7–3.4 ms later. Every painted one had the
script first, by as little as 58 ms. The x86_64 emulator never lost the
race (0 of 16): there the bundle ran 395–491 ms after the script
landed.

## Fix

[`patches/expo.patch`](../../../patches/expo.patch): the wrapper's
boot script fires a `$$dom_boot` event once the globals are set. The
entry waits for that event when it finds them missing, and `marshal`
reads them per call. When the script came first, the entry registers
at once. Same Fold protocol with the patch: 0 of 32 opens stuck. With
the probe, 8 of 16 opens ran the bundle first, and all 16 painted.

## How to apply

- Inside a document, don't branch on `IS_DOM` from `expo/dom`, and
  don't import modules that do, such as expo-router's routing
  (`canGoBack`, `canDismiss`). The patch leaves `IS_DOM` alone: it is
  an exported constant read at module evaluation, so it is `false`
  whenever the bundle wins. Pass a prop instead, as
  `model-card-document`'s `hostIsWebView` does. Two dev-only readers
  have the same flaw: the Metro console forwarding in
  `expo/src/async-require/setupHMR.ts`, and the Android LogBox
  overlay, which injects its own globals from `onPageStarted`.
- The patch makes only the entry wait. The rest of the boot script
  still runs after a fast bundle: the `dom.matchContents` size
  observer, which starts on `DOMContentLoaded` and can miss it, and a
  host's own `dom.injectedJavaScriptBeforeContentLoaded`. No document
  here uses either; a host that adds one needs that order handled.
- On an expo upgrade, the patch must still apply (pnpm fails the
  install if it doesn't) and the fix must still be needed. expo 56.0
  moved the globals to `injectedJavaScriptObject` and made
  `@expo/dom-webview` the default WebView, which hands the page that
  object through a JavaScript interface it can call from its first
  script (read from source, not run on a device). 57.0.15 added a
  DOM-ready signal. The patch fails to apply to 56.0's sources, so
  check the boot order on a phone before dropping it.
  `components/reader/expo-dom-boot-patch.test.tsx` replays both orders
  against the installed runtime.
- Don't judge this race on the emulator. It never lost in 16 opens
  there, with a margin of about 400 ms. Use a release build on a phone.
- To see inside a release document, set the `dom` prop's
  `webviewDebuggingEnabled` to `true` in a throwaway build. Then
  `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>`
  and evaluate over the DevTools protocol. With the patch, a boot script
  that never arrives no longer throws. It shows as an empty `#root`
  with `$$EXPO_INITIAL_PROPS` undefined.
