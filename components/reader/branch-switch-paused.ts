import { isUserEditBlocked, type TxState } from '@/lib/stores'

/**
 * Whether the branch navigator's rows are paused. The gate is read without the reader's branch: a
 * branch held until a restart pauses nothing, so switching away from it stays live.
 */
export function branchSwitchPaused(input: {
  txState: TxState
  dispatchInFlight: boolean
  held: boolean
}): boolean {
  return isUserEditBlocked(input.txState) || input.dispatchInFlight || input.held
}
