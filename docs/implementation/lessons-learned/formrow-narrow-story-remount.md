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

## The width can come from a className, not just an inline style

Until the Storybook vitest project registered NativeWind's `cssInterop`
(2026-08-24), classNames were inert there, so a `w-24` or `w-[640px]`
wrapper measured full-width and the correction never fired. Stories
written under that harness look like they pass at a wide layout while
production stacks and remounts. Two shapes surfaced when registration
landed:

- **A component that is always narrow should pin the branch itself.**
  `TierTupleInput` wraps every `FormRow` in `w-24` / `w-40`, so the
  correction fired on every mount in production too — a real remount,
  not a test artifact. It now passes `stacked`.
- **A story wrapper sitting just under the threshold is a race.**
  `w-[640px]` plus `p-6` measures 592 px, and stories doing that went
  flaky (4 / 2 / 5 failures across identical runs) rather than failing
  outright. Widen the wrapper so the guess and the measurement agree.

## How to apply

- Any play story with a `FormRow` under a width below 640 px — inline
  style **or** className, and remember to subtract padding — passes
  `stacked` explicitly or widens past the threshold. Render-only
  stories may leave it to the heuristic — the remount is harmless
  without assertions.
- The rule is about the **first frame**; a `waitFor` after the
  correction would also work, but it encodes the remount as a
  timing dependency instead of removing it.
- The production cost of a measure-first `FormRow` (a blank first
  frame everywhere) was weighed against this and rejected; the rule
  lives in the story, not the component.

Related: [code-conventions → Testing discipline](../../code-conventions.md#testing-discipline)
for the viewport-global rule this extends.
