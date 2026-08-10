# `KeyboardProvider` is inert until a hook claims resize mode

Mounting `<KeyboardProvider>` from `react-native-keyboard-controller` does not,
by itself, make anything avoid the Android keyboard. The library only switches
the window into its managed resize mode when a **consumer hook** asks for it. If
the app mounts the provider and never calls one, every keyboard-avoiding surface
silently measures against a window that never shrinks.

`app/_layout.tsx` claims it once, app-wide:

```tsx
function AndroidResizeMode() {
  useResizeMode()
  return null
}
// …
;<KeyboardProvider>
  <AndroidResizeMode />
  {/* … */}
</KeyboardProvider>
```

## Why

`useResizeMode` is the only thing that calls
`KeyboardController.setInputMode(SOFT_INPUT_ADJUST_RESIZE)`. The animation hooks
(`useKeyboardAnimation`, `useReanimatedKeyboardAnimation`, `useKeyboardHandler`)
call it internally, which is why an app can appear to work while never
mentioning resize mode — until the last component using one of those hooks goes
away.

`edgeToEdgeEnabled` is what makes this fatal rather than cosmetic. Edge-to-edge
apps no longer get the OS's automatic window resize from the manifest's
`android:windowSoftInputMode="adjustResize"`; the window keeps its full height
and the app is expected to consume the IME inset itself. That is exactly what
this library does — and what nothing does when the mode is never claimed. So the
manifest looks correct, the provider is mounted, and every consumer is still
wrong.

Everything that measures the window inherits the failure at once:

- `@gorhom/bottom-sheet`'s `keyboardBehavior` computes against a container whose
  height never changes, so sheets sit under the keyboard however it is set.
- React Native's own `KeyboardAvoidingView` with `behavior="height"` resolves to
  no change.
- Anchored popovers (autocomplete's inline listbox) stay where they were.

## How to apply

- **Claim the mode once at the root, never per-surface.** It is global window
  state, and `useResizeMode`'s cleanup calls `setDefaultMode()` on unmount — a
  per-screen claim un-claims it for the whole app the moment that screen goes
  away.
- **Don't let a second library set the same flag.** `@gorhom/bottom-sheet`'s
  `android_keyboardInputMode` prop writes the same window mode and restores it
  when the sheet unmounts, which clobbers the root claim. Leave it at its
  default when `react-native-keyboard-controller` owns the window.
- **Treat "we removed the last hook call" as a keyboard regression.** The
  dependency is invisible: deleting a `useReanimatedKeyboardAnimation()` from
  one component broke keyboard avoidance in unrelated screens across the app,
  with no type error, no lint error, and no failing test — the automated layers
  cannot see window insets at all
  ([the `unit` project can't render RN-Web chrome](./unit-project-no-rn-web-chrome.md),
  and Storybook renders in a browser with no soft keyboard). Grep for the hooks
  before removing one:

  ```sh
  grep -rn "useResizeMode\|useKeyboardAnimation\|useReanimatedKeyboardAnimation\|useKeyboardHandler" app/ components/ hooks/ lib/
  ```

## Symptom-to-cause shortcut

Keyboard avoidance broken **everywhere at once**, including surfaces nobody
touched, is a window-mode problem. Keyboard avoidance broken on **one** surface
is that surface's own layout — start with
[the KAV `automaticOffset` race](./kav-automatic-offset-animation-race.md)
instead.
