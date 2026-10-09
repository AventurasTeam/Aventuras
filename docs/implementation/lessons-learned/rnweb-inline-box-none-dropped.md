# Inline `pointerEvents: 'box-none'` does nothing on web

**Symptom.** A full-width overlay meant to let clicks through catches
every click over its box on web: the strip beside a toast can't be
clicked, and the composer's spellcheck overlay takes clicks meant for
the textarea under it. Native behaves.

**Why.** `box-none` and `box-only` aren't CSS values. `react-native-web`
polyfills them only for **compiled** styles, the atomic path
`StyleSheet.create` and the deprecated `pointerEvents` prop take: the
view gets `pointer-events: none !important` and its direct children
`auto`. An inline style object goes through RN-Web's `inline()`
compiler, which has no `pointerEvents` case, so the DOM receives the
literal `pointer-events: box-none`. The browser drops the invalid
declaration and the view is `auto`. `none` and `auto` are real CSS
values, so inline objects carrying those still work.

**How to apply.**

- Take `box-none` from `POINTER_EVENTS_BOX_NONE` in
  [`constants/styles.ts`](../../../constants/styles.ts), which is
  compiled through `StyleSheet.create`. Don't spread it into another
  object: the result is a compiled reference on web, not a plain
  style.
- A computed-style check doesn't find this. Assert the click target:
  `document.elementFromPoint` beside the content must return what's
  underneath. See `ClicksPassBesideToast` in
  [`components/ui/toast.stories.tsx`](../../../components/ui/toast.stories.tsx)
  and `LintedDraftLeavesTextareaClickable` in
  [`components/reader/spellcheck-textarea.stories.tsx`](../../../components/reader/spellcheck-textarea.stories.tsx).

Found 2026-10-09 in a triage pass. Every `box-none` site had been
inline since the style-key move in M3.12b.
