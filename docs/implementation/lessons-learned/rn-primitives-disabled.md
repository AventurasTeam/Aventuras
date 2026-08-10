# rn-primitives `disabled` doesn't fully gate clicks on web — use inline `pointerEvents`

Wrappers around `@rn-primitives/*` + Radix on web don't fully forward
`disabled` to Radix's `onClick`. The rn-primitives Trigger forwards
`disabled` to the inner `Pressable` + Radix's `Trigger`, but Radix
attaches its `onClick` to the same DOM element via Slot's
`mergeProps`. `Pressable.disabled` only gates `Pressable`'s own
`onPress` — the Radix-side `onClick` fires regardless. Visible state
looks disabled but click still toggles.

`className="pointer-events-none"` doesn't reliably work either
(NativeWind / inline-style ordering). The foolproof gate is **inline
style at the DOM level**:

```tsx
style={
  Platform.OS === 'web' && props.disabled
    ? ({ pointerEvents: 'none' } as never)
    : undefined
}
```

This kills both `Pressable`'s `onPress` and Radix's `onClick`. Side
effect: `pointer-events: none` also prevents `:hover`, so
`cursor: not-allowed` won't display either — drop it from the
disabled className. Visual disabled cue: `opacity-50` driven directly
off the prop (Tailwind's `disabled:` variant doesn't fire when the
rendered web element is a `View` / `div` rather than a `button`).

## How to apply

Any primitive wrapping rn-primitives + Radix where the trigger is
`<View>` / `<div>` on web and `disabled` should block clicks — wire
the same inline-style gate, and drop className-based
pointer-events and `cursor-not-allowed`.

Confirmed on Tabs and Accordion during primitive review; likely the
same shape on Dialog, Popover, and any focusable / clickable
trigger.

## Not universal — check before adding the gate

The trap needs **two** conditions: a Radix `onClick` attached to the
same DOM node that `Pressable.disabled` fails to gate, **and** a
rendered child that can receive the click when the parent uses
`pointer-events: box-none`. Controls that close either half do not
need the fix, and adding it there is dead code that reads as
load-bearing.

`Checkbox` is the known exemption, verified by mutation test during
Slice 3.6a (2026-08-10): removing the inline gate changed no
behavior. RN-Web's `Pressable` with `disabled` already compiles to
`pointer-events: none !important` on the element itself, and Radix's
`CheckboxIndicator` — the only rendered child, so the only possible
click-leak path — sets `pointer-events: none` on itself
unconditionally, independent of checked or disabled state.

So: **prove the gate is doing something before adding it.** Write the
disabled-interaction test first, confirm it fails without the gate,
then add it. A gate nobody can show is load-bearing invites the next
reader to either delete it blindly or copy it everywhere.
