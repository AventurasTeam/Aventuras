// lib/reader-scroll/arbiter.ts
import { createAutoscrollMachine, type AutoscrollState } from './autoscroll'
import { WHEEL_CHAIN_GAP_MS } from './landing'
import { isScrollbarPress } from './scroll-gestures'

// Non-programmatic scroll events this far apart, with no active contact, are a reader at rest.
export const REST_MS = 150
export const NEAR_BOTTOM_THRESHOLD_PX = 20
export const JUMP_TO_BOTTOM_SETTLE_MS = 500

export type ScrollWriteOwner = 'autoscroll' | 'bottomPin' | 'landing' | 'anchor' | 'editorReveal'

export type ScrollEventOutcome = {
  isEcho: boolean
  echoOwner: ScrollWriteOwner | null
  armScrollQuiesce: boolean
  clearAnchorMemo: boolean
  syncJumpButton: boolean
}

export type GestureBreakOutcome = {
  stopBottomPin: boolean
  stopLanding: boolean
  stopAnchorHold: boolean
}

export type WheelOutcome = GestureBreakOutcome & {
  armWheelChain: boolean
}

export type PointerDownOutcome = GestureBreakOutcome & {
  interrupted: boolean
}

export type StreamUpdateAction = 'none' | 'autoscrollWrite' | 'startBottomPin' | 'syncJumpButton'

export type ShrinkAction = 'none' | 'editorReveal' | 'startBottomPin'

export type RestFlushPlan =
  | { kind: 'skip' }
  | { kind: 'editorReveal' }
  | { kind: 'startBottomPin' }
  | { kind: 'proceed'; catchUpAutoscroll: boolean }

type PendingRepin = {
  scrollTopAtTrigger: number
  unconditional?: boolean
}

/**
 * Unified scroll-policy, rest, and write-priority arbiter for the reader document
 * (reader-document.md → Entry list). Pure state machine: callers own DOM reads/writes and timers.
 */
export type ScrollArbiter = {
  /** Active touch contact or primary-button non-touch scrollbar drag; blocks every write. */
  readonly contactActive: boolean
  /** Active contact or non-programmatic scroll momentum; blocks unsolicited writes. */
  readonly midGesture: boolean
  readonly scrollQuiescent: boolean
  readonly wheelChainActive: boolean
  /** A jump (entry landing or slice-swap bottom jump) is pending or running. */
  readonly hasActiveJump: boolean
  readonly landingRunning: boolean
  readonly bottomPinActive: boolean
  /** A running landing or bottom pin owns the viewport; pauses jump-button visibility sync. */
  readonly ownsViewport: boolean
  readonly autoscrollState: AutoscrollState
  readonly streamActive: boolean
  readonly lastDistance: number

  recordProgrammaticWrite(scrollTop: number, owner: ScrollWriteOwner): void
  autoscrollApplied(distanceFromBottomPx: number): void
  onScroll(reading: { scrollTop: number; distanceFromBottomPx: number }): ScrollEventOutcome
  onScrollQuiesced(): void

  onTouchStart(touchCount: number): void
  onTouchMove(touchCount: number): GestureBreakOutcome
  onTouchEnd(touchCount: number): { armRest: boolean }
  onPointerDown(press: {
    onScroller: boolean
    offsetX: number
    clientWidth: number
    overflows: boolean
    button: number
    pointerType: string
  }): PointerDownOutcome
  onScrollbarDragEnd(): { armRest: boolean }
  onWheel(input: { timeStamp: number; deltaY: number }): WheelOutcome
  onWheelChainExpired(): void
  onScrollKey(input: { upward: boolean }): GestureBreakOutcome

  onBranchChange(): void
  onHasNewerChange(hasNewer: boolean): void
  onJumpPending(): void
  onLandingStarted(): { rearmWheelChain: boolean }
  onLandingStopped(): void
  onPendingBottomSet(): void
  onPendingBottomCleared(): void
  onBottomPinStarted(): void
  onBottomPinStopped(): void
  onSmoothJumpToBottom(input: { now: number }): void
  onLandAtBottom(input: { now: number }): void

  onStreamUpdate(input: {
    streaming: boolean
    hasNewer: boolean
    reachedTail: boolean
    leftTail: boolean
    now: number
    scrollTop: number
  }): StreamUpdateAction
  onViewportShrink(input: {
    hasFocusedEditor: boolean
    hasNewer: boolean
    distanceBeforePx: number
    scrollTop: number
  }): ShrinkAction
  onChapterBreakMounted(input: {
    hasNewer: boolean
    preBreakDistancePx: number
    scrollTop: number
  }): 'none' | 'startBottomPin'

  planRestFlush(input: {
    laidOut: boolean
    scrollTop: number
    distanceFromBottomPx: number
    hasNewer: boolean
    hasFocusedEditor: boolean
  }): RestFlushPlan
}

export function createScrollArbiter(): ScrollArbiter {
  const autoscroll = createAutoscrollMachine()
  let activeTouches = 0
  let touchInterrupted = false
  let scrollbarDragActive = false
  let scrollQuiescent = true
  let wheelChainActive = false
  let lastWheelAt = Number.NEGATIVE_INFINITY
  let lastWheelSign = 0

  let pendingWrite: { scrollTop: number; owner: ScrollWriteOwner } | null = null
  let pendingRepin: PendingRepin | null = null
  let pendingEditorReveal = false
  let smoothJumpCatchUp = false

  let landingState: 'none' | 'pending' | 'running' = 'none'
  let pendingBottom = false
  let bottomPinActive = false
  let streamActive = false
  let lastDistance = 0
  let pendingJumpAt = Number.NEGATIVE_INFINITY

  const isContactActive = () => activeTouches > 0 || scrollbarDragActive
  const isMidGesture = () => isContactActive() || !scrollQuiescent
  const hasActiveJump = () => landingState !== 'none' || pendingBottom
  const ownsViewport = () => landingState === 'running' || bottomPinActive

  const clearDeferred = () => {
    pendingRepin = null
    pendingEditorReveal = false
    smoothJumpCatchUp = false
    pendingJumpAt = Number.NEGATIVE_INFINITY
  }

  const interruptAutoscroll = () => {
    clearDeferred()
    autoscroll.userInterrupted()
  }

  return {
    get contactActive() {
      return isContactActive()
    },
    get midGesture() {
      return isMidGesture()
    },
    get scrollQuiescent() {
      return scrollQuiescent
    },
    get wheelChainActive() {
      return wheelChainActive
    },
    get hasActiveJump() {
      return hasActiveJump()
    },
    get landingRunning() {
      return landingState === 'running'
    },
    get bottomPinActive() {
      return bottomPinActive
    },
    get ownsViewport() {
      return ownsViewport()
    },
    get autoscrollState() {
      return autoscroll.state
    },
    get streamActive() {
      return streamActive
    },
    get lastDistance() {
      return lastDistance
    },

    recordProgrammaticWrite(scrollTop, owner) {
      pendingWrite = { scrollTop, owner }
    },

    autoscrollApplied(distanceFromBottomPx) {
      autoscroll.autoscrollApplied({ distanceFromBottomPx })
    },

    onScroll({ scrollTop, distanceFromBottomPx }) {
      const expected = pendingWrite
      pendingWrite = null
      if (expected != null && Math.abs(scrollTop - expected.scrollTop) < 1) {
        if (expected.owner === 'anchor') {
          return {
            isEcho: true,
            echoOwner: 'anchor',
            armScrollQuiesce: false,
            clearAnchorMemo: false,
            syncJumpButton: !ownsViewport(),
          }
        }
        lastDistance = distanceFromBottomPx
        return {
          isEcho: true,
          echoOwner: expected.owner,
          armScrollQuiesce: false,
          clearAnchorMemo: true,
          syncJumpButton: !ownsViewport(),
        }
      }

      scrollQuiescent = false
      lastDistance = distanceFromBottomPx
      if (landingState === 'running') {
        autoscroll.userInterrupted()
      } else if (!smoothJumpCatchUp) {
        autoscroll.userScrolled({ distanceFromBottomPx })
      }
      return {
        isEcho: false,
        echoOwner: null,
        armScrollQuiesce: true,
        clearAnchorMemo: true,
        syncJumpButton: !ownsViewport(),
      }
    },

    onScrollQuiesced() {
      scrollQuiescent = true
    },

    onTouchStart(touchCount) {
      activeTouches = Math.max(1, touchCount)
    },

    onTouchMove(touchCount) {
      if (touchCount > 0) activeTouches = touchCount
      clearDeferred()
      if (!touchInterrupted) {
        touchInterrupted = true
        autoscroll.userInterrupted()
      }
      return { stopBottomPin: true, stopLanding: true, stopAnchorHold: true }
    },

    onTouchEnd(touchCount) {
      activeTouches = Math.max(0, touchCount)
      if (activeTouches === 0) touchInterrupted = false
      return { armRest: !isContactActive() }
    },

    onPointerDown({ onScroller, offsetX, clientWidth, overflows, button, pointerType }) {
      if (
        button === 0 &&
        pointerType !== 'touch' &&
        isScrollbarPress({ onScroller, offsetX, clientWidth, overflows })
      ) {
        scrollbarDragActive = true
        interruptAutoscroll()
        return { interrupted: true, stopBottomPin: true, stopLanding: true, stopAnchorHold: true }
      }
      return { interrupted: false, stopBottomPin: false, stopLanding: false, stopAnchorHold: false }
    },

    onScrollbarDragEnd() {
      if (!scrollbarDragActive) return { armRest: false }
      scrollbarDragActive = false
      return { armRest: !isContactActive() }
    },

    onWheel({ timeStamp, deltaY }) {
      const continuesChain = timeStamp - lastWheelAt < WHEEL_CHAIN_GAP_MS
      lastWheelAt = timeStamp
      const sign = Math.sign(deltaY)
      const reverses = sign !== 0 && lastWheelSign !== 0 && sign !== lastWheelSign
      if (sign !== 0) lastWheelSign = sign
      wheelChainActive = true
      if (deltaY < 0) interruptAutoscroll()
      return {
        armWheelChain: true,
        stopBottomPin: true,
        stopLanding: !continuesChain || reverses,
        stopAnchorHold: true,
      }
    },

    onWheelChainExpired() {
      wheelChainActive = false
    },

    onScrollKey({ upward }) {
      if (upward) {
        interruptAutoscroll()
        return { stopBottomPin: true, stopLanding: true, stopAnchorHold: true }
      }
      return { stopBottomPin: false, stopLanding: true, stopAnchorHold: true }
    },

    onBranchChange() {
      clearDeferred()
      landingState = 'none'
      pendingBottom = false
      bottomPinActive = false
      pendingWrite = null
    },

    onHasNewerChange(hasNewer) {
      if (hasNewer) {
        pendingRepin = null
        smoothJumpCatchUp = false
      }
    },

    onJumpPending() {
      landingState = 'pending'
      clearDeferred()
    },

    onLandingStarted() {
      landingState = 'running'
      bottomPinActive = false
      clearDeferred()
      autoscroll.userInterrupted()
      return { rearmWheelChain: wheelChainActive }
    },

    onLandingStopped() {
      landingState = 'none'
      pendingBottom = false
    },

    onPendingBottomSet() {
      pendingBottom = true
      clearDeferred()
    },

    onPendingBottomCleared() {
      pendingBottom = false
    },

    onBottomPinStarted() {
      bottomPinActive = true
      pendingRepin = null
    },

    onBottomPinStopped() {
      bottomPinActive = false
    },

    onSmoothJumpToBottom({ now }) {
      pendingRepin = null
      pendingEditorReveal = false
      lastDistance = 0
      smoothJumpCatchUp = true
      if (streamActive) {
        autoscroll.streamStarted({ distanceFromBottomPx: 0 })
      } else {
        autoscroll.autoscrollApplied({ distanceFromBottomPx: 0 })
        pendingJumpAt = now
      }
    },

    onLandAtBottom({ now }) {
      pendingRepin = null
      pendingEditorReveal = false
      smoothJumpCatchUp = false
      lastDistance = 0
      pendingJumpAt = now
      if (streamActive) autoscroll.streamStarted({ distanceFromBottomPx: 0 })
      else autoscroll.autoscrollApplied({ distanceFromBottomPx: 0 })
    },

    onStreamUpdate({ streaming, hasNewer, reachedTail, leftTail, now, scrollTop }) {
      if (!streaming) {
        if (streamActive) {
          streamActive = false
          const wasSmoothJump = smoothJumpCatchUp
          const engaged = autoscroll.state === 'engaged' || wasSmoothJump
          smoothJumpCatchUp = false
          autoscroll.streamEnded()
          if (engaged && !leftTail && !hasNewer && !hasActiveJump()) {
            if (isMidGesture()) {
              pendingRepin = {
                scrollTopAtTrigger: scrollTop,
                unconditional: wasSmoothJump || undefined,
              }
              return 'none'
            }
            return 'startBottomPin'
          }
        }
        return 'none'
      }

      if (!streamActive) {
        streamActive = true
        const jumpedRecently = now - pendingJumpAt < JUMP_TO_BOTTOM_SETTLE_MS
        autoscroll.streamStarted({
          distanceFromBottomPx: hasActiveJump()
            ? Number.POSITIVE_INFINITY
            : jumpedRecently
              ? 0
              : reachedTail
                ? Number.POSITIVE_INFINITY
                : lastDistance,
        })
      }

      if (!hasNewer && !hasActiveJump() && autoscroll.state === 'engaged') {
        if (isMidGesture()) return 'none'
        return 'autoscrollWrite'
      }
      return ownsViewport() ? 'none' : 'syncJumpButton'
    },

    onViewportShrink({ hasFocusedEditor, hasNewer, distanceBeforePx, scrollTop }) {
      if (hasActiveJump()) return 'none'
      if (hasFocusedEditor) {
        if (isMidGesture()) {
          pendingEditorReveal = true
          return 'none'
        }
        return 'editorReveal'
      }
      if (hasNewer || distanceBeforePx > NEAR_BOTTOM_THRESHOLD_PX) return 'none'
      if (isMidGesture()) {
        pendingRepin = { scrollTopAtTrigger: scrollTop }
        return 'none'
      }
      return 'startBottomPin'
    },

    onChapterBreakMounted({ hasNewer, preBreakDistancePx, scrollTop }) {
      if (hasNewer || hasActiveJump() || preBreakDistancePx > NEAR_BOTTOM_THRESHOLD_PX) {
        return 'none'
      }
      if (isMidGesture()) {
        pendingRepin = { scrollTopAtTrigger: scrollTop }
        return 'none'
      }
      return 'startBottomPin'
    },

    planRestFlush({ laidOut, scrollTop, distanceFromBottomPx, hasNewer, hasFocusedEditor }) {
      if (!laidOut || isMidGesture() || hasActiveJump() || bottomPinActive) {
        return { kind: 'skip' }
      }
      if (pendingEditorReveal) {
        pendingEditorReveal = false
        if (hasFocusedEditor) {
          pendingRepin = null
          return { kind: 'editorReveal' }
        }
      }
      if (pendingRepin != null) {
        const repin = pendingRepin
        pendingRepin = null
        if (
          !hasNewer &&
          !hasFocusedEditor &&
          (repin.unconditional === true ||
            Math.abs(scrollTop - repin.scrollTopAtTrigger) < 1 ||
            distanceFromBottomPx <= NEAR_BOTTOM_THRESHOLD_PX)
        ) {
          return { kind: 'startBottomPin' }
        }
      }
      let catchUpAutoscroll = false
      if (streamActive && !hasNewer && (autoscroll.state === 'engaged' || smoothJumpCatchUp)) {
        if (autoscroll.state !== 'engaged') autoscroll.streamStarted({ distanceFromBottomPx: 0 })
        catchUpAutoscroll = true
      }
      smoothJumpCatchUp = false
      return { kind: 'proceed', catchUpAutoscroll }
    },
  }
}
