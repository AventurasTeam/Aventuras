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

expo's document runtime reads the globals once. `registerDOMComponent`
(`dom-entry.tsx`) throws `Top OS ($$EXPO_DOM_HOST_OS) is not defined`
when the bundle finds them missing, and `marshal.tsx` decided at module
evaluation whether native actions may post at all. The script still
runs, a millisecond or so after the bundle, in the same document. Too
late: the throw has already happened.

Measured on the Galaxy Z Fold (SM-F966B; release build, 8 back-to-back reader
opens per run): 7 of 16 opens stuck on `main`, and 8 of 16 before
Slice 5.1. A probe read over CDP showed every stuck document evaluating
its bundle before the script, which ran 0.7–3.4 ms later. Every
painted one had the script first, by as little as 58 ms. The x86_64
emulator never lost the race (0 of 16): its software CPU evaluates the
bundle 395–491 ms after the script lands.

## Fix

[`patches/expo.patch`](../../../patches/expo.patch): the wrapper's
boot script fires a `$$dom_boot` event once the globals are set. The
entry waits for that event when it finds them missing, and `marshal`
reads them per call. When the script came first, the entry registers
at once. Same Fold protocol with the patch: 0 of 32 opens stuck. With
the probe, 8 of 16 opens ran the bundle first, and all 16 painted.

## How to apply

- Inside a document, don't branch on `IS_DOM` from `expo/dom`. The
  patch leaves it alone: it is an exported constant read at module
  evaluation, so it is `false` whenever the bundle wins. Pass a prop
  instead, as `model-card-document`'s `hostIsWebView` does. Two
  dev-only readers have the same flaw: the Metro console forwarding in
  `expo/src/async-require/setupHMR.ts`, and the Android LogBox
  overlay, which injects its own globals from `onPageStarted`.
- On an expo upgrade, the patch must still apply (pnpm fails the
  install if it doesn't) and the fix must still be needed. expo 58.0
  moved the globals to `injectedJavaScriptObject` and added a
  DOM-ready signal. react-native-webview 14.0.1 delivers that object
  with the same `onPageStarted` `evaluateJavascript`, so check the
  order before dropping the patch.
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
