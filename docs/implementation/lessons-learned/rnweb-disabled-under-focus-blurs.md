# A control that disables under focus drops focus on web

**Symptom.** A focused button goes busy or disabled (History's
`Load more` while it loads, `Set as lead` while generation blocks it)
and keyboard focus lands on `<body>`. The next Tab starts from the top
of the page. Native keeps its place.

**Why.** RN-Web renders a `role="button"` Pressable as a native
`<button>` and turns `disabled` into the native attribute. Chromium
blurs a focused element the moment it becomes disabled. Keeping the
control's element stable doesn't help: `ReasonTooltip`'s rule (render
the wrapper unconditionally so React doesn't remount the control)
avoids a remount, but nothing stops the blur that follows the attribute.
Canon makes disabled controls unfocusable
([`color.md → Disabled`](../../ui/foundations/color.md#disabled)), so
the attribute is doing what canon asks.

**How to apply.**

- Where focus must survive a control disabling, hand it to a stable
  container in the same commit the state flips. The peek drawer
  refocuses its dialog when `Set as lead` disables
  (`components/reader/peek/peek-drawer.tsx`).
- Whether busy and reason-bearing controls should instead stay
  focusable through `aria-disabled` is a design question owned by
  roadmap M9.2's `disabledReason` entry, since it also decides how the
  reason reaches assistive tech.

**Testing.** Assert `document.activeElement` after the flip, in a
browser story; computed styles say nothing about focus. See
`FocusStaysWhenGateBlocks` in
[`components/reader/peek/peek-drawer.stories.tsx`](../../../components/reader/peek/peek-drawer.stories.tsx).

Found 2026-10-09 in 4.5b's review.
