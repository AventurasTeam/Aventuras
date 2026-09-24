# A `group` or pseudo-class on a native `View` turns it into a `Pressable`

On native, NativeWind 4 (`react-native-css-interop`) swaps a plain
`View` for a `Pressable` when its className needs interaction state.
The swap is silent. The new `Pressable` wires a no-op `onPress`, so it
becomes the deepest touch responder under the finger and swallows the
tap that the enclosing row's `Pressable` was meant to receive.

**Symptom.** On Android, pressing a non-interactive child of a
pressable row does nothing, while pressing anywhere else on the row
opens it. uiautomator reports the child `clickable="true"` even though
the component renders a plain `View`. Web is unaffected: there the
class is ordinary CSS.

## Mechanism

Read in `node_modules/react-native-css-interop/dist`:

- NativeWind registers `grouping: ["^group(/.*)?"]`. A selector such as
  `.group:hover .group-hover\:text-fg-primary` gives the `group` class a
  `container` declaration (`css-to-rn/normalize-selectors.js`,
  `css-to-rn/index.js`). Tailwind scans source text, so a
  `group-hover:` class that only ever renders inside
  `Platform.select({ web })` still emits the rule for native.
- A rule set with `container`, or with `active:` / `hover:` / `focus:`
  variants, creates interaction observables
  (`runtime/native/native-interop.js`). When the host is `View`, that
  marks it for upgrade and adds handlers, `onPress` among them.
- `runtime/native/render-component.js` then renders `Pressable` in
  place of `View`. The "Converting View to Pressable" warning only
  prints when the upgrade happens after the first render, so a class
  that is present from mount never warns.

The `clickable` flag follows from the swap. `Pressable` passes
`focusable`, and Android's `setFocusable` installs a click listener.

## Fix

Only put `group`, `group/<name>`, or an `active:` / `hover:` / `focus:`
class on a host that is already a `Pressable`, or that is meant to be
one. Primitives with a static fallback gate the class on the same
condition that picks the host:

```tsx
const baseClass = cn(
  interactive && 'group',
  'flex-row items-center …',
  interactive && 'active:bg-tint-press',
)

if (!interactive) return <View className={baseClass}>{inner}</View>
```

`Tag` and `Chip` (`components/ui/`) carried an unconditional `group`
until 2026-09-23. That made every static status, category or
when-marker tag inside a `ListRow` a dead zone for taps on Android. A
play on each primitive's static story asserts that the host carries no
`group` class.
