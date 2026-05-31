import { isDiagnosticsEnabled } from './gate'
import { loggerWithoutTurn } from './logger'
import { diagnosticsStore } from './store'
import type { PhaseEvent, TurnCapture } from './types'

const TURN_CAPTURES_CAP = 100

function update(actionId: string, fn: (t: TurnCapture) => TurnCapture): void {
  diagnosticsStore.setState((state) => {
    const idx = state.turnCaptures.findIndex((t) => t.actionId === actionId)
    if (idx === -1) return {}
    const next = [...state.turnCaptures]
    next[idx] = fn(next[idx])
    return { turnCaptures: next }
  })
}

export const turnCaptureSink = {
  beginTurn(args: { actionId: string; branchId: string }): void {
    if (!isDiagnosticsEnabled()) return
    diagnosticsStore.setState((state) => {
      const row: TurnCapture = {
        actionId: args.actionId,
        branchId: args.branchId,
        startedAt: Date.now(),
        phaseEvents: [],
      }
      if (state.turnCaptures.length < TURN_CAPTURES_CAP) {
        return { turnCaptures: [...state.turnCaptures, row] }
      }
      const evictIdx = state.turnCaptures.findIndex((t) => t.endedAt !== undefined)
      if (evictIdx === -1) {
        // All 100 slots are in-flight; dropping new turn is safer than evicting live runs.
        // warn (not debug): the only signal for a dropped turn — debug is gated off by default.
        loggerWithoutTurn.warn('pipeline.turn_capture_buffer_full', { cap: TURN_CAPTURES_CAP })
        return {}
      }
      return {
        turnCaptures: [
          ...state.turnCaptures.slice(0, evictIdx),
          ...state.turnCaptures.slice(evictIdx + 1),
          row,
        ],
      }
    })
  },

  appendPhaseEvent(actionId: string, event: PhaseEvent): void {
    update(actionId, (t) => ({ ...t, phaseEvents: [...t.phaseEvents, event] }))
  },

  recordClassifierOutput(actionId: string, raw: unknown): void {
    update(actionId, (t) => ({ ...t, classifierOutputRaw: raw }))
  },

  endTurn(actionId: string, outcome: TurnCapture['outcome'], reason?: string): void {
    update(actionId, (t) => ({
      ...t,
      endedAt: Date.now(),
      outcome,
      ...(reason !== undefined ? { outcomeReason: reason } : {}),
    }))
  },
}
