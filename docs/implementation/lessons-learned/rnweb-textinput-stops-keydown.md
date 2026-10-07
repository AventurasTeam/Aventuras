# A bubble-phase global hotkey never sees a key pressed inside a field

**Symptom.** A keyboard shortcut bound with `useGlobalHotkey` works from
anywhere on the page except while focus is in a text field. Pressing
`Cmd/Ctrl+\` in the Browse rail's search box did nothing, though the same
press worked one click away.

**Why.** RN-Web's `TextInput` calls `e.stopPropagation()` in its keydown
handler (`node_modules/react-native-web/dist/exports/TextInput/index.js:270-273`,
"prevent key events bubbling"). A listener on `window` in the bubble phase
never receives the event. `ignoreEditableTargets` isn't involved: the
handler isn't even called.

**How to apply.**

- A hotkey that must fire from inside a field passes `capture: true`, so
  the listener runs on the way down, before the field sees the key. The
  save bar, the Actions menu and the rail's `Cmd/Ctrl+\` do.
- Leave `capture` off for a hotkey a field should keep, a bare letter, say:
  in the bubble phase an RN-Web `TextInput` already swallows the key.
  `ignoreEditableTargets` matters only for editables that don't stop
  propagation, and for capture-phase listeners that should yield to fields.
- A story or E2E test that presses the shortcut with focus on the page body
  passes on the broken build. Press it from a focused field.
