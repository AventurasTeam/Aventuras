import { and, desc, eq } from 'drizzle-orm'

import {
  chapters,
  deltas,
  parseRerunJournal,
  pipelineRuns,
  reversalJournals,
  type Delta,
  type RerunJournal,
  type SqlOp,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { readChapterCloseGroups } from '../chapters/close-groups'
import type { DbCtx } from '../types'
import { readCurrentRow } from './redo'
import { reverseAndPruneDeltaRows, type ReversePlan } from './reverse-replay'
import { selectReversalSet } from './row-closure'

// C1: a close writes no entries, so its deltas there are the chapter row, the report and the stamps.
const DIVIDER_TABLES: ReadonlySet<string> = new Set(['chapters', 'story_entries'])

const rowKey = (table: string, id: string): string => `${table}:${id}`

// Each row the plan writes, whole as it stands before the plan's transaction, or null when absent.
async function beforeImages(plan: ReversePlan, ctx: DbCtx): Promise<RerunJournal['rows']> {
  const rows: RerunJournal['rows'] = []
  const seen = new Set<string>()
  for (const { table, branchId, patch } of plan.patches) {
    const key = rowKey(table, patch.id)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      table,
      id: patch.id,
      before: await readCurrentRow(ctx, table, { branchId, targetId: patch.id }),
    })
  }
  return rows
}

// Every delta row the plan prunes or edits, as logged before it, once each.
function journaledDeltas(plan: ReversePlan): Delta[] {
  const byId = new Map<string, Delta>()
  for (const delta of [
    ...plan.prunedDeltas,
    ...plan.reownedDeltas,
    ...plan.rewrittenHolders,
    ...plan.survivorRewrites.map((rewrite) => rewrite.delta),
  ])
    if (!byId.has(delta.id)) byId.set(delta.id, delta)
  return [...byId.values()]
}

// The highest position the plan leaves on the branch. The top |pruned| + 1 rows hold it whenever
// one is left; a MAX over every row would count a pruned delta above it.
async function floorAfter(plan: ReversePlan, branchId: string, ctx: DbCtx): Promise<number> {
  const pruned = new Set(plan.prunedDeltas.map((delta) => delta.id))
  const top = await ctx.db
    .select({ id: deltas.id, logPosition: deltas.logPosition })
    .from(deltas)
    .where(eq(deltas.branchId, branchId))
    .orderBy(desc(deltas.logPosition))
    .limit(pruned.size + 1)
  return top.find((row) => !pruned.has(row.id))?.logPosition ?? 0
}

/**
 * Reverses the chapter's lore work and journals its before-images in one transaction (C13).
 * The journal and the run marker's `rerun_chapter_id` lead the transaction. The caller holds the
 * branch exclusive, so the reads before the transaction stand.
 */
export async function reverseCloseForRerun(
  args: { branchId: string; chapterId: string; actionId: string },
  ctx: DbCtx,
): Promise<{ floor: number }> {
  const { branchId, chapterId, actionId } = args
  const [chapter] = await ctx.db
    .select({ sequenceNumber: chapters.sequenceNumber })
    .from(chapters)
    .where(and(eq(chapters.branchId, branchId), eq(chapters.id, chapterId)))
  if (!chapter) throw new Error(`reverseCloseForRerun: no chapter ${branchId}:${chapterId}`)
  const groups = await readChapterCloseGroups(branchId, chapterId, ctx)
  const set = await selectReversalSet(ctx, {
    branchId,
    target: groups.filter((delta) => !DIVIDER_TABLES.has(delta.targetTable)),
  })
  const written: { journal?: RerunJournal } = {}
  await reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: false }, [], undefined, {
    opsFromPlan: async (plan): Promise<SqlOp[]> => {
      const journal = parseRerunJournal({
        version: 1,
        chapterId,
        chapterNumber: chapter.sequenceNumber,
        floor: await floorAfter(plan, branchId, ctx),
        rows: await beforeImages(plan, ctx),
        deltas: journaledDeltas(plan),
        journals: plan.droppedJournals.map((held) => ({
          actionId: held.actionId,
          journal: held.journal,
          createdAt: held.createdAt,
        })),
      })
      written.journal = journal
      return [
        ctx.db
          .insert(reversalJournals)
          .values({ actionId, branchId, journal, createdAt: Date.now() })
          .toSQL(),
        ctx.db
          .update(pipelineRuns)
          .set({ rerunChapterId: chapterId })
          .where(eq(pipelineRuns.actionId, actionId))
          .toSQL(),
      ]
    },
  })
  const { journal } = written
  if (!journal) throw new Error('reverseCloseForRerun: the reversal committed without its journal')
  logger.debug(
    'action_layer.rerun_journal_written',
    {
      branchId,
      chapterId,
      floor: journal.floor,
      rows: journal.rows.length,
      deltas: journal.deltas.length,
      journals: journal.journals.length,
    },
    { actionId },
  )
  return { floor: journal.floor }
}
