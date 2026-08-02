import { and, eq } from 'drizzle-orm'

import type { HappeningAwareness } from '@/lib/db'
import { happeningAwareness, happeningAwarenessWriteSchema } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { happeningAwarenessStore } from '@/lib/stores'

import { nullifyRef } from '../coerce'
import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type AwarenessUpsertPayload = {
  branchId: string
  characterId: string
  happeningId: string
  learnedAtEntryId?: string | null
  decayResistance?: number | null
  source?: string | null
}

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    upsertHappeningAwareness: { source: DeltaSource; payload: AwarenessUpsertPayload }
    deleteHappeningAwareness: { source: DeltaSource; payload: { branchId: string; id: string } }
    bumpAwarenessRetrieval: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

const upsertHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'upsertHappeningAwareness')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const {
    branchId: bid,
    characterId,
    happeningId,
    learnedAtEntryId,
    decayResistance,
    source,
  } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }

  const parseInput = Object.fromEntries(
    Object.entries({ characterId, happeningId, learnedAtEntryId, decayResistance, source }).filter(
      ([, v]) => v !== undefined,
    ),
  )
  const parsed = happeningAwarenessWriteSchema.safeParse(parseInput)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid awareness: ${parsed.error.message}` }

  const [current] = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.branchId, bid),
        eq(happeningAwareness.characterId, characterId),
        eq(happeningAwareness.happeningId, happeningId),
      ),
    )

  if (current) {
    const set: Record<string, unknown> = {}
    const undoPayload: Record<string, unknown> = {}
    if (source !== undefined) {
      set.source = source
      undoPayload.source = current.source
    }
    if (decayResistance !== undefined) {
      set.decayResistance = decayResistance
      undoPayload.decayResistance = current.decayResistance
    }
    // Update-only reject: a create with no authored fields is a valid awareness-only
    // record (the character knows the happening; source/decay simply unrecorded).
    if (Object.keys(set).length === 0)
      return { status: 'rejected', reason: 'no awareness fields to merge' }
    return {
      status: 'ok',
      targetTable: 'happening_awareness',
      targetId: current.id,
      op: 'update',
      undoPayload,
      ops: [
        ctx.db
          .update(happeningAwareness)
          .set(set)
          .where(and(eq(happeningAwareness.branchId, bid), eq(happeningAwareness.id, current.id)))
          .toSQL(),
      ],
      patch: { op: 'update', id: current.id, columns: set },
    }
  }

  const row: HappeningAwareness = {
    id: generateId('haw'),
    branchId: bid,
    happeningId,
    characterId,
    learnedAtEntryId: nullifyRef(learnedAtEntryId),
    decayResistance: decayResistance ?? null,
    retrievalCount: 0,
    source: source ?? null,
  }
  return {
    status: 'ok',
    targetTable: 'happening_awareness',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(happeningAwareness).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteHappeningAwareness')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, bid), eq(happeningAwareness.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target awareness ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'happening_awareness',
    targetId: id,
    op: 'delete',
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(happeningAwareness)
        .where(and(eq(happeningAwareness.branchId, bid), eq(happeningAwareness.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

// chapter-close.md → 3d awareness pin tuning ranks awareness rows by
// retrieval_count, so a turn the user rolled back must leave nothing counted.
const bumpRetrievalHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'bumpAwarenessRetrieval')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, bid), eq(happeningAwareness.id, id)))
  if (!current)
    return { status: 'rejected', reason: `bump target awareness ${bid}:${id} not found` }

  const next = current.retrievalCount + 1
  return {
    status: 'ok',
    targetTable: 'happening_awareness',
    targetId: id,
    op: 'update',
    // retrievalCount has no columnSchemas entry, so reverse-replay restores it by assignment.
    undoPayload: { retrievalCount: current.retrievalCount },
    ops: [
      ctx.db
        .update(happeningAwareness)
        .set({ retrievalCount: next })
        .where(and(eq(happeningAwareness.branchId, bid), eq(happeningAwareness.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: { retrievalCount: next } },
  }
}

export function registerHappeningAwareness(): void {
  register({
    table: 'happening_awareness',
    descriptor: {
      table: happeningAwareness,
      idCol: happeningAwareness.id,
      branchCol: happeningAwareness.branchId,
    },
    columnSchemas: {},
    handlers: {
      upsertHappeningAwareness: upsertHandler,
      deleteHappeningAwareness: deleteHandler,
      bumpAwarenessRetrieval: bumpRetrievalHandler,
    },
    patcher: (branchId, p) => happeningAwarenessStore.patch(branchId, p),
  })
}
