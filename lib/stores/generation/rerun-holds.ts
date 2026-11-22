import type { TxState } from './generation'

/**
 * chapter-close.md → Re-running a close, Head reversals: a re-run holds a reversal to a stamped
 * entry on its branch, which would take its chapter's end; an open-region one interrupts it.
 */
export function rerunHoldsReversal(
  txState: TxState,
  branchId: string,
  target: { chapterId: string | null },
): boolean {
  if (target.chapterId === null) return false
  for (const run of txState.runs.values())
    if (run.interruptible === 'rerun' && run.branchId === branchId) return true
  return false
}

/**
 * ⟳ waits out a re-run's whole chain, its catch-up passes included: a chip delta above the floor
 * would turn the re-run's CTRL-Z into an undone close.
 */
export function refreshHeldByRerun(txState: TxState, branchId: string): boolean {
  return txState.pendingRerun.has(branchId)
}
