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

`Checkbox` is the known exemption, verified during Slice 3.6a
(2026-08-10) by mutation test and a direct DOM hit-test: removing the
inline gate changed no behavior.

The mechanism is worth stating precisely, because the obvious reading
is wrong. RN-Web's `Pressable` with `disabled` applies
`pointerEvents: 'box-none'`, which its compiler emits as
`pointer-events: none !important` on the element **plus a
`selector > * { pointer-events: auto }` rule that re-enables direct
children**. So the root being `none` is not on its own sufficient — a
click landing on a re-enabled child still bubbles to the root, where
Radix's checkbox `onClick` fires unconditionally (it normally relies
on a native `<button disabled>` to suppress that, which is exactly
the protection `asChild` throws away).

What closes the gap is that Radix's `CheckboxIndicator` — the only
rendered child, so the only click-leak path — sets
`pointer-events: none` on **itself**, inline and unconditionally,
and that beats RN-Web's non-`!important` re-enable rule. Two
independent blocks end up stacked: the root carries
`none !important`, and the Indicator carries its own `none`.

There is no third block, and specifically no native `<button disabled>`
anywhere in the tree. `checkbox.web.js` assigns `augRef.type = "button"`
as a **property on the already-rendered node**, which is RN-Web's
`Pressable` — a `div`. Setting `.type` on a `div` changes nothing the
browser acts on. That assignment reads like a real button and is not
one; do not count it as protection.

So: **prove the gate is doing something before adding it.** Write the
disabled-interaction test first, confirm it fails without the gate,
then add it. A gate nobody can show is load-bearing invites the next
reader to either delete it blindly or copy it everywhere.
