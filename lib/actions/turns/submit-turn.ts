import { desc, eq } from 'drizzle-orm'

import { storyEntries, type EntryMetadata } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { runPipeline, type RunCtx } from '@/lib/pipeline'
import { undoRedoStore } from '@/lib/stores'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './pipeline'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { DeltaReplayError, reverseReplayDeltas } from '../delta/reverse-replay'
import type { DbCtx } from '../types'

export type SubmitTurnMeta = { content: string; composerMode: string }

// This app is local-first, single-process (no BaaS/backend serving concurrent
// writers — data-model.md), so an in-process per-branch queue is a complete
// fix, not a partial mitigation: it's the only place two submitTurn calls for
// the same branch could ever interleave a MAX(position) read with an insert —
// the user_action's own read here, or narrativePhase's read for the ai_reply
// (pipeline.ts), which runs inside the same queued turn below.
const branchQueues = new Map<string, Promise<unknown>>()

function withBranchQueue<T>(branchId: string, fn: () => Promise<T>): Promise<T> {
  const prior = branchQueues.get(branchId) ?? Promise.resolve()
  const result = prior.then(fn, fn)
  branchQueues.set(
    branchId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
}

export async function submitTurn(
  ids: { storyId: string; branchId: string },
  meta: SubmitTurnMeta,
  ctx: DbCtx,
): ReturnType<typeof runPipeline> {
  ensurePerTurnPipelineRegistered()

  return withBranchQueue(ids.branchId, async () => {
    // Shared across the user_action's delta and the pipeline run it kicks off,
    // so CTRL-Z reverses the whole turn as one group (milestone.md C6).
    const turnActionId = generateId('act')

    // Tail position from committed rows, not the in-memory store's count: real
    // branches have position gaps, so a count lands mid-story and collides.
    // Queued per-branch so a second submit can't read the same MAX before the
    // first one's insert lands.
    const [tail] = await ctx.db
      .select({ position: storyEntries.position, metadata: storyEntries.metadata })
      .from(storyEntries)
      .where(eq(storyEntries.branchId, ids.branchId))
      .orderBy(desc(storyEntries.position))
      .limit(1)
    const position = (tail?.position ?? 0) + 1
    const entryId = generateId('entry')
    const createdAt = Date.now()
    const metadata: EntryMetadata = {
      sceneEntities: [],
      currentLocationId: null,
      worldTime: tail?.metadata?.worldTime ?? 0,
    }

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
    // A second unrelated action clears the redo stack (data-model.md).
    undoRedoStore.clear()

    const runCtx: RunCtx = {
      storyId: ids.storyId,
      branchId: ids.branchId,
      actionId: turnActionId,
      db: ctx.db,
      runInTransaction: ctx.runInTransaction,
    }
    // Held for the whole run, not just the user_action insert above:
    // narrativePhase (pipeline.ts) does its own MAX(position)+1 read for the
    // ai_reply, which needs the same per-branch exclusion.
    const runResult = await runPipeline(PER_TURN_KIND, runCtx)
    if (runResult.outcome === 'rejected') {
      // A rejected admission never reaches abortRun (orchestrator.ts) — no run
      // was ever reserved — so the user_action committed above is never
      // reversed the way a failed/aborted run's is (C6). Reverse it here so no
      // orphaned entry survives a turn that never actually started.
      try {
        await reverseReplayDeltas(turnActionId, ctx)
      } catch (e) {
        // Deltas are reversed even if the post-commit store sync failed; the
        // caller still sees the rejection, same tolerance abortRun applies.
        if (!(e instanceof DeltaReplayError)) throw e
      }
    }
    return runResult
  })
}
