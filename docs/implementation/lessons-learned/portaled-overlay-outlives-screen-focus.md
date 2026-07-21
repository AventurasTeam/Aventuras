# A portaled overlay keeps rendering over the screen you pushed

Overlays built on `@rn-primitives/portal` (Dialog, AlertDialog,
Popover) mount at the app-level `PortalHost`, not under the screen
that rendered them. expo-router's Stack keeps a screen **mounted**
when another is pushed on top of it, so that screen's render
function keeps running — and its portaled overlay keeps painting at
the root, above the newly pushed screen.

**Symptom.** A modal belonging to screen A floats over screen B.
Its own actions still work, but it obscures the screen the user
navigated to, and any "resolve this by going to Settings" flow is
unusable because the blocker follows the user there.

## Fix

Gate the overlay on focus:

```tsx
import { useIsFocused } from '@react-navigation/native'

function WizardRoute() {
  const isFocused = useIsFocused()
  return <WizardShell>{blocked && isFocused ? <BlockingDialog /> : null}</WizardShell>
}
```

## How this hides until it doesn't

An in-tree fullscreen surface — an early `return <ErrorScreen />`
from the route — never shows this, because the pushed screen simply
covers it. Converting that surface into a modal is exactly the
change that exposes the bug, so a "make this a dialog instead"
refactor should re-test every navigation path out of the blocked
state, not just the visual result.

## How to apply

Any portaled overlay whose visibility is driven by screen-level
state needs a focus condition, unless the overlay is deliberately
app-global (a toast host, an update prompt). Ask "if the user
navigates away while this is open, should it still be on screen?"
— for a screen-scoped blocker the answer is always no.

Related: [Portal drops custom contexts on native](./rn-primitives-portal-context.md)
for the other portal-boundary trap.
