# A narrow-wrapped `FormRow` story remounts its control after the first frame

`FormRow` (`components/compounds/form-row.tsx`) decides stacked versus
two-column in two passes: a first-frame guess from `useTier()`, which
reads the **window**, then a correction from its own `onLayout` width
against the 640 px threshold. A Storybook story that wraps it in a
`<View style={{ width: 360 }}>` at the default 1200 px viewport gets
the two-column guess first and the stacked correction one layout
later.

The two branches are structurally different trees — position 0 flips
`Text` → `View` and the control moves one level deeper — so React
unmounts and remounts `children` on the correction. A play function
that grabs the input before that, or types into it across the swap,
is asserting against a node that is about to be thrown away.

**Symptom.** A narrow `FormRow` story passes while asserting the wrong
layout, or `userEvent.type` loses keystrokes / focus halfway through.
No error, no warning.

## Fix

Pin the branch, or make guess and measurement agree:

```tsx
// Pin it — the story is about the stacked layout, so say so.
<View style={{ width: 360 }}>
  <FormRow label="Email" stacked error="Enter a valid email address">
    <ControlledInput placeholder="you@example.com" />
  </FormRow>
</View>

// Or select the tier, so the first-frame guess is already right.
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  ...
}
```

## How to apply

- Any play story with a `FormRow` under an inline width below 640 px
  passes `stacked` explicitly. Render-only stories may leave it to the
  heuristic — the remount is harmless without assertions.
- The rule is about the **first frame**; a `waitFor` after the
  correction would also work, but it encodes the remount as a
  timing dependency instead of removing it.
- The production cost of a measure-first `FormRow` (a blank first
  frame everywhere) was weighed against this and rejected; the rule
  lives in the story, not the component.

Related: [code-conventions → Testing discipline](../../code-conventions.md#testing-discipline)
for the viewport-global rule this extends.
