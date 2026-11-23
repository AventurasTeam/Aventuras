import { and, asc, desc, eq, gt } from 'drizzle-orm'

import {
  chapters,
  deltas,
  isEmbeddedSourceTable,
  parseRerunJournal,
  pipelineRuns,
  reversalJournals,
  type Delta,
  type RerunJournal,
  type SqlOp,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import { DIVIDER_TABLES, readChapterCloseGroups } from '../chapters/close-groups'
import type { DbCtx } from '../types'
import { vecSweepIdsOps, vecTableLister } from './delete-cascade'
import { readCurrentRow } from './redo'
import { branchKeyOf, resolveByTable, whereForDelta, type TableDescriptor } from './registry'
import { DeltaReplayError, type JournalOutcome } from './replay-errors'
import {
  replayFailure,
  reverseAndPruneDeltaRows,
  reverseReplayGroup,
  type PatchEmission,
  type ReversePlan,
} from './reverse-replay'
import { selectReversalSet, type ReversalSet } from './row-closure'

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

function logJournalWritten(
  journal: RerunJournal,
  { branchId, chapterId, actionId }: { branchId: string; chapterId: string; actionId: string },
): void {
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
}

/**
 * Reverses the chapter's lore work and journals its before-images in one transaction (C13); the
 * journal and the run marker's `rerun_chapter_id` lead it. Caller holds the branch exclusive.
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
  try {
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
  } catch (e) {
    // Committed: only the store sync failed, so the journal is on disk all the same.
    if (e instanceof DeltaReplayError && e.committed && written.journal)
      logJournalWritten(written.journal, args)
    throw e
  }
  const { journal } = written
  if (!journal) throw new Error('reverseCloseForRerun: the reversal committed without its journal')
  logJournalWritten(journal, args)
  return { floor: journal.floor }
}

/** How a re-run group's reversal ends, decided before its transaction. */
export type RerunWriteBack =
  | { outcome: 'none' }
  | { outcome: 'restored'; ops: readonly SqlOp[]; patches: readonly PatchEmission[] }
  | {
      outcome: 'undone'
      /** The chapter's close groups, for the caller to merge with `withCloseGroups`. */
      seed: readonly Delta[]
      /** The journal row's delete, when one exists. */
      ops: readonly SqlOp[]
      chapterId: string
      chapterNumber: number
      /** Why no write-back: the group is no longer whole, or no journal holds it. */
      journal: 'not-whole' | 'missing'
    }
  /** No journal and no chapter row left: the group reverses alone, undoing no close. */
  | { outcome: 'alone'; chapterId: string }

type UndoneClose = Extract<RerunWriteBack, { outcome: 'undone' }>

type FoundJournal = { branchId: string; journal: RerunJournal }

async function readJournal(
  actionId: string,
  branchId: string | null,
  ctx: DbCtx,
): Promise<FoundJournal | undefined> {
  const [row] = await ctx.db
    .select({ branchId: reversalJournals.branchId, journal: reversalJournals.journal })
    .from(reversalJournals)
    .where(
      branchId === null
        ? eq(reversalJournals.actionId, actionId)
        : and(eq(reversalJournals.branchId, branchId), eq(reversalJournals.actionId, actionId)),
    )
  return row === undefined
    ? undefined
    : { branchId: row.branchId, journal: parseRerunJournal(row.journal) }
}

function journalDelete(ctx: DbCtx, branchId: string, actionId: string): SqlOp {
  return ctx.db
    .delete(reversalJournals)
    .where(and(eq(reversalJournals.branchId, branchId), eq(reversalJournals.actionId, actionId)))
    .toSQL()
}

// Exact only while nothing but the group sits above the floor, at every position from floor + 1
// to its highest.
async function groupIsWhole(
  floor: number,
  branchId: string,
  group: readonly Delta[],
  ctx: DbCtx,
): Promise<boolean> {
  const own = new Set(group.map((delta) => delta.id))
  const above = await ctx.db
    .select({ id: deltas.id, logPosition: deltas.logPosition })
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), gt(deltas.logPosition, floor)))
    .orderBy(asc(deltas.logPosition))
  return (
    above.length === own.size &&
    above.every((row, i) => own.has(row.id) && row.logPosition === floor + 1 + i)
  )
}

function upsertRowOp(ctx: DbCtx, descriptor: TableDescriptor, row: Record<string, unknown>): SqlOp {
  const target = descriptor.branchCol ? [descriptor.branchCol, descriptor.idCol] : descriptor.idCol
  return ctx.db
    .insert(descriptor.table)
    .values(row)
    .onConflictDoUpdate({ target, set: row })
    .toSQL()
}

// Each restored row and delta takes the executing branch: a copied journal's JSON names the
// branch that wrote it.
async function writeBackOps(
  found: FoundJournal,
  actionId: string,
  ctx: DbCtx,
): Promise<{ ops: SqlOp[]; patches: PatchEmission[] }> {
  const { branchId, journal } = found
  const rowOps: SqlOp[] = []
  const patches: PatchEmission[] = []
  const removed = new Map<string, string[]>()
  // Newest last: the reversal put a deleted row back before the children its payload held, and
  // removed a created row's children before the row.
  for (const { table, id, before } of [...journal.rows].reverse()) {
    const entry = resolveByTable(table)
    if (!entry) throw new Error(`rerunWriteBack: unknown table ${table}`)
    const { descriptor } = entry
    if (before === null) {
      rowOps.push(
        ctx.db
          .delete(descriptor.table)
          .where(whereForDelta(descriptor, { branchId, targetId: id }))
          .toSQL(),
      )
      patches.push({ table, branchId, patch: { op: 'delete', id } })
      removed.set(table, [...(removed.get(table) ?? []), id])
      continue
    }
    const branchKey = branchKeyOf(descriptor)
    const row: Record<string, unknown> = {
      ...before,
      ...(branchKey === undefined ? {} : { [branchKey]: branchId }),
      // The drain may have re-embedded the re-run's text: a clean flag would keep that vector.
      ...(isEmbeddedSourceTable(table) ? { embeddingStale: 1 } : {}),
    }
    rowOps.push(upsertRowOp(ctx, descriptor, row))
    patches.push({ table, branchId, patch: { op: 'create', id, row: { ...row } } })
  }
  const listVecTables = vecTableLister(ctx)
  const sweeps: SqlOp[] = []
  for (const [table, ids] of removed)
    sweeps.push(...(await vecSweepIdsOps(table, branchId, ids, listVecTables)))
  // At its own position: the group's prunes freed any its own writes took.
  const deltaOps = journal.deltas.map((logged) => {
    const delta = { ...logged, branchId }
    return ctx.db
      .insert(deltas)
      .values(delta)
      .onConflictDoUpdate({ target: [deltas.branchId, deltas.id], set: delta })
      .toSQL()
  })
  const heldOps = journal.journals.map((held) =>
    ctx.db
      .insert(reversalJournals)
      .values({
        actionId: held.actionId,
        branchId,
        journal: held.journal,
        createdAt: held.createdAt,
      })
      .toSQL(),
  )
  return {
    ops: [...rowOps, ...sweeps, ...deltaOps, ...heldOps, journalDelete(ctx, branchId, actionId)],
    patches,
  }
}

// C1: a re-run's group writes no chapters create, and every delta of it anchors on its chapter's
// end entry.
async function shapedChapterId(
  group: readonly Delta[],
  ctx: Pick<DbCtx, 'db'>,
): Promise<string | null> {
  const [head] = group
  if (head === undefined || head.entryId === null) return null
  if (!group.every((delta) => delta.source === 'chapter_close')) return null
  if (group.some((delta) => delta.targetTable === 'chapters' && delta.op === 'create')) return null
  const [chapter] = await ctx.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.branchId, head.branchId), eq(chapters.endEntryId, head.entryId)))
  return chapter?.id ?? null
}

async function undoneClose(
  ctx: DbCtx,
  undone: Omit<UndoneClose, 'outcome' | 'seed'> & { branchId: string },
): Promise<UndoneClose> {
  const { branchId, chapterId, chapterNumber, ops, journal } = undone
  const seed = await readChapterCloseGroups(branchId, chapterId, ctx)
  return { outcome: 'undone', seed, ops, chapterId, chapterNumber, journal }
}

/** Call once the reversal committed: a refused or rolled-back one undid nothing. */
export function logCloseUndone(actionId: string, writeBack: RerunWriteBack): void {
  if (writeBack.outcome !== 'undone' && writeBack.outcome !== 'alone') return
  const { chapterNumber, journal } =
    writeBack.outcome === 'undone' ? writeBack : { chapterNumber: null, journal: 'missing' }
  logger.warn(
    'action_layer.rerun_close_undone',
    { chapterId: writeBack.chapterId, chapterNumber, journal },
    { actionId },
  )
}

/** What a committed reversal tells its caller; null when it restored no journal and undid no close. */
function journalOutcomeOf(
  writeBack: Exclude<RerunWriteBack, { outcome: 'none' }>,
): JournalOutcome | null {
  switch (writeBack.outcome) {
    case 'restored':
      return { journal: 'restored' }
    case 'undone':
      return { journal: 'undone', chapterNumber: writeBack.chapterNumber }
    case 'alone':
      return null
  }
}

/**
 * A committed store-sync failure of a re-run's reversal, rebuilt to carry how its journal ended, so
 * an undone close never reads as restored. `logCloseUndone` stays the caller's, once per commit.
 */
export function withJournalOutcome(
  e: DeltaReplayError,
  actionId: string,
  writeBack: Exclude<RerunWriteBack, { outcome: 'none' }>,
): DeltaReplayError {
  const rerun = journalOutcomeOf(writeBack)
  return new DeltaReplayError(e.message, {
    cause: e.cause,
    actionId,
    stage: 'store-sync',
    ...(rerun === null ? {} : { rerun }),
  })
}

type WriteBackArgs = {
  actionId: string
  /** Null for a run marker that records no branch (M6 C2): the reads then go by id alone. */
  branchId: string | null
  /** The group's deltas, newest first, as the caller read them. */
  group: readonly Delta[]
  /** pipeline_runs.rerun_chapter_id, when the caller holds the marker. */
  rerunChapterId?: string | null
}

// The write-back's decision, from reads alone; `rerunWriteBack` builds its ops from it.
type WriteBackPlan =
  | { outcome: 'none' }
  | { outcome: 'restored'; found: FoundJournal }
  | {
      outcome: 'undone'
      chapterId: string
      branchId: string
      chapterNumber: number
      /** Set when a journal exists and is dropped with the close. */
      found?: FoundJournal
      journal: UndoneClose['journal']
    }
  | { outcome: 'alone'; chapterId: string }

async function planWriteBack(args: WriteBackArgs, ctx: DbCtx): Promise<WriteBackPlan> {
  const { actionId, group } = args
  const found = await readJournal(actionId, args.branchId, ctx)
  if (found !== undefined) {
    const { branchId, journal } = found
    if (await groupIsWhole(journal.floor, branchId, group, ctx))
      return { outcome: 'restored', found }
    return {
      outcome: 'undone',
      chapterId: journal.chapterId,
      branchId,
      chapterNumber: journal.chapterNumber,
      found,
      journal: 'not-whole',
    }
  }
  const chapterId = args.rerunChapterId ?? (await shapedChapterId(group, ctx))
  if (chapterId === null) return { outcome: 'none' }
  const knownBranch = args.branchId ?? group[0]?.branchId ?? null
  const [chapter] = await ctx.db
    .select({ branchId: chapters.branchId, sequenceNumber: chapters.sequenceNumber })
    .from(chapters)
    .where(
      knownBranch === null
        ? eq(chapters.id, chapterId)
        : and(eq(chapters.branchId, knownBranch), eq(chapters.id, chapterId)),
    )
  if (!chapter) return { outcome: 'alone', chapterId }
  return {
    outcome: 'undone',
    chapterId,
    branchId: chapter.branchId,
    chapterNumber: chapter.sequenceNumber,
    journal: 'missing',
  }
}

/**
 * How a re-run's group reverses (generation-pipeline.md → Reverse-replay): journal written back,
 * or, with no journal or a group no longer whole, the close undone. Read before any transaction;
 * the caller runs the ops after its prunes.
 */
export async function rerunWriteBack(args: WriteBackArgs, ctx: DbCtx): Promise<RerunWriteBack> {
  const plan = await planWriteBack(args, ctx)
  switch (plan.outcome) {
    case 'none':
    case 'alone':
      return plan
    case 'restored':
      return { outcome: 'restored', ...(await writeBackOps(plan.found, args.actionId, ctx)) }
    case 'undone': {
      const { found, ...undone } = plan
      const ops = found === undefined ? [] : [journalDelete(ctx, found.branchId, args.actionId)]
      return undoneClose(ctx, { ...undone, ops })
    }
  }
}

/**
 * The close a reversal of this group would undo rather than restore, as `rerunWriteBack` decides
 * it, writing nothing; null when it restores one or the group is no re-run's.
 */
export async function closeUndoneBy(
  args: WriteBackArgs,
  ctx: DbCtx,
): Promise<{ chapterNumber: number } | null> {
  const plan = await planWriteBack(args, ctx)
  return plan.outcome === 'undone' ? { chapterNumber: plan.chapterNumber } : null
}

/** How many deltas a run group's reversal took, and how a re-run's journal ended. */
export type RunGroupReversal = { deltas: number } & (JournalOutcome | { journal: null })

// The fallback's set: the group and the chapter's close groups, once each, newest first.
export function withCloseGroups(group: readonly Delta[], seed: readonly Delta[]): Delta[] {
  const byId = new Map<string, Delta>()
  for (const delta of [...group, ...seed]) byId.set(delta.id, delta)
  return [...byId.values()].sort((a, b) => b.logPosition - a.logPosition)
}

/**
 * Reverses a run's group as abort and boot recovery do: a re-run's with its journal written back
 * or close undone, any other as `reverseReplayDeltas` (generation-pipeline.md → Reverse-replay).
 * `settleOps(reversed)` joins the transaction. Callers hold the branch exclusive, or run at boot.
 */
export async function reverseRunGroup(
  args: { actionId: string; branchId: string | null; rerunChapterId?: string | null },
  ctx: DbCtx,
  settleOps: (reversed: boolean) => readonly SqlOp[] = () => [],
): Promise<RunGroupReversal> {
  const { actionId } = args
  let group: Delta[]
  let writeBack: RerunWriteBack
  try {
    group = (await ctx.db
      .select()
      .from(deltas)
      .where(
        args.branchId === null
          ? eq(deltas.actionId, actionId)
          : and(eq(deltas.branchId, args.branchId), eq(deltas.actionId, actionId)),
      )
      .orderBy(desc(deltas.logPosition))) as Delta[]
    writeBack = await rerunWriteBack(
      { actionId, branchId: args.branchId, group, rerunChapterId: args.rerunChapterId },
      ctx,
    )
  } catch (e) {
    throw replayFailure(e, actionId)
  }
  if (writeBack.outcome === 'none') {
    const reversed = await reverseReplayGroup(actionId, group, ctx, (count) => settleOps(count > 0))
    return { deltas: reversed, journal: null }
  }
  const ops = writeBack.outcome === 'alone' ? [] : writeBack.ops
  let set: ReversalSet
  let settle: readonly SqlOp[]
  try {
    const target = writeBack.outcome === 'undone' ? withCloseGroups(group, writeBack.seed) : group
    // An empty target runs no query, so its branch is never read.
    set = await selectReversalSet(ctx, {
      branchId: target[0]?.branchId ?? args.branchId ?? '',
      target,
    })
    settle = settleOps(set.rows.length > 0 || ops.length > 0)
  } catch (e) {
    throw replayFailure(e, actionId)
  }
  let reversed: number
  try {
    reversed = await reverseAndPruneDeltaRows(
      set,
      ctx,
      { keepRedoExact: false },
      [...ops, ...settle],
      undefined,
      writeBack.outcome === 'restored'
        ? { patchesAfter: writeBack.patches, writesBack: writeBack.ops.length > 0 }
        : undefined,
    )
  } catch (e) {
    if (!(e instanceof DeltaReplayError && e.committed)) throw e
    logCloseUndone(actionId, writeBack)
    throw withJournalOutcome(e, actionId, writeBack)
  }
  logCloseUndone(actionId, writeBack)
  return { deltas: reversed, ...(journalOutcomeOf(writeBack) ?? { journal: null }) }
}
