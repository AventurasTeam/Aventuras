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

Gate the `exiting` prop on the component's own state instead of trying
to suppress it from above. A collapse re-renders with the flag flipped
before unmounting, so it still animates; a wholesale teardown keeps the
old flag and exits instantly:

```tsx
const { isExpanded } = AccordionPrimitive.useItemContext()
// …
<Animated.View
  exiting={isExpanded ? undefined : Platform.select({ native: FadeOutUp.duration(200) })}
>
```

## How to apply

- Before designing a fix for an unwanted animation, **delete the
  animation prop and re-run**. That mutation is what pinned this one;
  reasoning from the docs sent two rounds in the wrong direction.
- A ~200 ms artifact is invisible to screenshots. Capture it:
  `adb shell screenrecord`, then `ffmpeg -vf fps=60` and
  `magick montage` the frames. Budget for `screenrecord`'s startup lag
  — it varies by several seconds, so tap well after it begins.
- Any list that swaps its whole dataset under a shared `Accordion`
  hits this. World is exposed on a Characters ↔ Lore swap, because
  `loreListModule.grouping` is `null` and the Accordion unmounts
  entirely (inferred from the code, not reproduced on device).
