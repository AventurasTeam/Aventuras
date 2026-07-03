import { desc, eq } from 'drizzle-orm'

import type { Delta } from '@/lib/db'
import { deltas } from '@/lib/db'
import { undoRedoStore } from '@/lib/stores'
import { selectUndoTarget } from '@/lib/undo'

import { applyRedo, snapshotForRedo } from '../delta/redo'
import { reverseAndPruneDeltaRows } from '../delta/reverse-replay'
import type { DbCtx } from '../types'
import { resolveRollbackWindow } from './operational'

export type UndoResult = { status: 'ok' } | { status: 'rejected'; reason: string }

async function recentDeltaRows(branchId: string, ctx: DbCtx): Promise<Delta[]> {
  return (await ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, branchId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

export async function undoLastAction(branchId: string, ctx: DbCtx): Promise<UndoResult> {
  const recent = await recentDeltaRows(branchId, ctx)
  const target = selectUndoTarget(recent)
  if (!target) return { status: 'rejected', reason: 'nothing to undo' }

  let rows: Delta[]
  if (target.kind === 'turn') {
    const win = await resolveRollbackWindow(branchId, target.entryId, ctx)
    if ('status' in win) return { status: 'rejected', reason: win.reason }
    rows = (await ctx.db
      .select()
      .from(deltas)
      .where(win.where)
      .orderBy(desc(deltas.logPosition))) as Delta[]
  } else {
    rows = recent.filter((r) => r.actionId === target.actionId)
  }

  const snapshot = await snapshotForRedo(rows, ctx)
  await reverseAndPruneDeltaRows(rows, ctx)
  undoRedoStore.pushRedoGroup(snapshot)
  return { status: 'ok' }
}

export async function redoLastAction(_branchId: string, ctx: DbCtx): Promise<UndoResult> {
  const snapshot = undoRedoStore.popRedoGroup()
  if (!snapshot) return { status: 'rejected', reason: 'nothing to redo' }
  await applyRedo(snapshot, ctx)
  return { status: 'ok' }
}
