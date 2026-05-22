# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## UX

- **Sheet keyboard avoidance — swap to `react-native-keyboard-controller`.**
  Sheet currently wraps content in RN's built-in `KeyboardAvoidingView`
  because the spec target,
  [`react-native-keyboard-controller`'s `KeyboardAvoidingView`](./ui/patterns/overlays.md#sheet--keyboard-handling)
  (with `behavior='translate-with-padding'` + `automaticOffset`), ships a
  TurboModule that needs the library's Expo config plugin in `app.json`
  and a dev-client rebuild — adding it without that crashes Android at
  module load (`KeyboardControllerNative.getConstants is not a function`).
  Once the plugin lands in `app.json` and the dev client is rebuilt,
  reinstall the library and swap the import in
  [`components/ui/sheet.tsx`](../components/ui/sheet.tsx).
