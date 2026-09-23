# `LayoutAnimationConfig skipExiting` doesn't reach the Accordion

Reanimated's
[`LayoutAnimationConfig`](https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/layout-animation-config)
documents `skipExiting` as "skip children's exiting animations when
the component is unmounted." In `components/ui/accordion.tsx` it does
not: an `Animated.View exiting={…}` inside `AccordionPrimitive.Root`
still runs its exit animation when an ancestor `LayoutAnimationConfig`
unmounts around it.

**Symptom.** Swapping the Plot panel's kind segment left the outgoing
kind's rows painted over the incoming list for ~230 ms, drifting up and
fading — two lists' text overlapping mid-row. Plot's group keys differ
per kind (thread tiers vs chapter buckets), so every `AccordionItem`
unmounts on a swap and `AccordionContent`'s `FadeOutUp` fires for the
whole list at once, not for one collapsing group.

**Verified twice on device, both ineffective:** a keyed
`<LayoutAnimationConfig skipExiting>` wrapped around `ModuleList`'s
scroll content, and `skipExiting` added to the Accordion's own
`LayoutAnimationConfig skipEntering`. The ghost was unchanged by both.
The likely cause is the `asChild` primitive root breaking the config's
reach, but that was not confirmed.

## Fix

The prop is deleted. The collapse fade it existed for never showed on
native, so the list-swap ghost was the only thing it ever painted:

- `AccordionItem`'s inner `View` carries `native:overflow-hidden` and
  snaps to header height when a group collapses, clipping the fading
  rows at once. A list swap removes that `View` along with the rows,
  at full size, so nothing clips the ghost.
- Gating `exiting` on `isExpanded` looks like a fix but is the same as
  deleting it. `@rn-primitives/accordion`'s native `Content` returns
  `null` in the render where `isExpanded` flips, and Reanimated
  registers `exiting` only on mount and update, so the flipped value
  never commits.

Both points come from the library source, not a device recording. The
collapse looked the same on device with the gate in place.

## How to apply

- Before designing a fix for an unwanted animation, **delete the
  animation prop and re-run**. That mutation is what pinned this one;
  reasoning from the docs sent two rounds in the wrong direction.
- Before gating a Reanimated `exiting` prop on state, check the
  component still renders when that state flips. A parent that
  returns `null` in the same render means the new value never
  registers.
- A layout transition animates only the frame of the view that
  carries it, and children lay out at their final size. Clip on that
  view, which `AccordionItem` now does, or expanding content paints
  over the next item.
- A ~200 ms artifact is invisible to screenshots. Capture it:
  `adb shell screenrecord`, then `ffmpeg -vf fps=60` and
  `magick montage` the frames. Budget for `screenrecord`'s startup lag
  — it varies by several seconds, so tap well after it begins.
