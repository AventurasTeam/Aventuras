import { and, desc, eq, lt, ne } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import {
  ensurePerTurnPipelineRegistered,
  PER_TURN_KIND,
  runPipeline,
  type RejectedStart,
  type RunCtx,
  type TxResult,
} from '@/lib/pipeline'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { DeltaReplayError, reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import { isStorySwapPending, withTurnAdmission } from '../embedder-swap/app-deps'
import { resolveSweep, type StoryEntryRejection } from '../story-entries/operational'
import { bracketProseReversal } from '../story-entries/prose-reversal'
import type { DbCtx } from '../types'
import { withBranchQueue } from './branch-queue'

export type RegenerateTurnResult =
  | { status: 'rejected'; reason: string }
  | { status: 'ran'; result: TxResult | RejectedStart; userActionContent: string }

const SWAP_REJECTION = { status: 'rejected', reason: 'embedder-swap' } as const

async function sweepFrom(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<{ status: 'ok' } | StoryEntryRejection> {
  const swept = await resolveSweep(branchId, targetId, ctx)
  if ('status' in swept) return swept
  await reverseAndPruneDeltaRows(swept.rows, ctx, swept.clampOps)
  return { status: 'ok' }
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
        if (isStorySwapPending(ids.storyId)) return SWAP_REJECTION
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
        // A regenerate is a new unrelated action (data-model.md); the discarded
        // take is not redo-restorable.
        undoRedoStore.clear()

        const runCtx: RunCtx = {
          storyId: ids.storyId,
          branchId: ids.branchId,
          actionId: generateId('act'),
          db: ctx.db,
          runInTransaction: ctx.runInTransaction,
        }
        // No input threading: narrativePhase reads prompt + insert position from
        // the branch tail, and post-sweep the surviving user_action IS that tail.
        const result = await runPipeline(PER_TURN_KIND, runCtx)

        // Non-success converges to the M2 failed-turn state: the standing
        // user_action unwinds too, so Retry / draft-restore re-enter through
        // the normal submit path without duplicating the action.
        if (result.outcome !== 'completed') {
          try {
            const followUp = await bracketProseReversal(ids.branchId, () =>
              sweepFrom(ids.branchId, origin.id, ctx),
            )
            if (followUp.status === 'rejected')
              logger.warn('action_layer.regenerate_follow_up_sweep_rejected', {
                branchId: ids.branchId,
                entryId: origin.id,
                reason: followUp.reason,
              })
          } catch (e) {
            // A failed unwind must not cost the caller the run result and the
            // user's text: without them the host has no Retry content and no
            // draft to restore, the very state this convergence exists to avoid.
            if (!(e instanceof DeltaReplayError)) throw e
            logger.warn('action_layer.regenerate_follow_up_sweep_failed', {
              branchId: ids.branchId,
              entryId: origin.id,
              error: String(e),
            })
          }
        }
        return { status: 'ran', result, userActionContent: origin.content }
      },
    )
    return admission.admitted ? admission.value : SWAP_REJECTION
  })
}
