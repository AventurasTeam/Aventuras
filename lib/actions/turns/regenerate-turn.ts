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

/**
 * Why a regenerate refused. Distinct from `reason` (a diagnostic string): the
 * host picks user-facing copy from this, and the classes differ in what the
 * user can do — wait, resume a swap, or nothing at all.
 */
export type RegenerateRejectionCode =
  | 'embedder-swap'
  | 'generation-in-flight'
  | 'branch-not-loaded'
  | 'not-an-ai-reply'
  | 'no-origin'
  | 'sweep-refused'

export type RegenerateTurnResult =
  | { status: 'rejected'; code: RegenerateRejectionCode; reason: string }
  | {
      status: 'ran'
      result: TxResult | RejectedStart
      userActionContent: string
      /**
       * False when the follow-up unwind did not land, leaving the originating
       * user_action standing: the branch is NOT in the M2 failed-turn state, so
       * `userActionContent` must not be offered as a retryable submission — a
       * resend would duplicate the action. Always true when the run completed,
       * since no unwind is owed.
       */
      converged: boolean
    }

const SWAP_REJECTION = {
  status: 'rejected',
  code: 'embedder-swap',
  reason: 'embedder-swap',
} as const

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
          return {
            status: 'rejected',
            code: 'generation-in-flight',
            reason: 'generation in flight',
          }
        if (entriesStore.getLoadedBranch() !== ids.branchId)
          return { status: 'rejected', code: 'branch-not-loaded', reason: 'branch not loaded' }

        const [target] = await ctx.db
          .select()
          .from(storyEntries)
          .where(and(eq(storyEntries.branchId, ids.branchId), eq(storyEntries.id, replyEntryId)))
        if (target == null || target.kind !== 'ai_reply')
          return {
            status: 'rejected',
            code: 'not-an-ai-reply',
            reason: 'target is not an AI reply',
          }

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
          return { status: 'rejected', code: 'no-origin', reason: 'no originating user action' }

        let swept: { status: 'ok' } | StoryEntryRejection
        try {
          swept = await bracketProseReversal(ids.branchId, () =>
            sweepFrom(ids.branchId, replyEntryId, ctx),
          )
        } catch (error) {
          if (error instanceof DeltaReplayError && error.committed) undoRedoStore.clear()
          throw error
        }
        if (swept.status === 'rejected')
          return { status: 'rejected', code: 'sweep-refused', reason: swept.reason }
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
        // No input threading: narrativePhase (per-turn.ts) reads its prompt from
        // the branch tail and its insert position from MAX(position). Post-sweep the
        // surviving user_action is that tail — provided the caller cleared any
        // system tail first, which MAX(position) would otherwise insert after.
        const result = await runPipeline(PER_TURN_KIND, runCtx)

        // Non-success converges to the M2 failed-turn state: the standing
        // user_action unwinds too, so Retry / draft-restore re-enter through
        // the normal submit path without duplicating the action.
        let converged = true
        if (result.outcome !== 'completed') {
          try {
            const followUp = await bracketProseReversal(ids.branchId, () =>
              sweepFrom(ids.branchId, origin.id, ctx),
            )
            if (followUp.status === 'rejected') {
              // A refused sweep reverses nothing, so the user_action stands.
              converged = false
              logger.warn('action_layer.regenerate_follow_up_sweep_rejected', {
                branchId: ids.branchId,
                entryId: origin.id,
                reason: followUp.reason,
              })
            }
          } catch (e) {
            // A failed unwind must not cost the caller the run result and the
            // user's text: without them the host has no Retry content and no
            // draft to restore, the very state this convergence exists to avoid.
            if (!(e instanceof DeltaReplayError)) throw e
            // committed separates the two opposite recovery states: false leaves
            // the user_action standing, true leaves entriesStore stale instead —
            // and only the latter actually reached the converged state.
            converged = e.committed
            logger.warn('action_layer.regenerate_follow_up_sweep_failed', {
              branchId: ids.branchId,
              entryId: origin.id,
              committed: e.committed,
              error: String(e),
            })
          }
        }
        return { status: 'ran', result, userActionContent: origin.content, converged }
      },
    )
    return admission.admitted ? admission.value : SWAP_REJECTION
  })
}
