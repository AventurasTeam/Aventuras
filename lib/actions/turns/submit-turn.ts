import { storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { runPipeline, type RunCtx } from '@/lib/pipeline'
import { entriesStore } from '@/lib/stores'

import type { DbCtx } from '../types'
import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './pipeline'

export type SubmitTurnMeta = { content: string; composerMode: string }

export async function submitTurn(
  ids: { storyId: string; branchId: string },
  meta: SubmitTurnMeta,
  ctx: DbCtx,
): ReturnType<typeof runPipeline> {
  ensurePerTurnPipelineRegistered()

  const existing = [...entriesStore.getEntries().values()].filter(
    (e) => e.branchId === ids.branchId,
  )
  const position = existing.length + 1
  const entryId = generateId('entry')
  const createdAt = Date.now()

  await ctx.runInTransaction([
    ctx.db
      .insert(storyEntries)
      .values({
        id: entryId,
        branchId: ids.branchId,
        position,
        kind: 'user_action',
        content: meta.content,
        createdAt,
      })
      .toSQL(),
  ])
  entriesStore.patch(ids.branchId, {
    op: 'create',
    id: entryId,
    row: {
      id: entryId,
      branchId: ids.branchId,
      position,
      kind: 'user_action',
      content: meta.content,
      chapterId: null,
      metadata: null,
      createdAt,
    },
  })

  const runCtx: RunCtx = {
    storyId: ids.storyId,
    branchId: ids.branchId,
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
  }
  return runPipeline(PER_TURN_KIND, runCtx)
}
