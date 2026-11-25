import { and, count, eq, inArray, ne, notExists } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { branches, storyEntries } from '@/lib/db'

import type { DbCtx } from '../types'

const own = alias(storyEntries, 'own')
const other = alias(storyEntries, 'other')
const owner = alias(branches, 'owner')
const sibling = alias(branches, 'sibling')

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
