import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type RunState = {
  runId: string
  kind: string
  gateBehavior: 'hard-gate' | 'no-gate'
  actionId: string
  storyId: string | null
  branchId: string
  abortController: AbortController
  currentPhase: string
  intermediates: Record<string, unknown>
  lastResult?: { status: 'completed' | 'aborted' | 'failed' }
  // Resolves when the run reaches commit or abort. Lets a context that did not
  // start the run (chapter-close drain, prose-reversal cancel, a yieldsTo abort)
  // await its terminal without holding the runPipeline promise.
  terminal: Promise<void>
  resolveTerminal: () => void
}

// reversalInProgress brackets a prose-reversal's wait->sweep window: while set it
// blocks a periodic-classifier start and forces isUserEditBlocked true.
export type TxState = { runs: Map<string, RunState>; reversalInProgress: boolean }

export function isUserEditBlocked(txState: TxState): boolean {
  if (txState.reversalInProgress) return true
  return [...txState.runs.values()].some((r) => r.gateBehavior === 'hard-gate')
}

type GenerationState = {
  txState: TxState
  startRun: (run: RunState) => void
  setCurrentPhase: (runId: string, phase: string) => void
  recordPhaseResult: (
    runId: string,
    phase: string,
    result: { status: 'completed' | 'aborted' | 'failed' },
  ) => void
  finishRun: (runId: string, successor?: RunState) => void
  abortRun: (runId: string) => void
  setReversalInProgress: (value: boolean) => void
  __reset: () => void
}

const store = createStore<GenerationState>()((set) => ({
  txState: { runs: new Map(), reversalInProgress: false },
  startRun: (run) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      runs.set(run.runId, run)
      return { txState: { ...s.txState, runs } }
    }),
  setCurrentPhase: (runId, phase) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      const r = runs.get(runId)
      if (r) runs.set(runId, { ...r, currentPhase: phase })
      return { txState: { ...s.txState, runs } }
    }),
  recordPhaseResult: (runId, _phase, result) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      const r = runs.get(runId)
      if (r) runs.set(runId, { ...r, lastResult: result })
      return { txState: { ...s.txState, runs } }
    }),
  finishRun: (runId, successor) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      runs.delete(runId)
      if (successor) runs.set(successor.runId, successor)
      return { txState: { ...s.txState, runs } }
    }),
  abortRun: (runId) =>
    set((s) => {
      const runs = new Map(s.txState.runs)
      runs.delete(runId)
      return { txState: { ...s.txState, runs } }
    }),
  setReversalInProgress: (value) =>
    set((s) => ({ txState: { ...s.txState, reversalInProgress: value } })),
  __reset: () => set({ txState: { runs: new Map(), reversalInProgress: false } }),
}))

function getTxState(): TxState {
  return store.getState().txState
}

function useGeneration<T>(selector: (s: { txState: TxState }) => T): T {
  return useStore(store, selector as (s: GenerationState) => T)
}

const api = store.getState()

export const generationStore = {
  useGeneration,
  getTxState,
  isUserEditBlocked: () => isUserEditBlocked(getTxState()),
  startRun: api.startRun,
  setCurrentPhase: api.setCurrentPhase,
  recordPhaseResult: api.recordPhaseResult,
  finishRun: api.finishRun,
  abortRun: api.abortRun,
  setReversalInProgress: api.setReversalInProgress,
  __reset: api.__reset,
}
