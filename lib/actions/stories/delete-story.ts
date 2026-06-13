import { eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import {
  branchEraFlips,
  branches,
  chapters,
  characterRelationships,
  deltas,
  entities,
  entryAssets,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  probeCaptures,
  stories,
  storyEntries,
  threads,
  translations,
} from '@/lib/db'
import { rehydrateStories } from '@/lib/stores'

import type { DbCtx } from '../types'

// Branch-scoped owned tables. vault_calendars (shared) and assets (content-addressed
// blobs, GC-owned by M4/M9 + M9.3) are intentionally absent — see docs/implementation/triage.md.
export const BRANCH_SCOPED: (SQLiteTable & { branchId: SQLiteColumn })[] = [
  storyEntries,
  entities,
  characterRelationships,
  lore,
  threads,
  happenings,
  happeningInvolvements,
  happeningAwareness,
  chapters,
  branchEraFlips,
  translations,
  probeCaptures,
  deltas,
  entryAssets,
]

/** Transactional cascade of a story's entire owned graph, child -> parent. No DB-level FK cascade exists. */
export async function deleteStory(storyId: string, ctx: DbCtx): Promise<void> {
  const branchRows = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.storyId, storyId))
  const branchIds = branchRows.map((b) => b.id)

  const ops = []
  if (branchIds.length > 0) {
    for (const table of BRANCH_SCOPED) {
      ops.push(ctx.db.delete(table).where(inArray(table.branchId, branchIds)).toSQL())
    }
  }
  ops.push(ctx.db.delete(pipelineRuns).where(eq(pipelineRuns.storyId, storyId)).toSQL())
  ops.push(ctx.db.delete(branches).where(eq(branches.storyId, storyId)).toSQL())
  ops.push(ctx.db.delete(stories).where(eq(stories.id, storyId)).toSQL())

  await ctx.runInTransaction(ops)
  await rehydrateStories(ctx.db)
}
