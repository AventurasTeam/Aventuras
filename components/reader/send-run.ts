import { PER_TURN_KIND } from '@/lib/pipeline'
import { awaitRunTerminal, interruptMemoryRuns, type RunState, type TxState } from '@/lib/stores'

/** The run Send's Cancel and composer describe: a turn, or Send's deferred pass, on `branchId`. */
export function findSendRun(txState: TxState, branchId: string): RunState | undefined {
  for (const run of txState.runs.values()) {
    if (run.branchId === branchId && (run.kind === PER_TURN_KIND || run.beforeTurn)) return run
  }
  return undefined
}

/** Cancels the Send run: a pass through the interrupt, anything else through awaitRunTerminal. */
export function cancelSendRun(run: RunState): Promise<void> {
  return run.interruptible
    ? interruptMemoryRuns(run.branchId)
    : awaitRunTerminal(run.kind, run.branchId, 'cancel')
}
