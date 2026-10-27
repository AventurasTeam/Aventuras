# `expo-clipboard`'s web write reports success it never checked

`setStringAsync` from `expo-clipboard` looks like the cross-platform
clipboard write: native writes the system clipboard, web writes
`navigator.clipboard`. On web it catches **any** failure of
`navigator.clipboard.writeText`, a missing API included, and falls
back to the deprecated `setString`:

```js
// expo-clipboard/build/web/ClipboardModule.js (55.0.13)
setString(text) {
  // …a hidden <textarea>, selected…
  try {
    document.execCommand('copy')
    return true
  } catch {
    return false
  }
}
```

`execCommand` reports a refused copy by returning `false`, not by
throwing, and the fallback discards that return value. A write the
browser refused, for example in a document without focus or with the
clipboard permission denied, still resolves `true`.

**Why it bites.** The promise's boolean reads like the write's outcome,
so a caller that confirms with it ("Copied.") tells the user a copy
happened when nothing reached the clipboard. On native, the `true` is
just as uninformative: iOS and Android always resolve `true` and report
a failure only by throwing.

## How to apply

- On web, call `navigator.clipboard.writeText` directly and treat a
  missing API or a rejection as the failure. Keep `setStringAsync` for
  native, where a failure is a throw.
- A copy that gives feedback must catch the throw on every platform;
  the resolved boolean alone proves nothing on either.
- `components/reader/copy-system-text.ts` is the worked example: one
  writer per platform, a single catch, and an error toast for both
  failure shapes.
