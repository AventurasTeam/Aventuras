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
- **Do not then tell consumers the window resizes** — see the section below.
  The claim restores keyboard metrics, not a shrinking container, and libraries
  that are told otherwise stop compensating entirely.
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

## The mode is claimed, but nothing else may assume a resized window

The combination that works on-device is narrow, and half of it is
counter-intuitive:

- **Root claims resize mode** via `useResizeMode()` (above).
- **`@gorhom/bottom-sheet` stays on its `android_keyboardInputMode="adjustPan"`
  default** and keeps translating sheets itself.

Setting gorhom to `adjustResize` — which reads like the honest declaration,
since the root just claimed that mode — puts every sheet back under the
keyboard. Its source shows why the failure is total rather than partial: on that
branch it sets `heightWithinContainer = 0`, i.e. "the keyboard costs nothing
inside my container," and stops compensating. That is only true if the container
actually shrank, and under `edgeToEdgeEnabled` it does not — the OS stopped
resizing edge-to-edge windows, which is the whole reason this library exists.
The claimed mode restores usable keyboard metrics; it does not restore a
resizing window.

**Verified on-device in both directions.** The mechanism above is the reading of
gorhom's source that fits the observations; treat the configuration as the
finding and the explanation as the current best account.

React Native's own `KeyboardAvoidingView` is the other consumer to check. It is
worth being suspicious of on Android in this setup: `behavior="height"` is the
kind of second correction that produces a surface which behaves correctly
everywhere except inside one screen. That tell — one screen wrong, everything
else right — always points at that screen's own extra compensation, not at the
window mode.

## A sheet opened while the keyboard is already up never learns about it

gorhom builds its keyboard state purely from events — `useAnimatedKeyboard`
subscribes to `keyboardDidShow` / `keyboardDidHide` and never reads
`Keyboard.metrics()`, so its state starts at `height: 0`. A sheet mounted while
the keyboard is already open gets no event, because nothing about the keyboard
changed, and positions itself as though there were none.

The tell is an ordering asymmetry that looks like flakiness:

- open the sheet, **then** focus a field inside it — works (the show event
  arrives while the sheet is mounted)
- have the keyboard up, **then** open the sheet — sheet sits underneath

`sheet.tsx` dismisses the keyboard before presenting when one is already
visible, which also happens to be the conventional gesture for opening an
overlay. Focusing a field inside the sheet then fires a show event it can see —
the path that already worked.

`select.tsx` needs the same thing but has nowhere to put it: it drives gorhom's
inline `BottomSheet` declaratively off the open flag, with no present() call to
delay. It keeps a `sheetIndex` state that lags `open` across the dismissal —
driving the index through state is what buys somewhere to wait. Any future
gorhom surface needs one of these two shapes; the gap is in the library, so
every instance inherits it.

Neither Storybook nor the `unit` project can reach this — there is no soft
keyboard in a headless browser. `app/dev/sheet.tsx` and `app/dev/select.tsx`
carry a Keyboard-ordering probe (a focus-first field beside the overlay under
test, on a `keyboardShouldPersistTaps="handled"` scroll view so the opening tap
doesn't dismiss first). Reach for those rather than trying to reproduce it in a
story.

## `extend` does nothing on a single-detent sheet

Unrelated to window mode, and worth knowing because it looks identical from the
outside. `keyboardBehavior="extend"` resolves to `return highestDetentPosition`
— the sheet's own tallest detent. A sheet configured with one snap point
(`snapPoints={['33%']}`) is already at its tallest, so "extend" is a no-op and a
keyboard taller than the sheet covers it completely.

`extend` therefore only earns its keep on a sheet already tall enough to clear
the keyboard, where it reflows content inside height it was going to occupy
anyway. Everything else wants `interactive`, which lifts the sheet by the
keyboard height and preserves its resting size — `sheet.tsx` gives `extend` to
`tall` alone. A second, taller detent would also work, at the cost of handing
every consumer a drag gesture it never asked for.

The ordering asymmetry above and this one produce the same screenshot, so
separate them by _when_ the keyboard arrives: covered when the keyboard was
already up is the event-sourcing gap; covered when a field inside the sheet is
focused afterwards is this.

## Symptom-to-cause shortcut

Keyboard avoidance broken **everywhere at once**, including surfaces nobody
touched, is a window-mode problem. Keyboard avoidance broken on **one** surface
is that surface's own layout — start with
[the KAV `automaticOffset` race](./kav-automatic-offset-animation-race.md)
instead.
