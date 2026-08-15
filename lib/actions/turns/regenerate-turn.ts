import { and, desc, eq, lt, ne } from 'drizzle-orm'

import { deltas, storyEntries, type Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import {
  ensurePerTurnPipelineRegistered,
  PER_TURN_KIND,
  runPipeline,
  type RunCtx,
} from '@/lib/pipeline'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import { isStorySwapPending, withTurnAdmission } from '../embedder-swap/app-deps'
import { resolveRollbackWindow } from '../story-entries/operational'
import { bracketProseReversal, classifierWatermarkClampOps } from '../story-entries/prose-reversal'
import type { DbCtx } from '../types'
import { withBranchQueue } from './branch-queue'

export type RegenerateTurnResult =
  | { status: 'rejected'; reason: string }
  | { status: 'ran'; result: Awaited<ReturnType<typeof runPipeline>>; userActionContent: string }

async function sweepFrom(branchId: string, targetId: string, ctx: DbCtx) {
  const win = await resolveRollbackWindow(branchId, targetId, ctx)
  if ('status' in win) return win
  const rows = (await ctx.db
    .select()
    .from(deltas)
    .where(win.where)
    .orderBy(desc(deltas.logPosition))) as Delta[]
  await reverseAndPruneDeltaRows(
    rows,
    ctx,
    classifierWatermarkClampOps(branchId, win.earliestRemovedPosition),
  )
  // A regenerate is a new unrelated action (data-model.md); the discarded take
  // is not redo-restorable.
  undoRedoStore.clear()
  return { status: 'ok' as const }
}

export async function regenerateTurn(
  ids: { storyId: string; branchId: string },
  replyEntryId: string,
  ctx: DbCtx,
): Promise<RegenerateTurnResult> {
  ensurePerTurnPipelineRegistered()

  return withBranchQueue(ids.branchId, async () => {
    const admission = await withTurnAdmission(
      ids.storyId,
      async (): Promise<RegenerateTurnResult> => {
        if (isStorySwapPending(ids.storyId)) return { status: 'rejected', reason: 'embedder-swap' }
        if (generationStore.isUserEditBlocked())
          return { status: 'rejected', reason: 'generation in flight' }
        if (entriesStore.getLoadedBranch() !== ids.branchId)
          return { status: 'rejected', reason: 'branch not loaded' }

        const [target] = await ctx.db
          .select()
          .from(storyEntries)
          .where(and(eq(storyEntries.branchId, ids.branchId), eq(storyEntries.id, replyEntryId)))
        if (target == null || target.kind !== 'ai_reply')
          return { status: 'rejected', reason: 'target is not an AI reply' }

        // The reply's positional predecessor is its originating user_action by
        // construction (one reply per action, consecutive positions, deletes
        // cascade forward). Validated before anything is destroyed.
        const [origin] = await ctx.db
          .select()
          .from(storyEntries)
          .where(
            and(
              eq(storyEntries.branchId, ids.branchId),
              lt(storyEntries.position, target.position),
              ne(storyEntries.kind, 'system'),
            ),
          )
          .orderBy(desc(storyEntries.position))
          .limit(1)
        if (origin == null || origin.kind !== 'user_action')
          return { status: 'rejected', reason: 'no originating user action' }

        const swept = await bracketProseReversal(ids.branchId, () =>
          sweepFrom(ids.branchId, replyEntryId, ctx),
        )
        if (swept.status === 'rejected') return { status: 'rejected', reason: swept.reason }

        const runCtx: RunCtx = {
          storyId: ids.storyId,
          branchId: ids.branchId,
          actionId: generateId('act'),
          db: ctx.db,
          runInTransaction: ctx.runInTransaction,
        }
        const result = await runPipeline(PER_TURN_KIND, runCtx)

        // Non-success converges to the M2 failed-turn state: the standing
        // user_action unwinds too, so Retry / draft-restore re-enter through
        // the normal submit path without duplicating the action.
        if (result.outcome !== 'completed') {
          const followUp = await bracketProseReversal(ids.branchId, () =>
            sweepFrom(ids.branchId, origin.id, ctx),
          )
          if (followUp.status === 'rejected')
            logger.warn('action_layer.regenerate_follow_up_sweep_rejected', {
              branchId: ids.branchId,
              entryId: origin.id,
              reason: followUp.reason,
            })
        }
        return { status: 'ran', result, userActionContent: origin.content }
      },
    )
    return admission.admitted ? admission.value : { status: 'rejected', reason: 'embedder-swap' }
  })
}
