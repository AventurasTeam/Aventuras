import { and, count, eq, inArray, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { branches, listVecFamilyTables, storyEntries, type SqlOp } from '@/lib/db'

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
    .select({ storyId: branches.storyId })
    .from(branches)
    .where(eq(branches.id, branchId))
  if (!branch) return refused(DELETE_BRANCH_REFUSAL.missing)
  const vecTables = await listVecFamilyTables(ctx.db)

  await ctx.runInTransaction([
    ...branchRowDeleteOps(ctx.db, [branchId], vecTables),
    reparentChildrenOp(ctx.db, branchId),
    ctx.db.delete(branches).where(eq(branches.id, branchId)).toSQL(),
  ])
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
