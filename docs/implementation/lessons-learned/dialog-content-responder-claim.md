# rn-primitives' Dialog claims the touch responder and kills scrolling

`@rn-primitives/dialog`'s **native** `Content` sets
`onStartShouldSetResponder={() => true}`, claiming the JS responder
for every touch that lands inside the dialog. The claim exists to
stop taps falling through to a close-on-press overlay. On Android it
also blocks native scroll interception, so a `ScrollView` rendered
inside any Dialog scrolls badly or not at all.

**Symptom.** Scrolling inside a dialog is _intermittent_, not dead:
a fresh touch often fails to start a scroll and needs several
flicks, but once a scroll is underway it is smooth and
controllable. That signature — flaky to _initiate_, fine once
moving — is the responder claim racing the scroll gesture at
touch-down. Each new touch re-runs the race; an in-progress scroll
already owns the gesture.

## Fix

Clear the prop on the substrate wrapper, after spreading `props` so
it wins:

```tsx
<DialogPrimitive.Content
  {...props}
  onStartShouldSetResponder={undefined}
>
```

Check what the claim is actually protecting first. In this repo it
protects nothing: `DialogOverlay` renders the primitive with
`asChild` around an `Animated.View` that has no `onPress`, so
backdrop taps were already inert (verify on-device before removing
— tap the backdrop and confirm the dialog stays open).

## What not to reach for

Swapping in `react-native-gesture-handler`'s `ScrollView` bypasses
the responder system and _does_ fix Android — it is how `Select` and
`MultiSelect` get past the identical claim in
`@rn-primitives/popover` / `@rn-primitives/select`. Inside a Dialog
it is still the wrong lever: we own that wrapper, so the claim can be
deleted where it is stamped rather than routed around. Treat the swap
as a diagnostic probe here, not a fix. See
[Library-first defaults](./library-first-defaults.md).

If you do route around it, know the web trap that follows. RNGH's
`ScrollView` looks like it "ignores max-height on web" — the content
renders unbounded and pushes the modal off the viewport — but the
cause is narrower: a NativeWind `max-h-*` className doesn't reach the
scrollable element, because RN-Web nests divs and the class lands on
a wrapper that doesn't constrain the inner scroller. An explicit
`style` bounds it fine; `components/ui/multi-select.tsx` ships that
counter-example.

## Adjacent trap: padding clips the scrollable extent

Padding on the scroll container itself makes Android clip the
scrollable extent by that padding, so the tail of the content is
unreachable and gestures near the bottom do nothing. It reads as
"scroll is stuck" and is easily mistaken for the responder problem.
Put padding on the content container:

```tsx
<ScrollView className="rounded-md border" contentContainerClassName="p-3">
```

## How to apply

When a `ScrollView` misbehaves inside any overlay primitive, ask
first whether an ancestor claims the responder, and second whether
the scroll container carries its own padding. Both present as
"scrolling is broken"; neither is a styling problem. Clearing the
claim in `components/ui/dialog.tsx` fixes every dialog in the app at
once, which is the point of owning the wrapper — but the fix stops
at Dialog. `@rn-primitives/popover` and `@rn-primitives/select` stamp
the same prop, and `Select` / `MultiSelect` still route around it
with RNGH rather than clearing it.

Related: [Portal drops custom contexts on native](./rn-primitives-portal-context.md)
for the other native-only Dialog trap.
