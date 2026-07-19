// lib/reader-scroll/autoscroll.ts
const AT_BOTTOM_TOLERANCE_PX = 80

export type AutoscrollState = 'engaged' | 'disengaged'

export type AutoscrollMachine = {
  readonly state: AutoscrollState
  streamStarted(pos: { distanceFromBottomPx: number }): void
  userScrolled(pos: { distanceFromBottomPx: number }): void
  /**
   * Hard disengage on an explicit user gesture (wheel-up, touch drag).
   * Positional `userScrolled` alone can't win against per-chunk re-pins: the
   * user never accumulates more than the at-bottom tolerance between two pins
   * unless they out-scroll the token rate. Doesn't latch — the next
   * `userScrolled` at the bottom re-engages.
   */
  userInterrupted(): void
  autoscrollApplied(pos: { distanceFromBottomPx: number }): void
  streamEnded(): void
}

export function createAutoscrollMachine(): AutoscrollMachine {
  let state: AutoscrollState = 'disengaged'
  let lastProgrammaticDistance: number | null = null
  // Hysteresis after a gesture interrupt: the gesture's own scroll event still
  // reports an at-bottom distance (the pin loop kept the user there), so
  // positional re-engage must stay off until the user has actually left the
  // at-bottom band once.
  let interruptLatched = false

  function atBottom(distanceFromBottomPx: number): boolean {
    return distanceFromBottomPx <= AT_BOTTOM_TOLERANCE_PX
  }

  return {
    get state() {
      return state
    },
    streamStarted(pos) {
      state = atBottom(pos.distanceFromBottomPx) ? 'engaged' : 'disengaged'
      lastProgrammaticDistance = null
      interruptLatched = false
    },
    userInterrupted() {
      state = 'disengaged'
      lastProgrammaticDistance = null
      interruptLatched = true
    },
    userScrolled(pos) {
      // One-shot guard: the marker only ever suppresses the immediately-next
      // event (the DOM echo of a programmatic write), so clear it on every call.
      const wasProgrammaticEcho =
        lastProgrammaticDistance !== null && pos.distanceFromBottomPx === lastProgrammaticDistance
      lastProgrammaticDistance = null
      if (wasProgrammaticEcho) return
      if (interruptLatched) {
        if (atBottom(pos.distanceFromBottomPx)) return
        interruptLatched = false
      }
      state = atBottom(pos.distanceFromBottomPx) ? 'engaged' : 'disengaged'
    },
    autoscrollApplied(pos) {
      lastProgrammaticDistance = pos.distanceFromBottomPx
    },
    streamEnded() {
      lastProgrammaticDistance = null
      interruptLatched = false
    },
  }
}
