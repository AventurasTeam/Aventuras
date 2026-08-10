# `className` on a Reanimated `Animated.*` is silently dropped

NativeWind never styles `Animated.View` / `Animated.Text` / any other
`createAnimatedComponent` output. The class string is accepted, typechecks,
lints, and does nothing. Put the `className` on a plain RN `View` nested
inside the animated element instead.

```tsx
// Dead — pb-row-y-lg and gap-4 never apply.
<Animated.View exiting={FadeOutUp} className="gap-4 pb-row-y-lg">
  {children}
</Animated.View>

// Works — animation on the outer element, styling on an interop'd one.
<Animated.View exiting={FadeOutUp}>
  <View className="gap-4 pb-row-y-lg">{children}</View>
</Animated.View>
```

## Why

Two independent allowlists have to agree, and neither mentions Reanimated.

1. **NativeWind's JSX wrapper only swaps registered types.**
   `react-native-css-interop`'s `wrapJSX` does
   `type = interopComponents.get(type) ?? type`. The map is populated by
   `runtime/components.js`, which calls `cssInterop` on RN core components
   (`View`, `Text`, `Pressable`, `ScrollView`, `TextInput`, …) plus
   `SafeAreaView` — and nothing else. `Animated.View` is a distinct component
   object produced by `createAnimatedComponent(View)`, so the lookup misses
   and `className` stays a raw prop.
2. **react-native-web drops unknown props.** RNW's `View` runs
   `pick(props, forwardPropsList)`, whose style slot is exactly
   `{ style: true }`. `className` is not in any of the forwarded groups, so
   it never reaches the DOM.

The result is a silent no-op on both platforms — no warning, no type error.
`cn()` composes the string correctly; it simply lands nowhere.

Reanimated itself does no `className` handling, so passing it through to the
inner `View` isn't an option either.

## How to apply

- Never put a `className` on `Animated.*`. Wrap the content in a `View`.
- **This applies to a `className` prop a component forwards, too.** A
  component that accepts `className` and spreads it onto an `Animated.View`
  publishes a prop that does nothing — the failure surfaces one layer away,
  in a caller that passes `gap-4` and sees no gap.
- On native the same trap reaches through `asChild`: an rn-primitives
  `Slot` merges the primitive's `className` onto whatever child it wraps via
  `cloneElement`, which bypasses `wrapJSX` entirely. A primitive rendering
  `asChild` into an `Animated.View` loses its classes on native while
  working on web, where `asChild` is false and the primitive renders a real
  `View`. `components/ui/accordion.tsx`'s `AccordionItem` has this shape.
- Registering `cssInterop(Animated.View, { className: 'style' })` is the
  library-sanctioned alternative, per
  [library-first defaults](./library-first-defaults.md). It was not taken
  here: it is global surface that changes how Reanimated receives `style` on
  both platforms, for a case a nested `View` solves locally.

## Verifying

The standard Storybook harness cannot see this: `wrapJSX` skips
`require('./components')` when `NODE_ENV === 'test'`, so the vitest browser
run registers no interop at all and every element renders unstyled — a
computed-style assertion reports `normal` for working and broken markup
alike. To measure, register the interop by hand in the story
(`cssInterop(View, { className: 'style' })`) and read `getComputedStyle`.
Doing that side-by-side is what established the asymmetry:

```
plainRowGap=16px  | plainClass=css-view-g5y9jx gap-4
animatedRowGap=normal | animatedClass=css-view-g5y9jx
```

Related: [the `unit` project cannot render RN-Web chrome](./unit-project-no-rn-web-chrome.md)
— between the two, a NativeWind layout regression has no automated net.
