import { and, eq } from 'drizzle-orm'

import { branches } from '@/lib/db'
import { refreshBranches } from '@/lib/stores'

import type { DbCtx } from '../types'

export type RenameBranchResult =
  | { status: 'ok' }
  | { status: 'rejected'; code: 'empty' | 'missing' }

/**
 * Stores the name trimmed at its ends; names needn't be unique. Unlogged, like every write above
 * the delta log: no delta, no undo, no gate. Throws a failed read or write.
 */
export async function renameBranch(
  input: { storyId: string; branchId: string; name: string },
  ctx: DbCtx,
): Promise<RenameBranchResult> {
  const name = input.name.trim()
  if (name === '') return { status: 'rejected', code: 'empty' }
  const ofStory = and(eq(branches.id, input.branchId), eq(branches.storyId, input.storyId))
  // An update that matches no row succeeds silently, so a missing or foreign branch is read first.
  const [row] = await ctx.db.select({ id: branches.id }).from(branches).where(ofStory)
  if (row == null) return { status: 'rejected', code: 'missing' }
  await ctx.runInTransaction([ctx.db.update(branches).set({ name }).where(ofStory).toSQL()])
  await refreshBranches(ctx.db, input.storyId)
  return { status: 'ok' }
}
