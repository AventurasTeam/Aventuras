import { isHeadReversalBlocked, type TxState } from '@/lib/stores'

/**
 * The ⟳ tap's synchronous guard. The orchestrator admits a refresh during a prose reversal or a
 * pending Send, and the strip re-renders disabled a frame late, so the tap checks both itself.
 */
export function suggestionRefreshBlocked(
  txState: TxState,
  branchId: string,
  dispatchInFlight: boolean,
): boolean {
  return dispatchInFlight || isHeadReversalBlocked(txState, branchId)
}
