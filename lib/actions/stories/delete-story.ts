import { eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import {
  branchEraFlips,
  branches,
  deleteBranchVecOps,
  listTableNames,
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
  reversalJournals,
  stories,
  storyEntries,
  threads,
  translations,
  wizardSessions,
  type SqlOp,
} from '@/lib/db'
import { embedderSwapStore, generationStore, rehydrateStories, undoRedoStore } from '@/lib/stores'

import type { DbCtx } from '../types'

// Branch-scoped owned tables, cleared with a branch or a whole story.
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
  reversalJournals,
  // Dropping these rows can orphan an asset; orphans aren't trashed yet (M9.3).
  entryAssets,
  pipelineRuns,
]

/** Ops deleting the given branches' rows from every branch-scoped table and listed vec family. */
export function branchRowDeleteOps(
  db: DbCtx['db'],
  branchIds: readonly string[],
  tableNames: readonly string[],
): SqlOp[] {
  if (branchIds.length === 0) return []
  return [
    // Unchunked: one bind per branch, and a branch set grows only by an explicit fork.
    ...BRANCH_SCOPED.map((table) =>
      db
        .delete(table)
        .where(inArray(table.branchId, [...branchIds]))
        .toSQL(),
    ),
    // vec0 tables are virtual, so they are absent from dbSchema and the deletes above can't reach
    // them; without this their rows outlive the branch.
    ...deleteBranchVecOps(tableNames, branchIds),
  ]
}

export type DeleteStoryResult = { status: 'deleted' } | { status: 'rejected'; code: 'story-busy' }

/** Transactional cascade of a story's entire owned graph, child -> parent. No DB-level FK cascade exists. */
export async function deleteStory(
  storyId: string,
  ctx: DbCtx,
  // Injected for tests, which drive sqlite directly rather than through the
  // platform bridge this resolves to at runtime.
  listTables: () => Promise<string[]> = listTableNames,
): Promise<DeleteStoryResult> {
  const branchRows = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.storyId, storyId))
  const branchIds = branchRows.map((b) => b.id)

  const ops: SqlOp[] = []
  if (branchIds.length > 0) ops.push(...branchRowDeleteOps(ctx.db, branchIds, await listTables()))
  // Run rows older than pipeline_runs.branch_id may name no branch; they go by their story.
  ops.push(ctx.db.delete(pipelineRuns).where(eq(pipelineRuns.storyId, storyId)).toSQL())
  // A draft carries a wizard_sessions row keyed by its story id.
  ops.push(ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, storyId)).toSQL())
  ops.push(ctx.db.delete(branches).where(eq(branches.storyId, storyId)).toSQL())
  ops.push(ctx.db.delete(stories).where(eq(stories.id, storyId)).toSQL())

  // No await from here to the batch's post: a run, a pending turn, a turn's body or a reversal on
  // the story would go on writing to rows the batch removes.
  if (generationStore.isAnyStoryBranchBusy(storyId, branchIds))
    return { status: 'rejected', code: 'story-busy' }
  await ctx.runInTransaction(ops)
  // A future importer that keeps source ids would otherwise inherit this story's stale Later.
  embedderSwapStore.clearDeferredUpgradeFor(storyId)
  // In memory and keyed by branch: a deleted branch's records would otherwise outlive it.
  for (const branchId of branchIds) {
    generationStore.dropBranchRecords(branchId)
    undoRedoStore.drop(branchId)
  }
  await rehydrateStories(ctx.db)
  return { status: 'deleted' }
}
