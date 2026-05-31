import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import type { HttpCall, LogEntry, TurnCapture } from './types'

const LOG_ENTRIES_CAP = 500

type DiagnosticsState = {
  logEntries: LogEntry[]
  httpCalls: HttpCall[]
  turnCaptures: TurnCapture[]
  pushLog: (entry: LogEntry) => void
  __reset: () => void
}

const emptySlices = {
  logEntries: [] as LogEntry[],
  httpCalls: [] as HttpCall[],
  turnCaptures: [] as TurnCapture[],
}

export const diagnosticsStore = createStore<DiagnosticsState>()((set) => ({
  ...emptySlices,
  pushLog: (entry) =>
    set((state) => ({
      logEntries:
        state.logEntries.length >= LOG_ENTRIES_CAP
          ? [...state.logEntries.slice(state.logEntries.length - LOG_ENTRIES_CAP + 1), entry]
          : [...state.logEntries, entry],
    })),
  __reset: () => set({ ...emptySlices }),
}))

// "Off means off": the master-toggle off-write clears all three in-memory ring
// buffers atomically (observability spec). Persisted probe_captures untouched.
// Decoupled from the gate — the gate now lives in lib/diagnostics/gate.ts.
export function clearBuffers(): void {
  diagnosticsStore.setState({ logEntries: [], httpCalls: [], turnCaptures: [] })
}

type DiagnosticsReadState = Pick<DiagnosticsState, 'logEntries' | 'httpCalls' | 'turnCaptures'>

export function useDiagnosticsStore<T>(selector: (state: DiagnosticsReadState) => T): T {
  return useStore(diagnosticsStore, selector as (state: DiagnosticsState) => T)
}

export function getDiagnosticsSnapshot(): DiagnosticsReadState {
  const s = diagnosticsStore.getState()
  return { logEntries: s.logEntries, httpCalls: s.httpCalls, turnCaptures: s.turnCaptures }
}

export type { DiagnosticsState, DiagnosticsReadState }
