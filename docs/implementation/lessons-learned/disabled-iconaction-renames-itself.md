# A disabled `IconAction` renames itself, so a locator named after the enabled control finds nothing

A role-and-name query for a gated icon button resolves **zero**
elements, and the failure reads as a broken selector rather than as
"the surface is gated".

## Why

[`icon-action.tsx`](../../../components/ui/icon-action.tsx) computes
`accessibleName = disabled && disabledReason ? disabledReason : label`
and feeds it to both `accessibilityLabel` and `aria-label`. While the
control is gated its accessible name is the reason, not the label, so
nothing matches the enabled name.

On Story Settings the gate is `isUserEditBlocked`
([`generation.ts`](../../../lib/stores/generation/generation.ts)),
which is **global**: it returns true whenever any run anywhere holds
`gateBehavior: 'hard-gate'`, with no story or branch scoping. The
per-turn pipeline holds that gate well past the point where the reply
has rendered, so a test that drives Story Settings straight after a
turn finds every panel control renamed.

## How to apply

- Before driving a gated control in a test, wait for the gate to clear
  through an observable terminal. The reader's composer swapping
  Cancel back to Send is the one this slice uses — see
  `waitForTurnTerminal` in
  [`story-settings-models.spec.ts`](../../../e2e/tests/story-settings-models.spec.ts).
- When a locator times out on a control that is plainly on screen,
  check whether it is disabled with a reason before suspecting the
  query.

Surfaced in Slice 4.4 (Tasks 23-25).
