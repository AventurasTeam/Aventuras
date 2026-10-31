# The expo-dom bridge keeps neither identity nor rejections

A `'use dom'` component looks like a normal React child, but its props
and callbacks cross a bridge. Two things a caller would assume stop being
true there, and neither fails loudly.

**Identity.** Every prop crosses as a fresh JSON copy
(`node_modules/expo/src/dom/injection.ts`), the wrapper emits on every
host render (`webview-wrapper.tsx`), and each emission hands out new
callback proxies (`marshal.tsx`, `dom-entry.tsx`). So `memo` on a row
misses on every emission on native, whatever the host stabilised, and a
`row` object fails shallow compare by itself. Stable callbacks alone fix
nothing. The memo still holds for renders inside the document, which
emit nothing.

**Rejections.** A rejected promise from a host callback re-rejects
inside the WebView, where no handler is registered, so nothing logs:
the web build's unhandled-rejection backstop doesn't exist there. A tap
that fails does nothing at all.

## How to apply

- Don't reason about memoization across the bridge from the web build.
  Anything claiming stable identity is claiming it for web.
- A host callback the document fires must settle rather than reject:
  catch it host-side, log and toast there.
  `dismissSystemEntry` in `components/reader/system-entry-actions.tsx`
  is the worked example.
- This was read from the expo source, not measured on a device. What
  the identity loss costs is
  [parked until a device shows it](../../parked.md#native-reader-rows-rerender-per-emission).
