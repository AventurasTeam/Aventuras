# Every RN-Web View is a stacking context

**Symptom.** A popover opened from inside a Dialog renders _behind_ it,
even though the popover's content carries a higher `z-index` than the
dialog and every element in its subtree reports a winning value.

**Why.** `react-native-web` emits `z-index: 0` on its base `View` style,
not `auto`. A positioned element with any numeric `z-index` creates a
**stacking context**, and a stacking context clamps every descendant to
its own place in the parent context. So a View at `z-index: 0` sitting
at `<body>` level caps everything portaled inside it at 0 — below a
Dialog overlay at `z-index: 50` — regardless of what the portaled
content sets on itself.

In `components/ui/popover.tsx` the trap was `PopoverPrimitive.Overlay`.
It was styled only on native (`StyleSheet.absoluteFill`); on web it fell
through to a bare View, which is precisely the `z-index: 0` container.
`Select` was unaffected because its dropdown renders inline inside the
dialog rather than portaling out.

**How to apply.**

- When a portaled overlay renders behind something it should cover,
  read the **ancestor chain**, not the element's own `z-index`. Walk up
  logging `position` / `z-index`; the first positioned ancestor with a
  numeric `z-index` is the ceiling.
- Lift that ancestor, not the content. Raising the content's own
  `z-index` inside a capped context does nothing — it looks like a fix
  and changes no pixels.
- Any `Platform.select` that styles only `native` leaves web with the
  RN-Web defaults. That is a real style, not an absence of one.

**Testing.** A `z-index` comparison between two elements passes on the
broken build, because both report winning values inside their own
contexts. Assert **occlusion** instead — hit-test the rendered pixel
with `document.elementFromPoint` at the content's centre and require the
result to be inside the content. That catches any stacking cause, not
just the one you guessed. See `OverAModal` in
[`components/ui/popover.stories.tsx`](../../../components/ui/popover.stories.tsx).

Found 2026-09-02 building the world-state panel's scene editor — the
first consumer to open a Popover from inside a Dialog.
