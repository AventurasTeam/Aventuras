# `BackHandler` is not inert on web — subscribing logs a console error

React Native's `BackHandler` looks safely cross-platform: on web nothing ever
dispatches `hardwareBackPress`, so a handler registered there simply never
fires. That reasoning is right about the **handler** and wrong about the
**subscription**. `react-native-web`'s shim is not a no-op:

```js
// react-native-web/dist/exports/BackHandler/index.js
addEventListener() {
  console.error('BackHandler is not supported on web and should not be used.');
  return { remove: emptyFunction };
}
```

Every `addEventListener` call emits a `console.error` — once per subscribe. In
a hook driven by `useFocusEffect`, that is once per route focus, for the whole
life of the app.

**Why it bites.** The noise lands on the platform least likely to be tested for
it: desktop, where the app runs under Electron and the message reads like an
app-level failure rather than a shim notice. It also bypasses the repo's
logging discipline entirely — the call is inside `node_modules`, so `no-console`
cannot see it and nothing routes it to `diagnosticsStore`. Worse, the natural
mitigation is to write a comment claiming the shim is a harmless no-op, which
is exactly the assertion that stops the next reader from adding the guard.

**What it cost.** `useMasterDetailBack` subscribed unconditionally and carried a
docblock stating that Expo's web build "shims `BackHandler` to a no-op". The
claim survived a review pass and was only caught by reading the shim source.
`app/wizard.tsx` had guarded correctly since it was written, so the repo
already contained both the bug and its fix.

## How to apply

- Gate the **subscribe**, not the handler:
  `if (Platform.OS !== 'android') return undefined` before
  `BackHandler.addEventListener`.
- Treat "this library no-ops off-platform" as a claim to verify in the shim
  source, not an inference from the absence of an event. Shims warn.
- When a comment asserts that something is harmless, that assertion is the part
  that needs evidence — it is what future readers will rely on instead of
  re-checking.
