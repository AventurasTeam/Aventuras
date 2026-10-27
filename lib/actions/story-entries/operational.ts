import { and, desc, eq, sql, type SQL } from 'drizzle-orm'

import type { Delta, EntryMetadata, SqlOp } from '@/lib/db'
import { deltas, entryMetadataSchema, storyEntries } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { headTurnEntries } from '@/lib/head-turn'
import { generateId } from '@/lib/ids'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { withBranchWriteShared } from '../delta/branch-write-lock'
import { computeUndoPayload } from '../delta/delta-encoding'
import { deltaRowOp } from '../delta/delta-row'
import {
  DeltaReplayError,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
} from '../delta/reverse-replay'
import { selectReversalSet, type ReversalSet } from '../delta/row-closure'
import type { DbCtx } from '../types'
import { contentEditUndoPayload, resolveContentEditInvalidation } from './classifier-facts'
import { loadHeadTurn } from './head-turn'
import { bracketProseReversal, classifierWatermarkClampOps } from './prose-reversal'
import { STORY_ENTRY_REJECTION, type StoryEntryRejectionCode } from './register'

export type StoryEntryRejection = {
  status: 'rejected'
  reason: string
  // Only `CountsChangedRejection` carries this code, so it alone narrows to the fresh counts.
  code: Exclude<StoryEntryRejectionCode, typeof STORY_ENTRY_REJECTION.countsChanged>
}

export function logReversalRefused(branchId: string, e: ReversalIntegrityError): void {
  logger.error('action_layer.reversal_refused', { branchId, refusal: e.refusal, reason: e.message })
}

// A refused reversal wrote nothing; it travels on the action's existing rejection
// (generation-pipeline.md → Reverse-replay).
export function reversalRefused(branchId: string, e: ReversalIntegrityError): StoryEntryRejection {
  logReversalRefused(branchId, e)
  return { status: 'rejected', reason: e.message, code: STORY_ENTRY_REJECTION.deltaFailed }
}

// A second unrelated action clears the redo stack (data-model.md). That holds when only the store
// sync after the commit throws too: the action landed all the same. A refusal is not committed.
async function commitNewAction(
  set: ReversalSet,
  ctx: DbCtx,
  extraOps: readonly SqlOp[],
): Promise<void> {
  try {
    await reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: false }, extraOps)
  } catch (e) {
    if (e instanceof DeltaReplayError && e.committed) undoRedoStore.clear()
    throw e
  }
  undoRedoStore.clear()
}

export async function updateStoryEntryContent(
  branchId: string,
  id: string,
  content: string,
  ctx: DbCtx,
): Promise<{ status: 'ok' } | StoryEntryRejection> {
  const headAtStart =
    onlyInterruptibleRunsHold(branchId) && (await isHeadTurnEntry(branchId, id, ctx))
  if (contentEditBlocked(branchId, headAtStart)) return inFlightRejection()
  // Ahead of the bracket, which interrupts a pass: an unchanged save must not cost one. Safe
  // outside the barrier because no other writer touches this column, unlike the scope's tail read.
  const [existing] = await ctx.db
    .select({ content: storyEntries.content })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
  if (existing?.content === content) return { status: 'ok' }
  // Re-checked past the reads: gate and the bracket's flag set stay one synchronous block, so a
  // second Save is refused, not thrown as re-entry. Not inside the bracket (flag reads blocked).
  const inHeadTurn =
    onlyInterruptibleRunsHold(branchId) && (await isHeadTurnEntry(branchId, id, ctx))
  if (contentEditBlocked(branchId, inHeadTurn)) return inFlightRejection()
  return bracketProseReversal(branchId, () =>
    updateStoryEntryContentBracketed(branchId, id, content, ctx),
  )
}

// Only interruptible runs hold the gate: the one case a head-turn edit may pass, by interrupting
// them (principles.md → Edit restrictions during in-flight generation). Gates the head-turn read.
function onlyInterruptibleRunsHold(branchId: string): boolean {
  return generationStore.isUserEditBlocked() && !generationStore.isHeadReversalBlocked(branchId)
}

function contentEditBlocked(branchId: string, inHeadTurn: boolean): boolean {
  if (!generationStore.isUserEditBlocked()) return false
  return !inHeadTurn || generationStore.isHeadReversalBlocked(branchId)
}

async function isHeadTurnEntry(branchId: string, id: string, ctx: DbCtx): Promise<boolean> {
  const head = await loadHeadTurn(branchId, ctx)
  return head != null && headTurnEntries(head).some((entry) => entry.id === id)
}

function inFlightRejection(): StoryEntryRejection {
  return {
    status: 'rejected',
    reason: 'generation in flight',
    code: STORY_ENTRY_REJECTION.inFlight,
  }
}

// data-model.md → Entry metadata shape: the text is the user's now, so the cut-off mark leaves in
// the edit's own delta, and an undo of the edit restores both.
type CutOffClear =
  | { clearsCutOff: false }
  | { clearsCutOff: true; metadataUndo: Record<string, unknown> }

function cutOffClearOf(metadata: EntryMetadata | null): CutOffClear {
  if (metadata?.cutOff === undefined) return { clearsCutOff: false }
  return {
    clearsCutOff: true,
    metadataUndo: computeUndoPayload(entryMetadataSchema, metadata, withoutCutOff(metadata)),
  }
}

function withoutCutOff(metadata: EntryMetadata): EntryMetadata {
  const { cutOff: _cutOff, ...cleared } = metadata
  return cleared
}

// In SQL: the reversal sharing this transaction may write the row's other metadata keys after the
// action's read. The store patch reads the row after the reversal's patches for the same reason.
function contentEditSet(content: string, clear: CutOffClear) {
  if (!clear.clearsCutOff) return { content }
  return { content, metadata: sql`json_remove(${storyEntries.metadata}, '$.cutOff')` }
}

function contentEditPatchColumns(
  id: string,
  content: string,
  clear: CutOffClear,
): { content: string; metadata?: EntryMetadata } {
  const stored = clear.clearsCutOff ? entriesStore.getById(id)?.metadata : null
  return stored ? { content, metadata: withoutCutOff(stored) } : { content }
}

/**
 * Prose is the classifier's only input, so a rewrite leaves the facts it took from the
 * old text standing on nothing. Reversal and clamp ride one scope and neither runs
 * without the other; off the head turn the edit is a bare text write
 * (data-model.md -> Entry mutability & rollback).
 */
async function updateStoryEntryContentBracketed(
  branchId: string,
  id: string,
  content: string,
  ctx: DbCtx,
): Promise<{ status: 'ok' } | StoryEntryRejection> {
  const [current] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
  if (!current)
    return {
      status: 'rejected',
      reason: `story_entries ${branchId}:${id} not found`,
      code: STORY_ENTRY_REJECTION.notFound,
    }
  // `clearSystemEntry` hard-deletes without a delta, which would strand this one: the
  // survival anchor's subquery yields NULL for a missing entry, so the orphan is spared
  // by every rollback window and a CTRL-Z reaching it updates nothing while reporting ok.
  if (current.kind === 'system')
    return {
      status: 'rejected',
      reason: `system entries are not editable; ${id} is one`,
      code: STORY_ENTRY_REJECTION.notTailEntry,
    }

  const invalidation = await resolveContentEditInvalidation(branchId, id, ctx)
  const clear = cutOffClearOf(current.metadata)

  // In scope the clamp is unconditional: a pass that read the entry and extracted
  // nothing still advanced the watermark past it, and the op no-ops when the watermark
  // is already behind. One transaction, because a clamp without the reversal re-derives
  // beside the stale facts and a reversal without the clamp deletes them with nothing
  // to replace them.
  try {
    const set = await selectReversalSet(ctx, { branchId, target: [], sweep: invalidation.rows })
    await commitNewAction(set, ctx, [
      ctx.db
        .update(storyEntries)
        .set(contentEditSet(content, clear))
        .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, id)))
        .toSQL(),
      // Spliced, not dispatched: applyDeltaAction's own transaction isn't atomic with the reversal,
      // and its barrier rejects user_edit while the bracket's `reversalInProgress` is set.
      deltaRowOp(ctx, {
        deltaId: generateId('delta'),
        branchId,
        // Survival anchor (data-model.md): else a rollback above sweeps this delta and restores
        // stale prose onto a surviving row.
        entryId: id,
        actionId: generateId('act'),
        source: 'user_edit',
        target: {
          targetTable: 'story_entries',
          targetId: id,
          op: 'update',
          undoPayload: contentEditUndoPayload(
            current.content,
            invalidation.scope,
            clear.clearsCutOff ? clear.metadataUndo : undefined,
          ),
        },
      }),
      ...invalidation.clampOps,
    ])
  } catch (e) {
    if (e instanceof ReversalIntegrityError) return reversalRefused(branchId, e)
    throw e
  }

  entriesStore.patch(branchId, {
    op: 'update',
    id,
    columns: contentEditPatchColumns(id, content, clear),
  })
  return { status: 'ok' }
}

export type RollbackCounts = { entries: number; chapters: number; worldStateChanges: number }

/** The set moved since the confirm showed its counts; `counts` is the set as it stands now. */
export type CountsChangedRejection = {
  status: 'rejected'
  code: typeof STORY_ENTRY_REJECTION.countsChanged
  reason: string
  counts: RollbackCounts
}

async function resolveRollbackWindow(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<{ where: SQL | undefined; earliestRemovedPosition: number } | StoryEntryRejection> {
  const [target] = await ctx.db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, branchId), eq(storyEntries.id, targetId)))
  if (!target)
    return {
      status: 'rejected',
      reason: `target ${branchId}:${targetId} not found`,
      code: STORY_ENTRY_REJECTION.notFound,
    }
  if (target.kind === 'opening')
    return {
      status: 'rejected',
      reason: 'the opening is the rollback floor',
      code: STORY_ENTRY_REJECTION.rollbackFloor,
    }

  // N = B's own create-delta log_position. Found by target_id (not entry_id), so
  // this works whether or not foreground deltas stamp entry_id.
  const [createDelta] = await ctx.db
    .select({ lp: deltas.logPosition })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.targetTable, 'story_entries'),
        eq(deltas.targetId, targetId),
        eq(deltas.op, 'create'),
      ),
    )
  if (!createDelta)
    return {
      status: 'rejected',
      reason: `no create delta for ${targetId}`,
      code: STORY_ENTRY_REJECTION.rollbackFloor,
    }

  // Survival-anchor predicate (data-model.md -> Survival anchor). A delta that AMENDS an
  // existing entry stamps it -- metadata, scene fields, content -- so the
  // position-correlated branch spares it when a later turn is swept. The create that
  // introduces an entry deliberately does not, leaving the suffix rule to sweep it.
  return {
    where: and(
      eq(deltas.branchId, branchId),
      sql`${deltas.logPosition} >= ${createDelta.lp}`,
      sql`(${deltas.entryId} IS NULL OR (SELECT ${storyEntries.position} FROM ${storyEntries} WHERE ${storyEntries.branchId} = ${deltas.branchId} AND ${storyEntries.id} = ${deltas.entryId}) >= ${target.position})`,
    ),
    // B: the target is itself the first entry the sweep removes, for both the
    // rollback and the CTRL-Z turn arm.
    earliestRemovedPosition: target.position,
  }
}

/**
 * The rollback window materialized and closed: the set the sweep reverses, plus the watermark
 * clamp that must ride in its transaction. Writes nothing (a refusal only logs); each caller owns
 * its tail and redo-stack policy, which differ. A closure the log cannot satisfy is `delta-failed`.
 */
export async function resolveSweep(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<{ set: ReversalSet; clampOps: SqlOp[] } | StoryEntryRejection> {
  const win = await resolveRollbackWindow(branchId, targetId, ctx)
  if ('status' in win) return win
  const rows = (await ctx.db
    .select()
    .from(deltas)
    .where(win.where)
    .orderBy(desc(deltas.logPosition))) as Delta[]
  let set: ReversalSet
  try {
    set = await selectReversalSet(ctx, { branchId, target: rows })
  } catch (e) {
    if (e instanceof ReversalIntegrityError) return reversalRefused(branchId, e)
    throw e
  }
  return { set, clampOps: classifierWatermarkClampOps(branchId, win.earliestRemovedPosition) }
}

// Buckets per rollback-confirm.md, whose world-state row is scoped to the other
// narrative tables. An entry-scoped delta is spared by the survival anchor unless its
// entry is being deleted, so counting one here would charge the user twice for a loss
// the entries line already reports.
// A cleared parent logs no delta but still moves a place, so it counts as a change.
export function rollbackCountsOf({ rows, refClears }: ReversalSet): RollbackCounts {
  let entries = 0
  let chapters = 0
  let worldStateChanges = refClears.length
  for (const r of rows) {
    if (r.targetTable === 'story_entries') {
      if (r.op === 'create') entries++
    } else if (r.op === 'create' && r.targetTable === 'chapters') chapters++
    else worldStateChanges++
  }
  return { entries, chapters, worldStateChanges }
}

export function sameRollbackCounts(a: RollbackCounts, b: RollbackCounts): boolean {
  return (
    a.entries === b.entries &&
    a.chapters === b.chapters &&
    a.worldStateChanges === b.worldStateChanges
  )
}

const ROLLBACK_PREVIEW_LOCK_ID = 'rollback-preview'

export async function getRollbackCounts(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
): Promise<RollbackCounts | StoryEntryRejection> {
  // The closed set, not the window: a fact on a surviving turn naming a row the sweep
  // removes goes too (rollback-confirm.md → Counts).
  // Held shared: a prose reversal or interruptible-run abort reversal landing mid-read refuses it.
  const swept = await withBranchWriteShared(branchId, ROLLBACK_PREVIEW_LOCK_ID, () =>
    resolveSweep(branchId, targetId, ctx),
  )
  if ('status' in swept) return swept
  return rollbackCountsOf(swept.set)
}

export async function rollbackToEntry(
  branchId: string,
  targetId: string,
  ctx: DbCtx,
  { expectedCounts }: { expectedCounts: RollbackCounts },
): Promise<
  { status: 'ok'; counts: RollbackCounts } | StoryEntryRejection | CountsChangedRejection
> {
  // A head reversal: a pass or a close holding the gate is interrupted, not waited for.
  if (generationStore.isHeadReversalBlocked(branchId)) return inFlightRejection()

  return bracketProseReversal(branchId, async () => {
    const swept = await resolveSweep(branchId, targetId, ctx)
    if ('status' in swept) return swept
    const counts = rollbackCountsOf(swept.set)
    // Compared with the set the commit reverses, so the consent covers exactly what goes.
    if (!sameRollbackCounts(counts, expectedCounts))
      return {
        status: 'rejected',
        code: STORY_ENTRY_REJECTION.countsChanged,
        reason: 'rollback counts changed since the confirm opened',
        counts,
      }
    try {
      await commitNewAction(swept.set, ctx, swept.clampOps)
    } catch (e) {
      if (e instanceof ReversalIntegrityError) return reversalRefused(branchId, e)
      throw e
    }
    return { status: 'ok', counts }
  })
}
