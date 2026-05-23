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

- **`SearchableOverlayList` — `initialScrollRowId`.**
  The
  [substrate spec](./ui/patterns/searchable-overlay-list.md#implementation-notes)
  describes `initialScrollRowId` (open-time scroll-into-view, mid-viewport) for
  consumers that want to anchor a particular row in view when the overlay opens
  (favorites, active model, etc.). Not implemented in v1. The shipped substrate
  already has the virtualization plumbing (`@tanstack/react-virtual` web,
  `SectionList` native) that this would build on — call
  `virtualizer.scrollToIndex(idx, { align: 'center' })` on open.

- **`SuggestionCategoriesEditor` — non-virtualized mobile drag.**
  The mobile path
  ([`components/compounds/suggestion-categories-editor.tsx`](../components/compounds/suggestion-categories-editor.tsx))
  uses `react-native-draggable-flatlist` which is a virtualized `FlatList`
  underneath. RN warns and breaks drag auto-scroll when the editor is
  nested in a parent `ScrollView` with the same orientation — the
  shape every screen-level settings consumer will have. Today the
  contract is "give the editor its own bounded-height container,"
  documented at the `PhoneList` site. Long-term fix: category lists
  are inherently short (3-10 entries typical), so swap to a custom
  drag impl using `react-native-reanimated` + `react-native-gesture-handler`
  rendering plain `View` rows — no virtualization, drops the
  `react-native-draggable-flatlist` dep, removes the nest constraint.

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
