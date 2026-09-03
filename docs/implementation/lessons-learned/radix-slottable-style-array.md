# A Radix Slottable layer spreads a style array into indexed keys

**Symptom.** Adding a computed `style={[{ maxHeight }, style]}` to
`AlertDialogContent` — the same expression `DialogContent` already
ships — crashes the render on web with
`Failed to set an indexed property [0] on 'CSSStyleDeclaration': Indexed property setter is not supported`,
thrown from React DOM's `setValueForStyles`. Nothing in the message
names the dialog, the array, or the primitive.

**Why.** `@rn-primitives/alert-dialog` renders its web `Content` as
`<AlertDialog.Content asChild>` around an RN-Web `View`, so Radix's
Slot merges its own props onto ours. Radix's `AlertDialogContent`
(unlike `DialogContent`) wraps its children in an extra
`createSlottable('AlertDialogContent')` layer, and that merge spreads
`style` as an object. Spreading an **array** yields `{0: …, 1: …}` —
numeric keys that RN-Web passes straight through to the DOM node,
where each index is set as a CSS property name.

RN-Web flattens style arrays itself, which is why the identical
expression is fine in `components/ui/dialog.tsx`: plain
`Dialog.Content` has no Slottable layer, so the array reaches the
`View` untouched and is flattened there.

**How to apply.**

- Pass `StyleSheet.flatten([...])`, not a bare array, to any
  rn-primitives component whose web build forwards through a Radix
  `asChild` slot. The flatten is free on native and removes the only
  shape the merge mishandles.
- Do not reason from "the sibling primitive does it this way." The
  rn-primitives wrappers look symmetrical; the Radix components under
  them are not, and the divergence is invisible from the wrapper's
  types or its source.
- The error surfaces as a DOM exception with a React DOM stack and no
  component name. When a style change crashes with `Indexed property`,
  the cause is an array reaching an object spread — search the chain
  for a slot or prop-merge layer rather than the style itself.
