import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  awaitRunTerminal,
  generationStore,
  interruptMemoryRuns,
  selectMemoryRun,
  type RunState,
  type TxState,
} from '@/lib/stores'

/** The run Send's Cancel and composer describe: a turn, or Send's deferred pass, on `branchId`. */
export function findSendRun(txState: TxState, branchId: string): RunState | undefined {
  for (const run of txState.runs.values()) {
    if (run.branchId === branchId && (run.kind === PER_TURN_KIND || run.beforeTurn)) return run
  }
  return undefined
}

/** The pill's run: Send's run first, then the branch's pass or close, which owns it over a refresh. */
export function pillRunOf(txState: TxState, branchId: string): RunState | undefined {
  return findSendRun(txState, branchId) ?? selectMemoryRun(txState, { branchId })
}

/** Only a turn streams a card; Send's deferred pass is a structured call. */
export function sendRunStreams(txState: TxState, branchId: string): boolean {
  return findSendRun(txState, branchId)?.kind === PER_TURN_KIND
}

/** Cancels the Send run: a pass through the interrupt, anything else through awaitRunTerminal. */
export function cancelSendRun(run: RunState): Promise<void> {
  return run.interruptible
    ? interruptMemoryRuns(run.branchId)
    : awaitRunTerminal(run.kind, run.branchId, 'cancel')
}

/** The composer's Cancel, read at click time: a turn's commit can chain a pass in between. */
export function cancelComposerRun(branchId: string): Promise<void> {
  const run = findSendRun(generationStore.getTxState(), branchId)
  return run != null ? cancelSendRun(run) : Promise.resolve()
}

/** The pill's Cancel: its run, else the suggestion refresh it shows. */
export function cancelPillRun(branchId: string): Promise<void> {
  const run = pillRunOf(generationStore.getTxState(), branchId)
  return run != null
    ? cancelSendRun(run)
    : awaitRunTerminal(SUGGESTION_REFRESH_KIND, branchId, 'cancel')
}
