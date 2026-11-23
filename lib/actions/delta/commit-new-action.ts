import type { SqlOp } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { undoRedoStore } from '@/lib/stores'

import type { DbCtx } from '../types'
import type { ReversalIntegrityError } from './replay-errors'
import { DeltaReplayError, reverseAndPruneDeltaRows } from './reverse-replay'
import type { ReversalSet } from './row-closure'

export function logReversalRefused(branchId: string, e: ReversalIntegrityError): void {
  logger.error('action_layer.reversal_refused', { branchId, refusal: e.refusal, reason: e.message })
}

// A second unrelated action clears its branch's redo stack (data-model.md). That holds when only
// the store sync after the commit throws too: the action landed all the same. A refusal is not
// committed.
export async function commitNewAction(
  set: ReversalSet,
  ctx: DbCtx,
  extraOps: readonly SqlOp[],
): Promise<void> {
  try {
    await reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: false }, extraOps)
  } catch (e) {
    if (e instanceof DeltaReplayError && e.committed) undoRedoStore.clear(set.branchId)
    throw e
  }
  undoRedoStore.clear(set.branchId)
}
