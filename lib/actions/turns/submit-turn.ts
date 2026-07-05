import { eq, sql } from 'drizzle-orm'

import { storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { runPipeline, type RunCtx } from '@/lib/pipeline'

import { applyDeltaAction } from '../delta/apply-delta-action'
import type { DbCtx } from '../types'
import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './pipeline'

export type SubmitTurnMeta = { content: string; composerMode: string }

export async function submitTurn(
  ids: { storyId: string; branchId: string },
  meta: SubmitTurnMeta,
  ctx: DbCtx,
): ReturnType<typeof runPipeline> {
  ensurePerTurnPipelineRegistered()

  // Tail position from committed rows, not the in-memory store's count: real
  // branches have position gaps, so a count lands mid-story and collides.
  const [tail] = await ctx.db
    .select({ next: sql<number>`COALESCE(MAX(${storyEntries.position}), 0) + 1` })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, ids.branchId))
  const position = tail?.next ?? 1
  const entryId = generateId('entry')
  const createdAt = Date.now()
  // Shared across the user_action's delta and the pipeline run it kicks off, so
  // CTRL-Z reverses the whole turn as one group (milestone.md C6).
  const turnActionId = generateId('act')

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
            metadata: null,
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

  const runCtx: RunCtx = {
    storyId: ids.storyId,
    branchId: ids.branchId,
    actionId: turnActionId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
  }
  return runPipeline(PER_TURN_KIND, runCtx)
}
