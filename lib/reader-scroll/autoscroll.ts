// lib/reader-scroll/autoscroll.ts
const AT_BOTTOM_TOLERANCE_PX = 80

export type AutoscrollState = 'engaged' | 'disengaged'

export type AutoscrollMachine = {
  readonly state: AutoscrollState
  streamStarted(pos: { distanceFromBottomPx: number }): void
  userScrolled(pos: { distanceFromBottomPx: number }): void
  autoscrollApplied(pos: { distanceFromBottomPx: number }): void
  streamEnded(): void
}

export function createAutoscrollMachine(): AutoscrollMachine {
  let state: AutoscrollState = 'disengaged'
  let lastProgrammaticDistance: number | null = null

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
    },
    userScrolled(pos) {
      // Ignore scroll events that merely echo the last programmatic write.
      if (
        lastProgrammaticDistance !== null &&
        pos.distanceFromBottomPx === lastProgrammaticDistance
      ) {
        lastProgrammaticDistance = null
        return
      }
      state = atBottom(pos.distanceFromBottomPx) ? 'engaged' : 'disengaged'
    },
    autoscrollApplied(pos) {
      lastProgrammaticDistance = pos.distanceFromBottomPx
    },
    streamEnded() {
      lastProgrammaticDistance = null
    },
  }
}
