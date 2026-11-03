# Time a WebView from inside it

A timing taken on the host of an expo-dom surface measures the host. On
Android the host never waits for the WebView, and the two obvious ways
of getting a number out of the document fail in a release build, which
is the build worth measuring.

**The host doesn't wait.** Each prop emission is a fire-and-forget
`injectJavaScript` in an effect
(`node_modules/expo/src/dom/webview-wrapper.tsx`). The call returns
before the document has parsed the message, let alone painted it. With a
fixed-rate mock, a stream timed on the host reads the mock's rate, and
passes on a frozen screen.

**The clocks don't compare.** `performance.now()` counts from each
context's own origin, so a mark in the document can't be subtracted from
one on the host. `Date.now()` on both sides can.

**The console doesn't arrive.** Outside a debug build,
`RNCWebChromeClient.onConsoleMessage` swallows every message
(`node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebChromeClient.java`),
so a `console.log` in the document shows in logcat from a debug build
and vanishes from a release one, with nothing to say it did.

## How to apply

- Stamp inside the document, after the paint: a double
  `requestAnimationFrame` after the commit, with `Date.now()` for any
  number that crosses to the host.
- Buffer marks in a module array and flush them in one call per
  run, through a temporary async function prop, after a reply's final
  paint or after a landing, so the flush adds no load during the
  stream. The host logs what it receives, in pieces of 3,000
  characters since Android cuts a long line, and that reached logcat
  as `ReactNativeJS` on the measured device.
- Stamp an operation's end on the frame its result can show, not when
  the document receives the call. A landing is the example: a reader
  mounted under another screen has no layout, so the call can come long
  before anything can land.
- Send one probe mark through that route before a long run.
- A host-side time is fine for what the host owns, such as serialising
  the props or the moment of a press. It just can't say when the
  document caught up.
- What the bridge re-sends per emission, which is why a grown window
  stalls a stream, is in
  [the bridge lesson](./expo-dom-bridge-identity-and-rejections.md).
- The route that worked, end to end, is in
  [`dev-environment.md → Measuring on a release build`](../../dev-environment.md#measuring-on-a-release-build).
