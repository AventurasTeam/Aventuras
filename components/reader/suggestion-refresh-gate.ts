import { generationGateReason } from '@/components/story-settings/generation-run'
import { CHAPTER_CLOSE_RERUN } from '@/lib/chapters'
import {
  isBranchHeld,
  isHeadReversalBlocked,
  refreshHeldByRerun,
  RERUN_HELD,
  type TxState,
} from '@/lib/stores'

/**
 * The ⟳ tap's synchronous guard: the orchestrator admits a refresh during a prose reversal or a
 * pending Send and the strip disables a frame late, so the tap checks both, and a re-run's chain.
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
 * Why ⟳ alone is held: a re-run's chain, catch-up pass included, or its branch held until restart;
 * a refresh's chip delta would sit above the re-run's floor and its undo would undo the close.
 * Chip taps write nothing.
 */
export function suggestionRefreshHoldReason(
  txState: TxState,
  branchId: string,
): string | undefined {
  if (isBranchHeld(txState, branchId)) return generationGateReason(true, RERUN_HELD)
  return refreshHeldByRerun(txState, branchId)
    ? generationGateReason(true, CHAPTER_CLOSE_RERUN)
    : undefined
}
