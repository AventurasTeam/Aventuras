# Native overlay content drops out of Android's accessibility tree

**Symptom.** A native Popover, a tablet Select or a tablet
SearchableOverlayList draws its content and responds to taps, but
TalkBack, Switch Access and Voice Access can't reach any of it.
`uiautomator dump` shows one full-screen node, the pressable overlay,
carrying the content's name, and nothing inside it. Web is fine, and so
are Dialog, AlertDialog and Sheet on Android.

**Why.** Observed, not traced to source: on an Android 17 emulator
image, identically under `@rn-primitives` 1.4.0 and 1.5.2, positioned
content under the `Pressable` overlay stays out of the tree unless a
full-size layer sits between the two. A zero-size
`NativeOnlyAnimatedView` wrapper (Popover, Select) and no wrapper at all
(SearchableOverlayList) both drop it; the same wrapper with
`StyleSheet.absoluteFill` keeps it. Ruled out on device: the overlay's
focusability, the content's `aria-label`, its `role`, `aria-modal`, and
the entering animation. Dialog, AlertDialog and Sheet already give their
wrappers a size, which is why they never showed it.

**How to apply.**

- Put a full-size layer (`StyleSheet.absoluteFill`) between a native
  overlay's `Pressable` and its positioned content. The wrappers in
  `popover.tsx`, `select.tsx` and `searchable-overlay-list.tsx` are the
  pattern.
- The layer adds no touch handling, so a tap outside the content still
  reaches the overlay and closes it.
- Check a new native overlay with `uiautomator dump`: its items must
  appear as nodes, not merely draw. An overlay missing from the tree
  looks fine in screenshots and passes every web test.
