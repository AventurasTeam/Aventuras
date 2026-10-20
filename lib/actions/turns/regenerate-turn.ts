import { and, desc, eq, lt, ne } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { isStorySwapPending, withTurnAdmission } from '@/lib/embedder-swap'
import { generateId } from '@/lib/ids'
import { ensurePerTurnPipelineRegistered, type RejectedStart, type TxResult } from '@/lib/pipeline'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import {
  DeltaReplayError,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
} from '../delta/reverse-replay'
import {
  resolveSweep,
  reversalRefused,
  rollbackCountsOf,
  sameRollbackCounts,
  type CountsChangedRejection,
  type RollbackCounts,
  type StoryEntryRejection,
} from '../story-entries/operational'
import { bracketProseReversal } from '../story-entries/prose-reversal'
import { STORY_ENTRY_REJECTION } from '../story-entries/register'
import type { DbCtx } from '../types'
import { withBranchQueue, withPendingTurn } from './branch-queue'

/**
 * Why a regenerate refused. Distinct from `reason` (a diagnostic string): the
 * host picks user-facing copy from this, and the classes differ in what the
 * user can do — wait, resume a swap, check the counts again, or nothing at all.
 */
export type RegenerateRejectionCode =
  | 'embedder-swap'
  | 'generation-in-flight'
  | 'branch-not-loaded'
  | 'not-an-ai-reply'
  | 'no-origin'
  | 'sweep-refused'
  | 'counts-changed'

export type RegenerateTurnResult =
  | {
      status: 'rejected'
      code: RegenerateRejectionCode
      reason: string
      /** With `counts-changed`: the set as it stands now, for the confirm to show. */
      counts?: RollbackCounts
    }
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

const IN_FLIGHT_REJECTION = {
  status: 'rejected',
  code: 'generation-in-flight',
  reason: 'generation in flight',
} as const

async function sweepFrom(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
  expectedCounts?: RollbackCounts,
): Promise<{ status: 'ok' } | StoryEntryRejection | CountsChangedRejection> {
  const swept = await resolveSweep(branchId, targetId, ctx)
  if ('status' in swept) return swept
  // Compared with the set this sweep reverses, so the consent covers exactly what goes.
  if (expectedCounts) {
    const counts = rollbackCountsOf(swept.set)
    if (!sameRollbackCounts(counts, expectedCounts))
      return {
        status: 'rejected',
        code: STORY_ENTRY_REJECTION.countsChanged,
        reason: 'regenerate counts changed since the confirm opened',
        counts,
      }
  }
  try {
    await reverseAndPruneDeltaRows(swept.set, ctx, { keepRedoExact: false }, swept.clampOps)
  } catch (e) {
    if (!(e instanceof ReversalIntegrityError)) throw e
    return reversalRefused(branchId, e)
  }
  return { status: 'ok' }
}

export async function regenerateTurn(
  ids: { storyId: string; branchId: string },
  replyEntryId: string,
  ctx: DbCtx,
  opts?: { expectedCounts?: RollbackCounts },
): Promise<RegenerateTurnResult> {
  ensurePerTurnPipelineRegistered()

  return withBranchQueue(ids.branchId, async () => {
    const admission = await withTurnAdmission(
      ids.storyId,
      async (): Promise<RegenerateTurnResult> => {
        if (isStorySwapPending(ids.storyId)) return SWAP_REJECTION
        // Every regenerate is a head reversal: a pass or a close holding the gate is interrupted.
        if (generationStore.isHeadReversalBlocked(ids.branchId)) return IN_FLIGHT_REJECTION
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

        // Re-checked past the reads, synchronously with the mark and the bracket below: a reversal
        // opened during them would otherwise throw this one out of its bracket as re-entry.
        if (generationStore.isHeadReversalBlocked(ids.branchId)) return IN_FLIGHT_REJECTION
        return withPendingTurn(ids.branchId, async (startTurn) => {
          let swept: { status: 'ok' } | StoryEntryRejection | CountsChangedRejection
          try {
            swept = await bracketProseReversal(ids.branchId, () =>
              sweepFrom(ids.branchId, replyEntryId, ctx, opts?.expectedCounts),
            )
          } catch (error) {
            if (error instanceof DeltaReplayError && error.committed) undoRedoStore.clear()
            throw error
          }
          if (swept.status === 'rejected')
            return 'counts' in swept
              ? {
                  status: 'rejected',
                  code: 'counts-changed',
                  reason: swept.reason,
                  counts: swept.counts,
                }
              : { status: 'rejected', code: 'sweep-refused', reason: swept.reason }
          // A regenerate is a new unrelated action (data-model.md); the discarded
          // take is not redo-restorable.
          undoRedoStore.clear()

          // No input threading: narrativePhase (per-turn.ts) reads its prompt from
          // the branch tail and its insert position from MAX(position). Post-sweep the
          // surviving user_action is that tail — provided the caller cleared any
          // system tail first, which MAX(position) would otherwise insert after.
          const result = await startTurn({
            storyId: ids.storyId,
            actionId: generateId('act'),
            db: ctx.db,
            runInTransaction: ctx.runInTransaction,
          })

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
        })
      },
    )
    return admission.admitted ? admission.value : SWAP_REJECTION
  })
}
