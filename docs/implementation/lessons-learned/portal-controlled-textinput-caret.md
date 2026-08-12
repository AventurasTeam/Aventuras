# Controlled TextInput inside a portal loses the caret on Android

A controlled `TextInput` rendered inside `@rn-primitives/dialog`'s
portal — which means every Sheet, Select, and popover form — walks
the caret one position left on any mid-string edit on Android.
Backspace between `u` and `h` in `Buh` deletes the right character
but parks the caret before `B`; inserting mid-string lands the new
character one slot early. End-of-string edits are unaffected, and
web is unaffected, which is why the bug survived desktop testing.

**Why.** RN's `useTextInputStateSynchronization` assumes the
consumer's `setState` (from `onChangeText`) and its own
`setLastNativeText` land in the same React commit — then
`lastNativeText === props.value` and no native write happens. The
portal breaks that assumption: the consumer's state lives outside
the portal, and children re-render through the portal store, so the
new `value` reaches the mounted TextInput one commit late. In the
intermediate commit `lastNativeText !== props.value`, and the sync
effect calls `setTextAndSelection` with a **current** event count —
native accepts the stale text, then the late commit rewrites it
again. Two full text replacements per keystroke; the selection
restore loses one position.

## The bisect (device-verified, 2026-08)

- Backspace-specific handling — **out**: mid-string insert faults
  identically.
- `Input`'s wrapper — **out**: a bare controlled `TextInput` in the
  same sheet faults identically.
- gesture-handler's wrapped TextInput — **out**: swapping it out
  changed nothing.
- gorhom BottomSheet — **out**: a right-anchored sheet is a plain
  Dialog with no gorhom and faults identically.
- Controlled round-trip through the portal — **cause**: the same
  field uncontrolled is correct.

## The fix

`components/ui/controlled-text-sync.native.ts` (consumed by `Input`
and `Textarea`): never hand `value` to the native TextInput. Pass a
frozen `defaultValue`, track the native text and event count from
`onChange`, and push imperatively — the same `setTextAndSelection`
command RN's own `clear()` uses — only when `value` diverges from
the last native text: clear buttons, resets, programmatic fills.
Web keeps the plain controlled passthrough
(`controlled-text-sync.ts`); React DOM applies controlled values
synchronously.

Verified on device: caret holds on backspace + insert mid-string in
a gorhom sheet (`app/dev/sheet.tsx` probes), while the bare
controlled TextInput next to it still faults; SearchableOverlayList's
clear X (the divergence-push path) empties the field with focus
retained and typing resumes cleanly.

## Contract and known limits

- While the field is focused and being typed in, **native text is
  authoritative**; `value` cannot revert individual keystrokes. A
  consumer that transforms text in `onChangeText` (uppercase,
  filtering) will still sync, but the caret jumps to the end on each
  divergence — no such consumer exists today.
- A programmatic write racing an in-flight keystroke event can be
  dropped by native's event-count guard (state stays consistent; the
  write is lost). The window is one event round-trip.
- `defaultValue` is frozen per mount. Re-keying the inner TextInput
  (e.g. flipping an adornment between `null` and a node) would
  restore stale text — already a banned pattern per
  [Input adornment DOM identity](./input-adornment-dom-identity.md).

## How to apply

Text fields must route through `Input` / `Textarea` — never a raw
controlled `TextInput` — anywhere a portal is or may be in the
ancestry (sheets, selects, dialogs, popovers). `TagInput` still
holds a raw controlled `TextInput`; it currently mounts only on
plain screens (wizard step-world), and must adopt
`useControlledTextSync` before it is ever placed inside an overlay.

Related: [rn-primitives' native Portal drops custom contexts](./rn-primitives-portal-context.md)
for the other way this portal architecture diverges from render-site
expectations.
