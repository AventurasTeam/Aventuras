# Chrome scroll anchoring doesn't fire for RN-Web trees

Browser scroll anchoring (the engine keeping content in place when
layout shifts above the viewport) cannot be assumed for scrollers
whose content is an RN-Web-rendered tree. In the reader document it
measurably never fired: prepending a block above the viewport
jumped the content a full ~1160px, while a synthetic plain-DOM
scroller built in the same WebView anchored perfectly.

## Why

Scroll anchoring is heuristic, not contractual. The spec lets
engines exclude candidate anchor nodes for many reasons — and
RN-Web trees are dense with the things the heuristics skip
(zero-height wrappers, `position`-styled layers, deeply nested
flex `<div>`s with no direct text). No error, no devtools signal —
the anchor selection just silently comes up empty and scroll
position stays fixed while content moves. Which failure you get is
invisible until you test the real tree: synthetic probes with
plain markup pass and tell you nothing.

## How to apply

- Never rely on engine scroll anchoring for a scroller that
  RN-Web (or any framework generating deep wrapper trees) renders
  into. Test with the **real tree**, not a reduced probe.
- If content can shift above the viewport, opt out explicitly
  (`overflow-anchor: none`) and compensate deterministically —
  one owner for the correction, keyed to a memoized anchor row's
  offset delta. Split per-cause compensations fight each other.
- Never land a programmatic scroll write mid-gesture: on touch
  devices, compositor-owned scrolling overwrites main-thread
  `scrollTop` writes and the fight is visible stutter. Defer
  mutations to scroll rest (quiescent scroll events + no finger
  down).

The reader document's full mechanism is canon:
[`reader-document.md → Entry list`](../../ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout).
