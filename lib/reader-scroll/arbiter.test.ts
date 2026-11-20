// lib/reader-scroll/arbiter.test.ts
import { describe, expect, it } from 'vitest'

import { createScrollArbiter, NEAR_BOTTOM_THRESHOLD_PX } from './arbiter'

const restContext = (
  overrides: Partial<Parameters<ReturnType<typeof createScrollArbiter>['planRestFlush']>[0]> = {},
) => ({
  laidOut: true,
  scrollTop: 1_000,
  distanceFromBottomPx: 0,
  hasNewer: false,
  hasFocusedEditor: false,
  ...overrides,
})

describe('createScrollArbiter', () => {
  describe('two-level contact and gesture authority', () => {
    it('tracks multi-touch by active touch count and keeps touchInterrupted until the last finger lifts', () => {
      const a = createScrollArbiter()
      a.onStreamUpdate({
        streaming: true,
        hasNewer: false,
        reachedTail: false,
        leftTail: false,
        now: 100,
        scrollTop: 500,
      })
      expect(a.autoscrollState).toBe('engaged')

      a.onTouchStart(1)
      expect(a.contactActive).toBe(true)
      expect(a.midGesture).toBe(true)
      // Plain touchstart does not disengage autoscroll.
      expect(a.autoscrollState).toBe('engaged')

      a.onTouchMove(1)
      expect(a.autoscrollState).toBe('disengaged')

      // Second finger lands, first finger lifts: still in contact, rest does not arm.
      a.onTouchStart(2)
      expect(a.onTouchEnd(1)).toEqual({ armRest: false })
      expect(a.contactActive).toBe(true)
      expect(a.midGesture).toBe(true)

      // Final finger lifts: contact clears and rest arms.
      expect(a.onTouchEnd(0)).toEqual({ armRest: true })
      expect(a.contactActive).toBe(false)
      expect(a.midGesture).toBe(false)
    })

    it('arms scrollbar drag only for primary non-touch presses on an overflowing scrollbar', () => {
      const a = createScrollArbiter()
      const base = { onScroller: true, offsetX: 805, clientWidth: 800, overflows: true }

      // Right-click and touch-synthesized pointerdown never arm scrollbarDragActive.
      expect(a.onPointerDown({ ...base, button: 2, pointerType: 'mouse' }).interrupted).toBe(false)
      expect(a.contactActive).toBe(false)
      expect(a.onPointerDown({ ...base, button: 0, pointerType: 'touch' }).interrupted).toBe(false)
      expect(a.contactActive).toBe(false)
      expect(
        a.onPointerDown({ ...base, overflows: false, button: 0, pointerType: 'mouse' }).interrupted,
      ).toBe(false)
      expect(a.contactActive).toBe(false)

      // Primary mouse press on scrollbar arms drag and interrupts.
      expect(a.onPointerDown({ ...base, button: 0, pointerType: 'mouse' })).toEqual({
        interrupted: true,
        stopBottomPin: true,
        stopLanding: true,
        stopAnchorHold: true,
      })
      expect(a.contactActive).toBe(true)
      expect(a.midGesture).toBe(true)

      expect(a.onScrollbarDragEnd()).toEqual({ armRest: true })
      expect(a.contactActive).toBe(false)
      // Redundant release events are no-ops.
      expect(a.onScrollbarDragEnd()).toEqual({ armRest: false })
    })

    it('distinguishes scroll momentum (!scrollQuiescent) from active contact', () => {
      const a = createScrollArbiter()
      const outcome = a.onScroll({ scrollTop: 400, distanceFromBottomPx: 200 })
      expect(outcome).toEqual({
        isEcho: false,
        echoOwner: null,
        armScrollQuiesce: true,
        clearAnchorMemo: true,
        syncJumpButton: true,
      })
      expect(a.contactActive).toBe(false)
      expect(a.midGesture).toBe(true)
      expect(a.planRestFlush(restContext({ scrollTop: 400, distanceFromBottomPx: 200 }))).toEqual({
        kind: 'skip',
      })

      a.onScrollQuiesced()
      expect(a.midGesture).toBe(false)
      expect(a.planRestFlush(restContext({ scrollTop: 400, distanceFromBottomPx: 200 }))).toEqual({
        kind: 'proceed',
        catchUpAutoscroll: false,
      })
    })
  })

  describe('programmatic-write echo suppression', () => {
    it.each(['autoscroll', 'bottomPin', 'landing', 'editorReveal'] as const)(
      'suppresses %s echo within 1 px without tripping scrollQuiescent',
      (owner) => {
        const a = createScrollArbiter()
        a.recordProgrammaticWrite(850.4, owner)
        const echo = a.onScroll({ scrollTop: 850, distanceFromBottomPx: 0 })
        expect(echo).toEqual({
          isEcho: true,
          echoOwner: owner,
          armScrollQuiesce: false,
          clearAnchorMemo: true,
          syncJumpButton: true,
        })
        expect(a.scrollQuiescent).toBe(true)
        expect(a.midGesture).toBe(false)

        // One-shot: a later scroll at the same scrollTop is treated as user movement.
        const next = a.onScroll({ scrollTop: 850, distanceFromBottomPx: 0 })
        expect(next.isEcho).toBe(false)
        expect(a.scrollQuiescent).toBe(false)
      },
    )

    it('preserves lastDistance, anchorMemo, and autoscroll on anchor-write echo', () => {
      const a = createScrollArbiter()
      a.onScroll({ scrollTop: 900, distanceFromBottomPx: 10 })
      a.onScrollQuiesced()
      a.recordProgrammaticWrite(1_200, 'anchor')
      const echo = a.onScroll({ scrollTop: 1_200, distanceFromBottomPx: 300 })
      expect(echo).toEqual({
        isEcho: true,
        echoOwner: 'anchor',
        armScrollQuiesce: false,
        clearAnchorMemo: false,
        syncJumpButton: true,
      })
      expect(a.lastDistance).toBe(10)
      expect(a.scrollQuiescent).toBe(true)
    })

    it('pauses jump-button sync while a landing or bottom pin owns the viewport', () => {
      const a = createScrollArbiter()
      a.onBottomPinStarted()
      a.recordProgrammaticWrite(1_000, 'bottomPin')
      expect(a.onScroll({ scrollTop: 1_000, distanceFromBottomPx: 0 }).syncJumpButton).toBe(false)
      a.onBottomPinStopped()

      a.onLandingStarted()
      a.recordProgrammaticWrite(400, 'landing')
      expect(a.onScroll({ scrollTop: 400, distanceFromBottomPx: 600 }).syncJumpButton).toBe(false)
    })
  })

  describe('write-priority hierarchy and deferred writes', () => {
    it('blocks viewport shrink and chapter break while a jump is pending or running', () => {
      const a = createScrollArbiter()
      a.onJumpPending()
      expect(
        a.onViewportShrink({
          hasFocusedEditor: false,
          hasNewer: false,
          distanceBeforePx: 0,
          scrollTop: 1_000,
        }),
      ).toBe('none')
      expect(
        a.onViewportShrink({
          hasFocusedEditor: true,
          hasNewer: false,
          distanceBeforePx: 0,
          scrollTop: 1_000,
        }),
      ).toBe('none')
      expect(
        a.onChapterBreakMounted({ hasNewer: false, preBreakDistancePx: 0, scrollTop: 1_000 }),
      ).toBe('none')

      a.onLandingStarted()
      expect(
        a.onViewportShrink({
          hasFocusedEditor: false,
          hasNewer: false,
          distanceBeforePx: 0,
          scrollTop: 1_000,
        }),
      ).toBe('none')

      a.onLandingStopped()
      expect(
        a.onViewportShrink({
          hasFocusedEditor: false,
          hasNewer: false,
          distanceBeforePx: 0,
          scrollTop: 1_000,
        }),
      ).toBe('startBottomPin')
    })

    it('starts a stream disengaged when it begins during a pending or running jump', () => {
      const a = createScrollArbiter()
      a.onLandingStarted()
      expect(
        a.onStreamUpdate({
          streaming: true,
          hasNewer: false,
          reachedTail: false,
          leftTail: false,
          now: 100,
          scrollTop: 1_000,
        }),
      ).toBe('none')
      expect(a.autoscrollState).toBe('disengaged')

      // Even after the landing finishes, subsequent chunks must not yank to bottom.
      a.onLandingStopped()
      expect(
        a.onStreamUpdate({
          streaming: true,
          hasNewer: false,
          reachedTail: false,
          leftTail: false,
          now: 200,
          scrollTop: 200,
        }),
      ).toBe('syncJumpButton')
    })

    it('pauses engaged autoscroll mid-gesture and catches up at rest', () => {
      const a = createScrollArbiter()
      expect(
        a.onStreamUpdate({
          streaming: true,
          hasNewer: false,
          reachedTail: false,
          leftTail: false,
          now: 0,
          scrollTop: 1_000,
        }),
      ).toBe('autoscrollWrite')

      a.onTouchStart(1)
      expect(
        a.onStreamUpdate({
          streaming: true,
          hasNewer: false,
          reachedTail: false,
          leftTail: false,
          now: 50,
          scrollTop: 1_000,
        }),
      ).toBe('none')

      a.onTouchEnd(0)
      expect(a.planRestFlush(restContext())).toEqual({
        kind: 'proceed',
        catchUpAutoscroll: true,
      })
    })

    it('keeps smooth jumpToBottom caught up across fast streaming unless interrupted', () => {
      const a = createScrollArbiter()
      // Stream starts away from bottom -> disengaged.
      a.onScroll({ scrollTop: 100, distanceFromBottomPx: 900 })
      a.onScrollQuiesced()
      a.onStreamUpdate({
        streaming: true,
        hasNewer: false,
        reachedTail: false,
        leftTail: false,
        now: 100,
        scrollTop: 100,
      })
      expect(a.autoscrollState).toBe('disengaged')

      // In-tail smooth jumpToBottom latches catch-up.
      a.onSmoothJumpToBottom({ now: 200 })
      expect(a.autoscrollState).toBe('engaged')
      // Smooth-scroll intermediate events with distance > 80 px do not disengage it.
      a.onScroll({ scrollTop: 600, distanceFromBottomPx: 500 })
      expect(a.autoscrollState).toBe('engaged')
      expect(a.midGesture).toBe(true)
      // Chunk during animation waits for rest.
      expect(
        a.onStreamUpdate({
          streaming: true,
          hasNewer: false,
          reachedTail: false,
          leftTail: false,
          now: 250,
          scrollTop: 600,
        }),
      ).toBe('none')

      // At rest, catches up to live bottom.
      a.onScrollQuiesced()
      expect(a.planRestFlush(restContext({ scrollTop: 900, distanceFromBottomPx: 250 }))).toEqual({
        kind: 'proceed',
        catchUpAutoscroll: true,
      })
    })

    it('cancels smooth jumpToBottom catch-up on user interruption', () => {
      const a = createScrollArbiter()
      a.onStreamUpdate({
        streaming: true,
        hasNewer: false,
        reachedTail: false,
        leftTail: false,
        now: 100,
        scrollTop: 1_000,
      })
      a.onSmoothJumpToBottom({ now: 200 })
      a.onScroll({ scrollTop: 600, distanceFromBottomPx: 400 })
      a.onWheel({ timeStamp: 220, deltaY: -20 })
      a.onScrollQuiesced()
      expect(a.autoscrollState).toBe('disengaged')
      expect(a.planRestFlush(restContext({ scrollTop: 550, distanceFromBottomPx: 450 }))).toEqual({
        kind: 'proceed',
        catchUpAutoscroll: false,
      })
    })

    it('pins unconditionally at rest if a stream ends mid-uninterrupted smooth jumpToBottom', () => {
      const a = createScrollArbiter()
      a.onStreamUpdate({
        streaming: true,
        hasNewer: false,
        reachedTail: false,
        leftTail: false,
        now: 100,
        scrollTop: 1_000,
      })
      a.onSmoothJumpToBottom({ now: 200 })
      a.onScroll({ scrollTop: 600, distanceFromBottomPx: 400 })
      expect(
        a.onStreamUpdate({
          streaming: false,
          hasNewer: false,
          reachedTail: false,
          leftTail: false,
          now: 250,
          scrollTop: 600,
        }),
      ).toBe('none')
      a.onScrollQuiesced()
      expect(a.planRestFlush(restContext({ scrollTop: 960, distanceFromBottomPx: 45 }))).toEqual({
        kind: 'startBottomPin',
      })
    })

    it('evaluates deferred bottom re-pins by stationary hold or near-bottom finish', () => {
      // Stationary thumb release -> re-pins at rest.
      const stationary = createScrollArbiter()
      stationary.onTouchStart(1)
      expect(
        stationary.onViewportShrink({
          hasFocusedEditor: false,
          hasNewer: false,
          distanceBeforePx: 10,
          scrollTop: 1_000,
        }),
      ).toBe('none')
      stationary.onTouchEnd(0)
      expect(
        stationary.planRestFlush(restContext({ scrollTop: 1_000, distanceFromBottomPx: 59 })),
      ).toEqual({ kind: 'startBottomPin' })

      // Upward fling moving 40 px away -> drops without pinning.
      const flungAway = createScrollArbiter()
      flungAway.onScroll({ scrollTop: 990, distanceFromBottomPx: 10 })
      expect(
        flungAway.onChapterBreakMounted({
          hasNewer: false,
          preBreakDistancePx: 10,
          scrollTop: 990,
        }),
      ).toBe('none')
      flungAway.onScroll({ scrollTop: 920, distanceFromBottomPx: 80 })
      flungAway.onScrollQuiesced()
      expect(
        flungAway.planRestFlush(restContext({ scrollTop: 920, distanceFromBottomPx: 80 })),
      ).toEqual({ kind: 'proceed', catchUpAutoscroll: false })

      // Scroll landing inside the 20 px band -> re-pins.
      const landedNear = createScrollArbiter()
      landedNear.onScroll({ scrollTop: 985, distanceFromBottomPx: 15 })
      landedNear.onChapterBreakMounted({
        hasNewer: false,
        preBreakDistancePx: 15,
        scrollTop: 985,
      })
      landedNear.onScroll({ scrollTop: 1_010, distanceFromBottomPx: NEAR_BOTTOM_THRESHOLD_PX })
      landedNear.onScrollQuiesced()
      expect(
        landedNear.planRestFlush(
          restContext({ scrollTop: 1_010, distanceFromBottomPx: NEAR_BOTTOM_THRESHOLD_PX }),
        ),
      ).toEqual({ kind: 'startBottomPin' })
    })

    it('clears deferred re-pin on user interrupt, hasNewer flip, or branch change', () => {
      for (const clear of [
        (a: ReturnType<typeof createScrollArbiter>) => a.onScrollKey({ upward: true }),
        (a: ReturnType<typeof createScrollArbiter>) => a.onHasNewerChange(true),
        (a: ReturnType<typeof createScrollArbiter>) => a.onBranchChange(),
      ]) {
        const a = createScrollArbiter()
        a.onTouchStart(1)
        a.onViewportShrink({
          hasFocusedEditor: false,
          hasNewer: false,
          distanceBeforePx: 0,
          scrollTop: 1_000,
        })
        clear(a)
        a.onTouchEnd(0)
        expect(
          a.planRestFlush(restContext({ scrollTop: 1_000, distanceFromBottomPx: 49 })),
        ).toEqual({ kind: 'proceed', catchUpAutoscroll: false })
      }
    })

    it('defers focused in-row editor reveal mid-gesture and runs it ahead of bottom re-pin', () => {
      const a = createScrollArbiter()
      a.onTouchStart(1)
      expect(
        a.onViewportShrink({
          hasFocusedEditor: true,
          hasNewer: false,
          distanceBeforePx: 0,
          scrollTop: 1_000,
        }),
      ).toBe('none')
      a.onTouchEnd(0)
      expect(a.planRestFlush(restContext({ hasFocusedEditor: true }))).toEqual({
        kind: 'editorReveal',
      })
    })
  })

  describe('wheel-chain liveness and post-commit grace', () => {
    it('stays live across slow commits and requests a grace re-arm on landing start', () => {
      const a = createScrollArbiter()
      expect(a.onWheel({ timeStamp: 100, deltaY: -20 })).toEqual({
        armWheelChain: true,
        stopBottomPin: true,
        stopLanding: true,
        stopAnchorHold: true,
      })
      expect(a.wheelChainActive).toBe(true)

      // Second event in chain keeps landing alive.
      expect(a.onWheel({ timeStamp: 116, deltaY: -20 }).stopLanding).toBe(false)

      // Landing starts while timer hasn't fired (even if a synchronous commit exceeded 100 ms).
      expect(a.onLandingStarted()).toEqual({ rearmWheelChain: true })
      expect(a.wheelChainActive).toBe(true)

      // Reversal drops the landing.
      expect(a.onWheel({ timeStamp: 132, deltaY: 20 }).stopLanding).toBe(true)

      // Quiescence timer clears wheelChainActive.
      a.onWheelChainExpired()
      expect(a.wheelChainActive).toBe(false)
      expect(a.onLandingStarted()).toEqual({ rearmWheelChain: false })
    })
  })
})
