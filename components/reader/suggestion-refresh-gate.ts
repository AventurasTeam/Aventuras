import { generationGateReason } from '@/components/story-settings/generation-run'
import { CHAPTER_CLOSE_RERUN } from '@/lib/chapters'
import { isHeadReversalBlocked, refreshHeldByRerun, type TxState } from '@/lib/stores'

/**
 * The ⟳ tap's synchronous guard. The orchestrator admits a refresh during a prose reversal or a
 * pending Send, and the strip re-renders disabled a frame late, so the tap checks both itself,
 * and a re-run's chain with them.
 */
export function suggestionRefreshBlocked(
  txState: TxState,
  branchId: string,
  dispatchInFlight: boolean,
): boolean {
  return (
    dispatchInFlight ||
    isHeadReversalBlocked(txState, branchId) ||
    refreshHeldByRerun(txState, branchId)
  )
}

/**
 * Why ⟳ alone is held: a re-run's chain, its catch-up pass included, since a refresh's chip delta
 * would sit above the re-run's floor and its CTRL-Z would undo the close. Chip taps write nothing.
 */
export function suggestionRefreshHoldReason(
  txState: TxState,
  branchId: string,
): string | undefined {
  return refreshHeldByRerun(txState, branchId)
    ? generationGateReason(true, CHAPTER_CLOSE_RERUN)
    : undefined
}
