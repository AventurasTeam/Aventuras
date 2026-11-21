import { generationStore } from '@/lib/stores'

import { requireCloseRange, setCloseFloor } from './close-intermediates'
import {
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  reverseCloseForRerun,
} from '../runtime/action-port'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult } from '../types'

/**
 * C2 → reversal (chapter-close.md → Re-running a close, Run order step 2): a re-run reverses the
 * chapter's lore work, journaled, with the branch held exclusive so no preview's reads straddle
 * it (generation-pipeline.md → Branch write lock). A close passes through.
 */
export async function* closeReversalPhase(
  ctx: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
  if (!generationStore.getTxState().pendingRerun.has(ctx.branchId)) return { status: 'completed' }
  const range = requireCloseRange(ctx)
  if ('status' in range) return range
  await holdBranchWriteExclusive(ctx.branchId, ctx.actionId)
  try {
    // Read once the hold is granted: a Cancel that landed while it queued costs no reversal.
    if (ctx.abortSignal.aborted) return { status: 'aborted' }
    const { floor } = await reverseCloseForRerun(
      { branchId: ctx.branchId, chapterId: range.chapterId, actionId: ctx.actionId },
      ctx,
    )
    setCloseFloor(ctx.intermediates, floor)
    return { status: 'completed' }
  } finally {
    releaseBranchWriteExclusive(ctx.branchId, ctx.actionId)
  }
}
