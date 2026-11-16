import { and, desc, eq, inArray } from 'drizzle-orm'

import { chunked, deltas, storyEntries, type Delta } from '@/lib/db'
import { selectUndoTarget } from '@/lib/undo'

import { resolveInvalidationForDeltas } from './classifier-facts'
import { headUndoGroup } from './undo'
import { reversalImpactOf, type ChapterDeletePreview } from '../chapters/chapter-delete-preview'
import { withBranchWriteShared } from '../delta/branch-write-lock'
import { ReversalIntegrityError } from '../delta/reverse-replay'
import { selectReversalSet } from '../delta/row-closure'
import type { DbCtx } from '../types'

const UNDO_IMPACT_LOCK_ID = 'undo-impact'

/** What a press of undo would reverse right now: its action's rows, newest first. */
export type UndoTargetRead = {
  actionId: string
  deltas: Delta[]
  /** The position of every entry the group writes or anchors on, for History's `entry #n`. */
  entryPositions: Readonly<Record<string, number>>
}

/** The group the next undo reverses, read for its label and confirm as undo itself reads it. */
export async function readUndoTarget(branchId: string, ctx: DbCtx): Promise<UndoTargetRead | null> {
  const group = await headUndoGroup(branchId, ctx)
  const target = selectUndoTarget(group)
  if (target == null) return null
  return {
    actionId: target.actionId,
    deltas: group,
    entryPositions: await positionsOf(branchId, group, ctx),
  }
}

async function positionsOf(
  branchId: string,
  group: readonly Delta[],
  ctx: Pick<DbCtx, 'db'>,
): Promise<Record<string, number>> {
  const ids = new Set<string>()
  for (const d of group) {
    if (d.targetTable === 'story_entries') ids.add(d.targetId)
    if (d.entryId != null) ids.add(d.entryId)
  }
  const positions: Record<string, number> = {}
  for (const chunk of chunked([...ids])) {
    const rows = await ctx.db
      .select({ id: storyEntries.id, position: storyEntries.position })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, branchId), inArray(storyEntries.id, chunk)))
    for (const row of rows) positions[row.id] = row.position
  }
  return positions
}

/**
 * The confirm's impact lines for undoing a close, its re-run or its kept work: the chapter delete
 * confirm's, counted over the set this undo would reverse. Null when the set can't be read, so the
 * confirm falls back to listing the group's rows.
 */
export async function readUndoImpact(
  branchId: string,
  actionId: string,
  ctx: DbCtx,
): Promise<Pick<ChapterDeletePreview, 'createdLore' | 'otherChanges'> | null> {
  return withBranchWriteShared(branchId, UNDO_IMPACT_LOCK_ID, async () => {
    const group = (await ctx.db
      .select()
      .from(deltas)
      .where(and(eq(deltas.branchId, branchId), eq(deltas.actionId, actionId)))
      .orderBy(desc(deltas.logPosition))) as Delta[]
    if (group.length === 0) return null
    const invalidation = await resolveInvalidationForDeltas(branchId, group, ctx)
    if (invalidation.status === 'unreadable') return null
    try {
      const set = await selectReversalSet(ctx, {
        branchId,
        target: group,
        sweep: invalidation.rows,
      })
      return await reversalImpactOf(branchId, set, group, ctx)
    } catch (e) {
      if (e instanceof ReversalIntegrityError) return null
      throw e
    }
  })
}
