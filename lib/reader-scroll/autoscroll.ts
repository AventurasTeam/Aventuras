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
      // One-shot guard: the marker only ever suppresses the immediately-next
      // event (the DOM echo of a programmatic write), so clear it on every call.
      const wasProgrammaticEcho =
        lastProgrammaticDistance !== null && pos.distanceFromBottomPx === lastProgrammaticDistance
      lastProgrammaticDistance = null
      if (wasProgrammaticEcho) return
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
