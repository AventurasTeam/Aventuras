# A react-hook-form field mounted with a `form.reset` misses it on native

A field that mounts in the same commit as a parent's layout-effect
`form.reset` keeps showing the values from before the reset on
Android, while web shows the new ones. The symptom is fields one row
behind: the first open of a row shows the blank or previous draft,
and each later switch shows the row before it.

## Why

react-hook-form 7.81 picks its effect hook once, at module load
(`node_modules/react-hook-form/dist/index.esm.mjs`):

```js
var isWeb =
  typeof window !== 'undefined' &&
  typeof window.HTMLElement !== 'undefined' &&
  typeof document !== 'undefined'

const useIsomorphicLayoutEffect = isWeb ? React.useLayoutEffect : React.useEffect
```

`useWatch` (behind every `Controller`'s `field.value`), `useFormState`,
`useFieldArray` and `useForm` all subscribe to the form in
`useIsomorphicLayoutEffect`. On native that is a passive effect.
`useWatch` reads the form's values once, in its `useState` initializer
at mount, and afterwards changes only when its subscription fires.

So in one commit, with a host that resets the form in
`useLayoutEffect` when its row changes:

1. The new fields render and read the previous row's values.
2. Layout effects run, children first. On web the fields subscribe
   here, then the parent's reset notifies them and they re-render with
   the new row before paint. On native the reset runs with no field
   subscribed.
3. Passive effects run: on native the fields subscribe now, after the
   reset, and nothing tells them it happened.

A field that was already mounted before the switch is subscribed and
does see the reset, which is why a detail pane that keeps its fields
mounted across a row switch looks fine.

## How to apply

Mount the fields after the reset, gated on the row the form holds
rather than the row that is selected. Track it in state set from a
`useLayoutEffect` keyed on the row: the re-render it causes waits for
the whole layout phase, so it follows the reset, and lands before
paint. The Chapter Timeline's
[`use-chapter-row-session.ts`](../../../components/chapters/use-chapter-row-session.ts)
exposes it as `formRowId`, and
[`chapter-card.tsx`](../../../components/chapters/chapter-card.tsx)
renders its editor only when `formRowId` names its own row. Watch for
the same shape anywhere a field mounts in the commit that changes
`rowKey` of
[`use-row-save-session.ts`](../../../hooks/use-row-save-session.ts),
such as a tab that switches during render as a create starts.

Storybook runs react-hook-form's web path, so no story can show the
bug. A unit test can, by forcing the native path under jsdom: hide
`window.HTMLElement` in `vi.hoisted`, before the imports evaluate
react-hook-form, then restore it before rendering. Pair it with a
canary that mounts the fields without the gate and expects the stale
value, so the test fails loudly if react-hook-form ever stops taking
the native path there. Shipped shape in
[`use-chapter-row-session-fields.test.tsx`](../../../components/chapters/use-chapter-row-session-fields.test.tsx).
Surfaced in Slice 5.7.
