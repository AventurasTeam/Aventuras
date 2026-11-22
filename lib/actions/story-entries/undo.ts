import { and, desc, eq, ne } from 'drizzle-orm'

import type { Delta, SqlOp } from '@/lib/db'
import { deltas } from '@/lib/db'
import { entriesStore, generationStore, selectMemoryRun, undoRedoStore } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { resolveInvalidationForDeltas, type InvalidationOutcome } from './classifier-facts'
import { resolveSweep } from './operational'
import { bracketProseReversal } from './prose-reversal'
import { logReversalRefused } from '../delta/commit-new-action'
import { applyRedo, prepareUndo, type RedoSnapshot } from '../delta/redo'
import {
  logCloseUndone,
  rerunWriteBack,
  withCloseGroups,
  withJournalOutcome,
  type RerunWriteBack,
} from '../delta/rerun-journal'
import {
  DeltaReplayError,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
} from '../delta/reverse-replay'
import { selectReversalSet, type ReversalSet } from '../delta/row-closure'
import type { DbCtx } from '../types'

/**
 * Why an undo/redo was refused. `reason` stays free-form for the log line; only `code`
 * is branched on: a surface must tell a routine refusal from a delta log that cannot
 * produce the reversal it should, which must not read as "Nothing to undo".
 */
export type UndoRejectionCode =
  | 'gated'
  | 'branch-not-loaded'
  | 'nothing-to-apply'
  | 'integrity'
  | 'target-moved'

export type UndoResult =
  | {
      status: 'ok'
      /** A re-run's undo with no journal to write back undid the close too (Reverse-replay). */
      closeUndone?: { chapterNumber: number }
    }
  | { status: 'rejected'; code: UndoRejectionCode; reason: string }

/**
 * The action the caller named: reader-composer.md → Undo and redo reverses exactly what its label
 * or confirm described, so a newer head refuses `target-moved` and nothing is undone.
 */
export type UndoOptions = { expectedActionId?: string }

const GATED: UndoResult = { status: 'rejected', code: 'gated', reason: 'generation in flight' }

function movedFrom(expectedActionId: string | undefined, actionId: string): UndoResult | null {
  if (expectedActionId === undefined || expectedActionId === actionId) return null
  return {
    status: 'rejected',
    code: 'target-moved',
    reason: `expected ${expectedActionId}, latest is ${actionId}`,
  }
}

function unreadableScopeRejection(deltaId: string): UndoResult {
  return {
    status: 'rejected',
    code: 'integrity',
    reason: `delta ${deltaId} carries an unreadable invalidation scope`,
  }
}

// A refused reversal wrote nothing, and the log cannot produce the reversal it should
// (generation-pipeline.md → Reverse-replay).
async function refusingIntegrity(
  branchId: string,
  body: () => Promise<UndoResult>,
): Promise<UndoResult> {
  try {
    return await body()
  } catch (e) {
    if (!(e instanceof ReversalIntegrityError)) throw e
    logReversalRefused(branchId, e)
    return { status: 'rejected', code: 'integrity', reason: e.message }
  }
}

// CTRL-Z reads one group, not the log: the newest row a user would undo (a pass's rows sit above
// its turn with their own action id), then that action's rows, newest first as selectUndoTarget
// requires. A long branch's whole log runs to tens of MB.
async function headGroupRows(
  branchId: string,
  ctx: DbCtx,
  skipActionId?: string,
): Promise<Delta[]> {
  const [head] = await ctx.db
    .select({ actionId: deltas.actionId })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        ne(deltas.source, 'periodic_classifier'),
        skipActionId === undefined ? undefined : ne(deltas.actionId, skipActionId),
      ),
    )
    .orderBy(desc(deltas.logPosition))
    .limit(1)
  if (head === undefined) return []
  return (await ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, branchId), eq(deltas.actionId, head.actionId)))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

/**
 * The group the next undo targets, read for its label and for the gate: a close or pass still
 * running heads the log above it until the undo's interrupt reverses it, so it is passed over.
 */
export async function headUndoGroup(branchId: string, ctx: DbCtx): Promise<Delta[]> {
  const running = generationStore.isUserEditBlocked()
    ? selectMemoryRun(generationStore.getTxState(), { branchId })?.actionId
    : undefined
  return headGroupRows(branchId, ctx, running)
}

export async function undoLastAction(
  branchId: string,
  ctx: DbCtx,
  { expectedActionId }: UndoOptions = {},
): Promise<UndoResult> {
  // Only CTRL-Z of the turn passes a pass or a close, by interrupting it, so the target is read
  // before the gate decides (principles.md → Edit restrictions during in-flight generation).
  let throughInterrupt = false
  if (generationStore.isUserEditBlocked()) {
    if (generationStore.isHeadReversalBlocked(branchId)) return GATED
    const target = selectUndoTarget(await headUndoGroup(branchId, ctx))
    const moved = target == null ? null : movedFrom(expectedActionId, target.actionId)
    if (moved != null) return moved
    if (generationStore.isUserEditBlocked()) {
      if (target?.kind !== 'turn' || generationStore.isHeadReversalBlocked(branchId)) return GATED
      throughInterrupt = true
    }
  }
  // The reader screen only ever calls this for the branch it has loaded; a
  // stale branchId (e.g. mid branch-switch) would otherwise let the reversal
  // race the in-flight reload that's about to hydrate the same branch.
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', code: 'branch-not-loaded', reason: 'branch not loaded' }

  // Brackets the whole target-selection + reversal sweep, matching
  // rollbackToEntry — a concurrent edit/submit/generation mid-sweep must not
  // race the rows this undo is about to read and reverse.
  return bracketProseReversal(
    branchId,
    ctx,
    () =>
      refusingIntegrity(branchId, () =>
        undoBracketed(branchId, ctx, throughInterrupt, expectedActionId),
      ),
    () => GATED,
  )
}

async function undoBracketed(
  branchId: string,
  ctx: DbCtx,
  throughInterrupt: boolean,
  expectedActionId: string | undefined,
): Promise<UndoResult> {
  const group = await headGroupRows(branchId, ctx)
  const target = selectUndoTarget(group)
  if (!target) return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to undo' }
  const moved = movedFrom(expectedActionId, target.actionId)
  if (moved != null) return moved
  // Admitted past the gate to undo the turn; a target that moved during the interrupt is gated.
  if (throughInterrupt && target.kind !== 'turn') return GATED

  if (target.kind === 'group') {
    const writeBack = await rerunWriteBack({ actionId: target.actionId, branchId, group }, ctx)
    if (writeBack.outcome !== 'none')
      return undoRerun({ branchId, actionId: target.actionId, group }, writeBack, ctx)
  }

  let set: ReversalSet
  let clampOps: readonly SqlOp[]
  if (target.kind === 'turn') {
    const swept = await resolveSweep(branchId, target.entryId, ctx)
    // A missing entry or create delta, or a refused closure (the only one logged): unreversible.
    if ('status' in swept) return { status: 'rejected', code: 'integrity', reason: swept.reason }
    set = swept.set
    clampOps = swept.clampOps
  } else {
    const invalidation = await resolveInvalidationForDeltas(branchId, group, ctx)
    if (invalidation.status === 'unreadable') return unreadableScopeRejection(invalidation.deltaId)
    clampOps = invalidation.clampOps
    // Swept facts follow from the prose moving, not from the action: as `sweep` they stay out
    // of redo, and the clamped watermark re-derives them (generation-pipeline.md → Reverse-replay).
    set = await selectReversalSet(ctx, { branchId, target: group, sweep: invalidation.rows })
  }

  // Redo restores the target and its closure (data-model.md → Entry mutability & rollback).
  const undo = await prepareUndo(set, ctx, target.actionId)
  try {
    await undo.reverse(clampOps)
  } catch (e) {
    // Committed: the reversal + prune landed in SQLite, only the store sync failed. The change
    // is real, so keep redo available before surfacing the failure.
    if (e instanceof DeltaReplayError && e.committed) undoRedoStore.pushRedoGroup(undo.group)
    throw e
  }
  undoRedoStore.pushRedoGroup(undo.group)
  return { status: 'ok' }
}

// generation-pipeline.md → Reverse-replay: a re-run's undo takes no redo snapshot and clears the
// stack, since a later edit's snapshot there can hold the re-run's values.
async function undoRerun(
  { branchId, actionId, group }: { branchId: string; actionId: string; group: readonly Delta[] },
  writeBack: Exclude<RerunWriteBack, { outcome: 'none' }>,
  ctx: DbCtx,
): Promise<UndoResult> {
  const invalidation = await resolveInvalidationForDeltas(branchId, group, ctx)
  if (invalidation.status === 'unreadable') return unreadableScopeRejection(invalidation.deltaId)
  const target = writeBack.outcome === 'undone' ? withCloseGroups(group, writeBack.seed) : group
  const ops = writeBack.outcome === 'alone' ? [] : writeBack.ops
  const set = await selectReversalSet(ctx, { branchId, target, sweep: invalidation.rows })
  try {
    await reverseAndPruneDeltaRows(
      set,
      ctx,
      { keepRedoExact: false },
      [...invalidation.clampOps, ...ops],
      undefined,
      writeBack.outcome === 'restored' ? { patchesAfter: writeBack.patches } : undefined,
    )
  } catch (e) {
    // Committed: only the store sync failed, so the re-run is undone all the same, and the error
    // says how its journal ended.
    if (e instanceof DeltaReplayError && e.committed) {
      undoRedoStore.clear()
      logCloseUndone(actionId, writeBack)
      throw withJournalOutcome(e, actionId, writeBack)
    }
    throw e
  }
  undoRedoStore.clear()
  logCloseUndone(actionId, writeBack)
  return writeBack.outcome === 'undone'
    ? { status: 'ok', closeUndone: { chapterNumber: writeBack.chapterNumber } }
    : { status: 'ok' }
}

export async function redoLastAction(
  branchId: string,
  ctx: DbCtx,
  { expectedActionId }: UndoOptions = {},
): Promise<UndoResult> {
  if (generationStore.isUserEditBlocked()) return GATED
  if (entriesStore.getLoadedBranch() !== branchId)
    return { status: 'rejected', code: 'branch-not-loaded', reason: 'branch not loaded' }

  const group = undoRedoStore.peekRedoGroup()
  if (!group) return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to redo' }
  const moved = movedFrom(expectedActionId, group.actionId)
  if (moved != null) return moved
  // The redo stack is a single global stack, not partitioned per branch. Guard
  // against applying another branch's snapshot to this context.
  if (group.snapshots.some((s) => s.delta.branchId !== branchId))
    return {
      status: 'rejected',
      code: 'integrity',
      reason: 'redo stack does not belong to this branch',
    }

  // Bracketed like every reversal, so no pass starts mid-sweep.
  return bracketProseReversal(
    branchId,
    ctx,
    () =>
      refusingIntegrity(branchId, async () => {
        // A write committing during the settle clears the stack; its snapshot would restore over it.
        if (undoRedoStore.peekRedoGroup() !== group)
          return { status: 'rejected', code: 'nothing-to-apply', reason: 'nothing to redo' }
        const invalidation = await resolveRedoInvalidation(branchId, group.snapshots, ctx)
        if (invalidation.status === 'unreadable')
          return unreadableScopeRejection(invalidation.deltaId)
        try {
          await applyRedo(group, ctx, invalidation.clampOps)
        } catch (e) {
          // Committed: the redo's DB write landed, only the store sync failed. Pop regardless —
          // a retry would re-insert an already-inserted delta row and collide on its primary key.
          if (e instanceof DeltaReplayError && e.committed) undoRedoStore.popRedoGroup()
          throw e
        }
        undoRedoStore.popRedoGroup()
        return { status: 'ok' }
      }),
    () => GATED,
  )
}

/**
 * Restoring prose re-opens the question the forward edit answered, so the redo re-clamps
 * the watermark: a pass that found nothing advanced it without logging, which leaves the
 * redo stack standing. Its `rows` go unused: a pass that logged a fact cleared the stack,
 * and the undo already swept the rest.
 *
 * Skips a snapshot carrying no row because `isContentEditDelta` pins `op = 'update'`,
 * and `applyRedo` writes nothing for an update it has no row to restore. A delete
 * redoes regardless of the snapshot, so widening the predicate would lose the clamp.
 */
async function resolveRedoInvalidation(
  branchId: string,
  snapshot: readonly RedoSnapshot[],
  ctx: DbCtx,
): Promise<InvalidationOutcome> {
  const restorable = snapshot.filter((s) => s.rowBeforeUndo != null).map((s) => s.delta)
  return resolveInvalidationForDeltas(branchId, restorable, ctx)
}
