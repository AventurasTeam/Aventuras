import { and, desc, eq, ne } from 'drizzle-orm'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { inheritedEntryMetadata, storyEntries, type EntryMetadata } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { isStorySwapPending, withTurnAdmission } from '@/lib/embedder-swap'
import { generateId } from '@/lib/ids'
import {
  ensurePerTurnPipelineRegistered,
  ensurePeriodicClassifierPipelineRegistered,
  runPipeline,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { DeltaReplayError, reverseReplayDeltas } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { withBranchQueue, withPendingTurn } from './branch-queue'

export type SubmitTurnMeta = { content: string; composerMode: string }

/** Send's deferred pass was cancelled, so the whole Send was, before it wrote anything. */
export type DeferredPassAborted = TxResult & { outcome: 'aborted'; beforeTurn: true }

/** `converged: false`: the refused user_action is still in the branch; never re-offer its text. */
export type SubmitTurnResult =
  | TxResult
  | DeferredPassAborted
  | (RejectedStart & { converged: boolean })

const SWAP_REJECTION = { outcome: 'rejected', blockedBy: 'embedder-swap', converged: true } as const

/**
 * Send's deferred work (generation-pipeline.md → chainsTo on predecessor): its own run with its
 * own actionId, awaited to its end so it commits before the turn's first write.
 */
function runDeferredPass(
  ids: { storyId: string; branchId: string },
  ctx: DbCtx,
): Promise<TxResult | RejectedStart> {
  ensurePeriodicClassifierPipelineRegistered()
  return runPipeline(PERIODIC_CLASSIFIER_KIND, {
    storyId: ids.storyId,
    branchId: ids.branchId,
    beforeTurn: true,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
  })
}

export async function submitTurn(
  ids: { storyId: string; branchId: string },
  meta: SubmitTurnMeta,
  ctx: DbCtx,
): Promise<SubmitTurnResult> {
  ensurePerTurnPipelineRegistered()

  return withBranchQueue(ids.branchId, async () => {
    const admission = await withTurnAdmission(ids.storyId, async () => {
      // Checked under the same admission as live swaps. The in-memory gate covers
      // this process; the marker still covers a swap recovered from an earlier one.
      if (isStorySwapPending(ids.storyId)) return SWAP_REJECTION

      return withPendingTurn(ids.branchId, async (startTurn): Promise<SubmitTurnResult> => {
        // Under the turn's mark, so no reversal interrupts Send's own deferred work.
        if (generationStore.getTxState().deferred.get(ids.branchId)?.pass) {
          const deferred = await runDeferredPass(ids, ctx)
          // A cancel cancels the whole Send and the work stays deferred; a pass that failed or
          // could not start lets the turn go ahead.
          if (deferred.outcome === 'aborted')
            return { ...deferred, outcome: 'aborted', beforeTurn: true }
        }

        // Shared across the user_action's delta and the pipeline run it kicks off,
        // so CTRL-Z reverses the whole turn as one group (milestone.md C6).
        const turnActionId = generateId('act')

        // Tail position from committed rows, not the in-memory store's count: real
        // branches have position gaps, so a count lands mid-story and collides.
        // Queued per-branch so a second submit can't read the same MAX before the
        // first one's insert lands.
        const [tail] = await ctx.db
          .select({ position: storyEntries.position })
          .from(storyEntries)
          .where(eq(storyEntries.branchId, ids.branchId))
          .orderBy(desc(storyEntries.position))
          .limit(1)
        // Scene state (membership, location, worldTime) inherits from the last
        // non-system entry: a system tail carries null metadata and would reset
        // it. M2 has no classifier, so this propagates the opening's values
        // forward until piggyback/classifier (M3+) emits fresh ones. Position
        // still comes from the overall tail so numbering never collides.
        const [sceneTail] = await ctx.db
          .select({ metadata: storyEntries.metadata })
          .from(storyEntries)
          .where(and(eq(storyEntries.branchId, ids.branchId), ne(storyEntries.kind, 'system')))
          .orderBy(desc(storyEntries.position))
          .limit(1)
        const position = (tail?.position ?? 0) + 1
        const entryId = generateId('entry')
        const createdAt = Date.now()
        const metadata: EntryMetadata = inheritedEntryMetadata(sceneTail?.metadata)

        const result = await applyDeltaAction(
          {
            action: {
              kind: 'createStoryEntry',
              source: 'user_edit',
              payload: {
                entry: {
                  id: entryId,
                  branchId: ids.branchId,
                  position,
                  kind: 'user_action',
                  content: meta.content,
                  chapterId: null,
                  metadata,
                  createdAt,
                },
              },
            },
            actionId: turnActionId,
            branchId: ids.branchId,
            entryId: null,
          },
          ctx,
        )
        if (result.status === 'rejected')
          throw new Error(`submitTurn: user_action write rejected: ${result.reason}`)

        // The branch queue spans the run, not just the insert above: narrativePhase (per-turn.ts)
        // does its own MAX(position)+1 read for the ai_reply.
        const runResult = await startTurn({
          storyId: ids.storyId,
          actionId: turnActionId,
          db: ctx.db,
          runInTransaction: ctx.runInTransaction,
        })
        if (runResult.outcome !== 'rejected') return runResult
        // A rejected admission never reaches abortRun (orchestrator.ts) — no run
        // was ever reserved — so the user_action committed above is never
        // reversed the way a failed/aborted run's is (C6). Reverse it here so no
        // orphaned entry survives a turn that never actually started.
        try {
          await reverseReplayDeltas(turnActionId, ctx)
          return { ...runResult, converged: true }
        } catch (e) {
          if (!(e instanceof DeltaReplayError)) throw e
          // Uncommitted leaves the user_action standing with no marker for boot to retry;
          // committed only leaves entriesStore stale, which the caller's reload clears.
          const fields = {
            branchId: ids.branchId,
            entryId,
            committed: e.committed,
            error: String(e.cause),
          }
          if (e.committed) logger.warn('action_layer.submit_rejected_reversal_failed', fields)
          else logger.error('action_layer.submit_rejected_reversal_failed', fields)
          return { ...runResult, converged: e.committed }
        }
      })
    })
    return admission.admitted ? admission.value : SWAP_REJECTION
  })
}
