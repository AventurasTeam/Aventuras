import { and, count, eq, inArray, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { branches, listVecFamilyTables, stories, storyEntries, type SqlOp } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  isStorySwapPending,
  readStorySwapPending,
  refreshEmbeddingStatus,
} from '@/lib/embedder-swap'
import {
  currentStoryStore,
  generationStore,
  isUserEditBlocked,
  refreshBranches,
  undoRedoStore,
} from '@/lib/stores'
import { messageOf } from '@/lib/thrown'

import type { DbCtx } from '../types'
import { branchRowDeleteOps } from './delete-story'

export const DELETE_BRANCH_REFUSAL = {
  missing: 'missing',
  current: 'current',
  gated: 'gated',
  swapPending: 'swap-pending',
} as const
export type DeleteBranchRefusalCode =
  (typeof DELETE_BRANCH_REFUSAL)[keyof typeof DELETE_BRANCH_REFUSAL]
export type DeleteBranchResult =
  | { status: 'deleted' }
  | { status: 'rejected'; code: DeleteBranchRefusalCode }

const own = alias(storyEntries, 'own')
const other = alias(storyEntries, 'other')
const owner = alias(branches, 'owner')
const sibling = alias(branches, 'sibling')
const former = alias(branches, 'former')

/** The branch's non-system entries whose id no other branch of the same story holds; 0 when gone. */
export async function countBranchOnlyEntries(
  branchId: string,
  ctx: Pick<DbCtx, 'db'>,
): Promise<number> {
  const storyOf = ctx.db
    .select({ storyId: owner.storyId })
    .from(owner)
    .where(eq(owner.id, branchId))
  // Within the story: a duplicate copies entry ids into another story, where they share nothing.
  const siblings = ctx.db
    .select({ id: sibling.id })
    .from(sibling)
    .where(and(eq(sibling.storyId, storyOf), ne(sibling.id, branchId)))
  // The siblings as an IN list keep this probe on the primary key; a join here scans.
  const heldElsewhere = ctx.db
    .select({ id: other.id })
    .from(other)
    .where(and(eq(other.id, own.id), inArray(other.branchId, siblings)))
  const [row] = await ctx.db
    .select({ n: count() })
    .from(own)
    .where(and(eq(own.branchId, branchId), ne(own.kind, 'system'), notExists(heldElsewhere)))
  return row?.n ?? 0
}

const refused = (code: DeleteBranchRefusalCode): DeleteBranchResult => ({
  status: 'rejected',
  code,
})

/** data-model.md → Branch model, Deleting a branch. Writes no delta, takes no lock, evicts nothing. */
export async function deleteBranch(branchId: string, ctx: DbCtx): Promise<DeleteBranchResult> {
  const [branch] = await ctx.db
    .select({ storyId: branches.storyId, currentBranchId: stories.currentBranchId })
    .from(branches)
    .innerJoin(stories, eq(stories.id, branches.storyId))
    .where(eq(branches.id, branchId))
  if (!branch) return refused(DELETE_BRANCH_REFUSAL.missing)
  const { storyId } = branch
  const vecTables = await listVecFamilyTables(ctx.db)
  // The marker as stored, for any story: the in-memory read below sees only the open story's.
  const swapStored = await readStorySwapPending(ctx.db, storyId)

  // No await from here to the batch's post, so nothing registers between a check and the write.
  const openBranchId = currentStoryStore.getCurrentStory()?.branchId
  if (branchId === branch.currentBranchId || branchId === openBranchId)
    return refused(DELETE_BRANCH_REFUSAL.current)
  // No branch: a hold, on this branch or the open one, refuses nothing.
  if (isUserEditBlocked(generationStore.getTxState())) return refused(DELETE_BRANCH_REFUSAL.gated)
  // Read again in memory: a swap admitted during the reads above is in flight by now.
  if (swapStored || isStorySwapPending(storyId)) return refused(DELETE_BRANCH_REFUSAL.swapPending)

  await ctx.runInTransaction([
    // A switch can point the story here after the read above: the NULL title fails the batch then,
    // and matches no row otherwise.
    ctx.db
      .update(stories)
      .set({ title: sql`null` })
      .where(and(eq(stories.id, storyId), eq(stories.currentBranchId, branchId)))
      .toSQL(),
    ...branchRowDeleteOps(ctx.db, [branchId], vecTables),
    reparentChildrenOp(ctx.db, branchId),
    ctx.db.delete(branches).where(eq(branches.id, branchId)).toSQL(),
  ])
  generationStore.dropBranchRecords(branchId)
  undoRedoStore.drop(branchId)
  // A refresh replaces the store's story, so only the open story's list re-reads.
  if (currentStoryStore.getCurrentStory()?.storyId === storyId) {
    try {
      await refreshBranches(ctx.db, storyId)
    } catch (err) {
      // It logs its own read failures; the delete has landed, and a stale row refuses `missing`.
      logger.warn('app.branch_delete_refresh_failed', { storyId, branchId, error: messageOf(err) })
    }
    // Read again: a story opened during the refresh owns the stale count's single slot.
    if (currentStoryStore.getCurrentStory()?.storyId === storyId)
      await refreshEmbeddingStatus(storyId, ctx)
  }
  return { status: 'deleted' }
}

// Its children take its parent, read in the statement so it sees the batch's own snapshot. The
// self-FK is immediate, so this runs before the row's delete.
function reparentChildrenOp(db: DbCtx['db'], branchId: string): SqlOp {
  const formerParent = db
    .select({ parentBranchId: former.parentBranchId })
    .from(former)
    .where(eq(former.id, branchId))
  return db
    .update(branches)
    .set({ parentBranchId: sql`${formerParent}` })
    .where(eq(branches.parentBranchId, branchId))
    .toSQL()
}
