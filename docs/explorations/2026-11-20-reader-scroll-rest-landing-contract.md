# Reader Scroll, Rest, and Landing Contract

Date: 2026-11-20
Status: Integrated into canonical docs

## Problem & scope

Five open UX followups in [`docs/followups.md`](../followups.md#ux) cluster on the same reader-document substrate (`components/reader/reader-surface.tsx` and `lib/reader-scroll/`):

1. **Wheel hold starting a frame late:** when a slice commit delivering a pending jump's target outlasts `WHEEL_CHAIN_GAP_MS` (100 ms), `startLanding` reads `now - lastWheelHandledAt >= 100 ms`, leaves `overflowY` scrollable on frame 1, and lets queued momentum wheels move the reader for a frame.
2. **Landing not settling while a reply streams:** `LandingMachine.settle` checks `scrollHeight === lastHeight`, so fast wraps during streaming reset `stableFrames` to the 600-frame cap and drag a bottom-clamped target upward as room opens below.
3. **Scroll-rest & gesture gaps:** `gestureActiveRef` tracks touch as a single boolean cleared on any `touchend` (breaking multi-touch), ignores touch-fling momentum for bottom pins and viewport shrinks, drops scrollbar-drag tracking after `pointerdown`, and lets an in-band touch drag re-engage autoscroll and write `scrollTop` under the finger.
4. **Shrinking viewport pulling a landing to the bottom:** `ResizeObserver` lacks a pending/running jump guard (already specified in canon, missing in code).
5. **Bottom geometry read only at a few moments:** `syncJumpButton` misses commit swaps, late layout, metadata/footer growth, and resizes; chapter-break re-pin reads a commit-only height snapshot (`lastCommitHeightRef`) that goes stale when late layout changes content height between commits.

These five gaps share one root cause: scroll-policy state is split across ~25 ad-hoc refs and effects in `reader-surface.tsx`, so individual writers forget sibling guards. This design defines one unified scroll-arbiter contract under `lib/reader-scroll/` and one dual-observer geometry substrate in the reader document.

## Architecture choice

**Chosen:** Unified scroll arbiter (`lib/reader-scroll/`) + dual `ResizeObserver` substrate (`scrollRef` + static `flow-root` inner content wrapper `contentRef`), with `reader-surface.tsx` reduced to a thin DOM adapter.

**Rejected alternatives:**

- _Targeted patches on existing refs:_ smallest diff, but leaves ~25 interacting refs in a 1,276-line component where each future scroll feature (such as M9.5 width-reflow anchoring) must manually remember every sibling guard.
- _Browser-native `scrollend` + CSS scroll-anchoring delegation:_ already ruled out by device measurement — Chrome's `overflow-anchor` does not fire reliably for this tree ([`reader-document.md`](../ui/patterns/reader-document.md#entry-list-fully-rendered-flow-layout)), and `scrollend` never fires for a stationary touch hold or a 0-px scrollbar press. `scrollend` is adopted as one input to the gesture tracker rather than a replacement for the rest machine.

## 1. Scroll-rest and gesture authority

One pure state machine in `lib/reader-scroll/` tracks two distinct levels of user activity:

- **`contactActive`** — blocks **every** scroll write, explicit jumps included:
  - **Multi-touch contact (`activeTouches > 0`):** updated from `event.touches.length` on `touchstart`, `touchend`, and `touchcancel`. Lifting one finger while another remains down keeps `activeTouches >= 1`. `touchInterrupted` (used so plain taps do not disengage an engaged stream while the first `touchmove` does) resets only when `activeTouches === 0`.
  - **Scrollbar drag (`scrollbarDragActive`):** armed on `pointerdown` when `isScrollbarPress` holds **and** `event.button === 0 && event.pointerType !== 'touch'` (preventing right-clicks or touch-synthesized pointer events from arming it). Cleared on the first of: `scrollend` on the scroller, `pointerup` / `pointercancel` / `mouseup` on `window` (capture), `pointermove` / `mousemove` on `window` (capture) with `event.buttons === 0`, or `window` `blur`.
    - _Unverified assumption (build-slice probe required):_ Chromium/Electron suppresses `pointerup`/`mouseup` over native scrollbars during drags; `scrollend` is expected to cover dragged releases, while a 0-px click-release with the cursor left parked on the scrollbar track may emit neither `pointerup` nor `scrollend`. The build slice probes real Electron/Chromium on that 0-px case and, if neither fires, adds a bounded quiet-release fallback (plus clearing on subsequent `keydown` / `wheel` / `touchstart`).
- **`midGesture`** (`contactActive || !scrollQuiescent`) — blocks all **unsolicited** scroll writes:
  - **`!scrollQuiescent`:** armed by any non-programmatic `scroll` event and cleared after `REST_MS` (150 ms) of scroll quiescence.

### Programmatic-write echo suppression

Every reader-owned `scrollTop` write (`autoscroll`, `bottomPin`, `landing`, `anchor`, `editorReveal`) routes through one helper (`writeScrollTop(el, nextTop, owner)`). If `el.scrollTop` actually changed (clamped writes emit no `scroll` event), the helper records the read-back `el.scrollTop` (absorbing sub-pixel DPR rounding) and owner. A subsequent `scroll` event matching `|el.scrollTop - expectedScrollTop| < 1` is recognized as a programmatic echo and **never** sets `scrollQuiescent = false` — preventing a streaming chunk's own write from tripping `midGesture` and stalling the next chunk for 150 ms. Anchor-write echoes continue to leave `lastDistanceRef` and `anchorMemoRef` untouched (preserving `SliceCompensationKeepsTheReplyEngaged`).

### Wheel-chain liveness

Tracked alongside gesture state: `wheelChainActive` turns `true` on any `wheel` event and clears via a `WHEEL_CHAIN_GAP_MS` (100 ms) event-loop timer (re-armed on each `wheel`, cleared on unmount). `continuesChain` and `reverses` continue to compare `event.nativeEvent.timeStamp` and `Math.sign(event.deltaY)`.

## 2. Write-priority hierarchy and deferred writes

All scroll writers obey one precedence order:

| Priority | Writer                                                                                                     | Gate / behavior                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | **Active user contact / drag** (`contactActive`)                                                           | Beats everything. Explicit jumps wait for finger lift; drags and scrollbar presses drop jumps.                                                         |
| 2        | **Explicit jump** (`jumpToEntry`, `jumpToBottom`, pending or running)                                      | Beats all unsolicited writes, anchor preservation, and slice maintenance. Sole exception permitted to halt momentum without waiting `REST_MS`.         |
| 3        | **Unsolicited bottom-following** (`!hasNewer`: autoscroll follow, stream-end settle, shrink/break re-pins) | Waits for `atRest` (`!midGesture`). _(Open-at-bottom runs on initial mount/branch switch before any gesture and breaks on the first gesture or jump.)_ |
| 4        | **Anchor preservation** (commit offset delta + short hold)                                                 | Yields to explicit jumps and active bottom pins; breaks on any user gesture.                                                                           |
| 5        | **Background slice maintenance** (held above-viewport adoption, `onNearTop`, `onNearBottom`, `onTrim`)     | Runs only at `atRest` with no active jump or bottom pin.                                                                                               |

This hierarchy structurally resolves viewport-shrink vs. landing: `ResizeObserver` checks `hasActiveJump` (`landing != null || pendingBottom != null`) and skips while any jump is pending or running, matching [`reader-composer.md → Autoscroll`](../ui/screens/reader-composer/reader-composer.md#autoscroll).

### Deferred writes mid-gesture

- **Engaged autoscroll under a finger, drag, or fling:** While `midGesture` holds, stream chunks do **not** write `scrollTop`. At `atRest`, if the stream is still active and `autoscroll.state === 'engaged'` (with `!hasNewer` and `!hasActiveJump`), the rest flush catches up to `scrollHeight` via `writeScrollTop`.
- **Smooth `jumpToBottom` during a fast stream:** An in-tail `jumpToBottom` (`scrollTo({ behavior: 'smooth' })`) emits intermediate `scroll` events over ~150 ms, which naturally keep `scrollQuiescent = false` (holding trims until animation ends). To prevent a fast stream from outgrowing the smooth scroll's target by > 80 px mid-animation and leaving autoscroll disengaged, an uninterrupted `jumpToBottom` while a stream is active latches the same rest-time catch-up (cleared immediately by any `userInterrupted()`).
- **Deferred bottom re-pins (viewport shrink, chapter break, stream-end settle):** When a trigger qualifies against pre-event geometry while `midGesture` holds (and `!hasNewer`, `!hasActiveJump`, and — for shrink — no focused in-row editor), the arbiter latches `pendingRepin = { scrollTopAtTrigger }` instead of calling `startBottomPin()`. Any `userInterrupted()`, explicit jump, `hasNewer` flip, or `branchKey` change clears it immediately.
- **Rest-time evaluation of `pendingRepin`:** At `atRest`, `pendingRepin` runs `startBottomPin()` **iff** either:
  1. the user did **not** scroll after the trigger (`|el.scrollTop - scrollTopAtTrigger| < 1`, covering a stationary thumb resting on screen when a banner or chapter break arrived), **or**
  2. the user's scroll finished within the 20 px near-bottom band of the **current** geometry.
     Otherwise it clears without moving the view (so an upward fling already in motion when a break lands, or a drag that lands 40 px up, is never pulled back).
- **Focused in-row editor reveal:** On viewport shrink while an in-row `<textarea>` holds `doc.hasFocus()`, editor reveal still overrides bottom re-pin, skips while `hasActiveJump`, and waits for `atRest` if `midGesture` holds.

### Single `atRest` flush order

When transitioning to `atRest` (and laid out, with no active jump or running bottom pin):

1. Evaluate and clear `pendingRepin` (if it starts `startBottomPin()`, stop; the pin re-arms rest when it settles).
2. Catch up engaged autoscroll if a stream is active at the tail.
3. `recordAnchor()` and adopt any held above-viewport change (if adopted, stop; its commit re-arms rest).
4. Issue `onNearTop` / `onNearBottom` / `onTrim` if eligible and no request is in flight.

## 3. Jump landing lifecycle

### A. Wheel-hold start across slow commits

`startLanding` reads `wheelChainActive` (from Section 1's event-loop timer) instead of comparing `performance.now() - lastWheelHandledAt < WHEEL_CHAIN_GAP_MS`. While a jump is pending (`running: false`), `overflowY` remains `''`. Because a JS timer cannot fire during a synchronous main-thread commit, a wheel chain live right before a > 100 ms commit is still `true` inside `useLayoutEffect` when frame 1 of `startLanding` runs — writing `overflowY = 'hidden'` before the browser yields to queued momentum wheels.

When `startLanding` begins with `wheelChainActive === true`, it re-arms the `WHEEL_CHAIN_GAP_MS` (100 ms) timer from `now` (post-commit grace), so an overdue pre-commit timer cannot clear `wheelChainActive` before the first post-commit frame delivers queued wheels. If queued wheels arrive, they hit `overflowY: 'hidden'` (zero unheld frames) and refresh the timer; if momentum ended during the commit, the hold releases cleanly after 100 ms. `WHEEL_HOLD_MAX_MS` (3 s cap) and chain-break drops (`!continuesChain` / `reverses`) stay unchanged.

_Acceptance criterion:_ `JumpPendingHaltsWheelMomentumOnceItsRowArrives` (`components/reader/reader-surface.stories.tsx`) removes its `commitOutlastedChain` allowance and asserts `unheldAfterRow === 0` under a commit forced past 100 ms.

### B. Target-anchored settle

`LandingMachine` stops observing `scrollHeight` and tracks `targetContentTop = contentTop(el, landingElement(rowEl))` instead (immune to growth below the target):

- On the first writable, at-rest frame (`step.land && step.highlight`), the landing writes `Math.max(0, targetContentTop - JUMP_LANDING_GAP_PX)`, reads back browser-clamped `after = el.scrollTop`, and locks `desiredGap = targetContentTop - after` (`12 px` un-clamped, `0 px` at branch top, or the clamped offset near the tail).
- Subsequent settle frames target `Math.max(0, targetContentTop - desiredGap)` via `writeScrollTop`. Shifts _above_ the target move `targetContentTop` and are tracked pixel-for-pixel; growth _below_ the target (such as a streaming reply) leaves `targetContentTop` unchanged, writes nothing, and never drags a clamped target upward.
- A frame counts toward `LANDING_SETTLED_FRAMES` (10) iff `current.land && !current.wheelChainLive && |after - before| < 1 && |targetContentTop - lastTargetContentTop| < 1`. (`LANDING_MAX_FRAMES = 600` stays as a safety cap.)
- `LandingFrame.fingerDown` receives `contactActive` (`activeTouches > 0 || scrollbarDragActive`) — not `midGesture`, so explicit jumps still halt momentum immediately without waiting `REST_MS` (preserving `JumpWaitsOutARestingFinger` and `JumpHaltsMomentum`).

_Story impact:_ `JumpButtonRisesAsAStreamOutgrowsALandingOnTheTail` (`reader-surface.stories.tsx`) currently expects a fast stream to keep a tail landing unsettled until the row climbs to the top; update it to assert the clamped target stays stationary and settles while the jump button rises cleanly once the reply outgrows the 20 px band.

## 4. Bottom-geometry observation

Wrap the scroller's flow children (top shimmer, rows + chapter breaks, bottom shimmer, streaming card) in a single static-positioned `flow-root` inner container (`<div ref={contentRef} className="flow-root">`). Because `position: static` is not an `offsetParent`, `contentTop(el, rowEl)` stays exact; `flow-root` eliminates margin collapse across the boundary; and `JumpButtons` sits outside `scrollRef`, so syncing button visibility cannot trigger a `ResizeObserver` loop.

Observe **both** `scrollRef` (viewport) and `contentRef` (content box) via `ResizeObserver`:

- **On `contentRef` resize** (and in the post-commit `useLayoutEffect`): if not laid out (`el.getClientRects().length === 0`), set `liveContentHeight = null`; otherwise set `liveContentHeight = el.scrollHeight` and sync `showJumpToBottom` whenever no landing or bottom pin is active (preventing flicker during active pins, preserving `JumpButtonStaysDownWhileABreakPinFollowsAStream`).
- **On `scrollRef` resize:** in addition to Section 2's shrink re-pin / editor reveal, sync `showJumpToBottom` whenever no landing or bottom pin is active (so viewport growth hides the button immediately when entering the 20 px band, and a non-pinning shrink raises it immediately).
- **On `stopBottomPin()` / `stopLanding()`:** call `syncJumpButton()` once so button visibility is exact the instant a pin or landing ends.
- **Exact pre-break baseline:** On a commit adding a chapter break, React runs `useLayoutEffect` synchronously _before_ paint and _before_ `ResizeObserver` delivers callbacks for that commit. The chapter-break effect therefore reads `liveContentHeight` as the exact pre-break height (including all late layout since the prior commit), and the post-commit `useLayoutEffect` advances it afterward.

_M9.5 & test-helper notes:_ M9.5 width-reflow anchoring ([`roadmap.md`](../implementation/roadmap.md#m9--storybook--per-surface-visual-polish--ship-gate)) plugs directly into this same dual-observer substrate. Because `contentRef` sits between the scroller and row divs, `reader-surface.stories.tsx`'s `readerScroller()` / `scrollerOf()` helpers should locate the scroller via a `data-reader-scroller` attribute rather than `.parentElement`.

## Adversarial review record

Verified against `components/reader/reader-surface.tsx`, `lib/reader-scroll/{landing,autoscroll,scroll-gestures,scroll-metrics}.ts`, and `components/reader/reader-surface.stories.tsx`. Three subtle breaks were caught and folded into the spec above:

1. **Programmatic-write echo loop:** `handleScroll` currently stamps `lastScrollAtRef` _before_ checking `anchorWriteRef`, and does not tag autoscroll/pin/landing writes — meaning autoscroll's own chunk write would trip `midGesture` for 150 ms on every chunk. Fixed by routing all reader-owned writes through `writeScrollTop` with read-back echo suppression.
2. **Smooth `jumpToBottom` during fast streaming:** `scrollTo({ behavior: 'smooth' })` emits intermediate `scroll` events over ~150 ms whose `distanceFromBottomPx > 80` can disengage autoscroll if a fast stream outgrows the old target mid-animation. Fixed by latching engaged rest catch-up for an uninterrupted `jumpToBottom` during a stream.
3. **`contactActive` vs. `midGesture` + primary-button scrollbar guard:** explicit jumps must gate on `contactActive` alone (not `midGesture`) so they continue halting momentum without a 150 ms wait, and scrollbar-drag arming must require `event.button === 0 && event.pointerType !== 'touch'` so right-clicks or touch-synthesized pointerdowns never strand `scrollbarDragActive`.

_Unverified assumption carried explicitly to build:_ Chromium/Electron's event sequence on a 0-px stationary click-release over a native scrollbar track (probe required in the build slice).
