import type { SubmitTurnResult } from '@/lib/actions'
import { logger } from '@/lib/diagnostics'
import {
  CLASSIFIER_HELD,
  PER_TURN_KIND,
  SUGGESTION_REFRESH_KIND,
  type PipelineError,
} from '@/lib/pipeline'
import {
  awaitRunTerminal,
  generationStore,
  interruptMemoryRuns,
  selectMemoryRun,
  type RunState,
  type TxState,
} from '@/lib/stores'

/** The run Send's Cancel and composer describe: a turn, or Send's owed work (its chain), on `branchId`. */
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

/** Only a turn streams a card; Send's owed work is structured calls. */
export function sendRunStreams(txState: TxState, branchId: string): boolean {
  return findSendRun(txState, branchId)?.kind === PER_TURN_KIND
}

/** Cancels the Send run: a pass through the interrupt, anything else through awaitRunTerminal. */
export function cancelSendRun(run: RunState): Promise<void> {
  return run.interruptible
    ? interruptMemoryRuns(run.branchId)
    : awaitRunTerminal(run.kind, run.branchId, 'cancel')
}

function turnPendingOn(txState: TxState, branchId: string): boolean {
  for (const turn of txState.pendingTurns) if (turn.branchId === branchId) return true
  return false
}

/**
 * The host's Send holds a pending turn with no run registered: before its owed pass registers,
 * and between that pass and the turn.
 */
export function sendGapOpen(txState: TxState, branchId: string, sendPending: boolean): boolean {
  return sendPending && turnPendingOn(txState, branchId) && findSendRun(txState, branchId) == null
}

/** Send's run swaps Send for Cancel, and so does its gap. */
export function composerShowsCancel(
  txState: TxState,
  branchId: string,
  sendPending: boolean,
): boolean {
  return findSendRun(txState, branchId) != null || sendGapOpen(txState, branchId, sendPending)
}

/**
 * Read at click time: a turn's commit can chain a pass in between. In Send's gap, cancels the
 * next run to register, or resolves if the mark ends with none.
 */
export function cancelComposerRun(branchId: string, sendPending: boolean): Promise<void> {
  const txState = generationStore.getTxState()
  const run = findSendRun(txState, branchId)
  if (run != null) return cancelSendRun(run)
  if (!sendGapOpen(txState, branchId, sendPending)) return Promise.resolve()
  return new Promise((resolve) => {
    const off = generationStore.subscribe(() => {
      const next = generationStore.getTxState()
      const registered = findSendRun(next, branchId)
      if (registered == null && turnPendingOn(next, branchId)) return
      off()
      if (registered == null) resolve()
      else void cancelSendRun(registered).then(resolve)
    })
  })
}

/** The pill's Cancel: its run, else the suggestion refresh it shows. */
export function cancelPillRun(branchId: string): Promise<void> {
  const run = pillRunOf(generationStore.getTxState(), branchId)
  return run != null
    ? cancelSendRun(run)
    : awaitRunTerminal(SUGGESTION_REFRESH_KIND, branchId, 'cancel')
}

/**
 * A Send cancelled during its owed work wrote nothing, so a failure entry cleared before it
 * can go back where it was (reader-composer.md → Custody of the turn's text).
 */
export function abortedBeforeTurn(result: SubmitTurnResult): boolean {
  return result.outcome === 'aborted' && result.beforeTurn === true
}

/** A pass that refused a Send (classifier.md → Failure policy): the hold, or why it failed. */
export type PassRefusal = { held: true } | { held: false; error: PipelineError | undefined }

/** Send's result only: a `failed` without `beforeTurn` is the turn's own, a close's closeRefusalOf's. */
export function passRefusalOf(result: SubmitTurnResult): PassRefusal | null {
  if (result.outcome === 'failed' && result.beforeTurn === true && result.work === 'pass')
    return { held: false, error: result.error }
  if (result.outcome === 'rejected' && result.blockedBy === CLASSIFIER_HELD) return { held: true }
  return null
}

/** A close that failed Send's owed work (chapter-close.md → Failure modes); a hold is a pass's. */
export function closeRefusalOf(
  result: SubmitTurnResult,
): { error: PipelineError | undefined } | null {
  if (result.outcome === 'failed' && result.beforeTurn === true && result.work === 'close')
    return { error: result.error }
  return null
}

/**
 * A Send that threw: logs it and writes its failure entry. When that write throws too, the text
 * goes back to the composer rather than leave no card and no draft. Never rejects.
 */
export async function reportSendThrow(
  branchId: string,
  error: unknown,
  writeEntry: (detail: string) => Promise<void>,
  handBack: () => void,
): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error)
  logger.error('pipeline.submit_failed', { branchId, error: detail })
  try {
    await writeEntry(detail)
  } catch (entryError) {
    logger.error('pipeline.submit_failure_entry_failed', {
      branchId,
      error: entryError instanceof Error ? entryError.message : String(entryError),
    })
    handBack()
  }
}
