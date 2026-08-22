# A Content that renders the Portal is mounted whether or not it is open

`<Foo.Portal>` unmounts its children while the root is closed — on
web because Radix does, on native because rn-primitives' `Portal`
returns `null`. That is true, and it is the wrong fact to reason
from when the component you are writing is the one that **renders**
the Portal rather than one that sits **inside** it.

`AlertDialogContent`, `SheetContent`, and `SelectContent` in this
repo all render `<...Portal>` as their outermost element. Their own
bodies — and every hook they call — therefore run for as long as the
consumer keeps them in the tree:

```tsx
<AlertDialog open={showConfirm}>
  <AlertDialogContent>…</AlertDialogContent>
</AlertDialog>
```

`AlertDialogPrimitive.Root` renders its children unconditionally
(web: it wraps them in a `View` inside `AlertDialog.Root`; native:
same shape). So `AlertDialogContent` mounts when the **surface**
mounts, not when the dialog opens, and stays mounted after it
closes.

**Symptom.** A side effect meant to last "while the overlay is open"
runs for the life of the screen. When
`useRegisteredOverlay(true)` was written this way, every route that
merely _had_ a confirm dialog registered a blocking overlay
permanently, and the Actions menu's trigger and `Cmd/Ctrl-K` were
inert on that route forever. Five E2E specs failed with
`element is not enabled` on a button no test had touched.

## How to apply

Any effect whose lifetime should be the open interval reads `open`
from the primitive's root context:

```tsx
const { open } = AlertDialogPrimitive.useRootContext()
useRegisteredOverlay(open)
```

Mount-scoped is only correct for a component rendered **as a child
of** the Portal element — where the Portal's own unmounting is what
bounds it. Check which side of `<...Portal>` you are on before
deciding; the two shapes look identical at the call site.

**This is not caught by a story that renders the overlay open.**
The open case passes either way. The regression test is the closed
one — mount the Content with `open={false}` and assert the effect
did _not_ fire.

Related: [Portal drops custom contexts on
native](./rn-primitives-portal-context.md) for the other trap that
turns on which side of the Portal a hook is called.
