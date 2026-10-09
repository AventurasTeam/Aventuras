import { and, eq } from 'drizzle-orm'

import type { HappeningAwareness } from '@/lib/db'
import { happeningAwareness, happeningAwarenessWriteSchema } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { happeningAwarenessStore } from '@/lib/stores'

import { nullifyRef } from '../coerce'
import { missingRef, MISSING_REF } from '../delta/live-refs'
import { register, type ActionHandler } from '../delta/registry'
import { isUserOriginatedSource, type DeltaSource } from '../types'

type AwarenessUpsertPayload = {
  branchId: string
  characterId: string
  happeningId: string
  learnedAtEntryId?: string | null
  decayResistance?: number | null
  source?: string | null
  /** Honored only on a user-source create; an invalid value rejects the action regardless. */
  retrievalCount?: number
}

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    upsertHappeningAwareness: { source: DeltaSource; payload: AwarenessUpsertPayload }
    deleteHappeningAwareness: { source: DeltaSource; payload: { branchId: string; id: string } }
    bumpAwarenessRetrieval: {
      source: DeltaSource
      payload: { branchId: string; id: string; priorCount: number }
    }
  }
}

const upsertHandler: ActionHandler = async (action, branchId, ctx, group) => {
  if (action.kind !== 'upsertHappeningAwareness')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const {
    branchId: bid,
    characterId,
    happeningId,
    learnedAtEntryId,
    decayResistance,
    source,
    retrievalCount,
  } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  if (
    retrievalCount !== undefined &&
    !(Number.isSafeInteger(retrievalCount) && retrievalCount >= 0)
  )
    return {
      status: 'rejected',
      reason: 'invalid awareness: retrievalCount must be a non-negative integer',
    }

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

  // A delete arm cascades the link under this lock, so an existing one skips the ref check;
  // a create's reversal can still orphan it.
  if (current) {
    // Only a user edit re-anchors learned_at; a classifier re-emit must not drift the decay anchor.
    const learnedAt =
      learnedAtEntryId !== undefined && isUserOriginatedSource(action.source)
        ? nullifyRef(learnedAtEntryId)
        : undefined
    // Update-only reject: a create with no authored fields is a valid awareness-only
    // record (the character knows the happening; source/decay simply unrecorded).
    if (source === undefined && decayResistance === undefined && learnedAt === undefined)
      return { status: 'rejected', reason: 'no awareness fields to merge' }
    // Unchanged fields are dropped, and an all-unchanged upsert is a noop: History reads an
    // undo payload's keys as fields that changed.
    const set: Record<string, unknown> = {}
    const undoPayload: Record<string, unknown> = {}
    if (source !== undefined && source !== current.source) {
      set.source = source
      undoPayload.source = current.source
    }
    if (decayResistance !== undefined && decayResistance !== current.decayResistance) {
      set.decayResistance = decayResistance
      undoPayload.decayResistance = current.decayResistance
    }
    if (learnedAt !== undefined && learnedAt !== current.learnedAtEntryId) {
      set.learnedAtEntryId = learnedAt
      undoPayload.learnedAtEntryId = current.learnedAtEntryId
    }
    if (Object.keys(set).length === 0)
      return { status: 'rejected', reason: 'awareness unchanged', code: 'noop' }
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

  const refs = [
    { table: 'happenings', id: happeningId },
    { table: 'entities', id: characterId },
  ] as const
  if (await missingRef(ctx, bid, refs, group)) return MISSING_REF

  const row: HappeningAwareness = {
    id: generateId('haw'),
    branchId: bid,
    happeningId,
    characterId,
    learnedAtEntryId: nullifyRef(learnedAtEntryId),
    decayResistance: decayResistance ?? null,
    // A merge's moved row keeps its count; a pipeline create starts at 0, since only
    // bumpAwarenessRetrieval counts retrievals.
    retrievalCount: isUserOriginatedSource(action.source) ? (retrievalCount ?? 0) : 0,
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
const bumpRetrievalHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'bumpAwarenessRetrieval')
    throw new Error(`handler/kind mismatch: ${action.kind}`)
  const { branchId: bid, id, priorCount } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }

  // No read of its own: the retrieval pass already selected these rows, so the
  // prior count rides on the payload. One bump fires per aware in-scene
  // character per seated happening, all of them ahead of the narrative stream,
  // and a read each would double the round trips on the device least able to
  // absorb them.
  //
  // The cost is that a row deleted between the pass and this apply is no longer
  // detectable here — the periodic classifier can reverse-replay its awareness
  // rows away mid-turn, since it and a turn do not block each other. That now
  // writes a delta whose UPDATE matches nothing and whose undo no-ops, rather
  // than the 'noop' rejection this returned while it still read the row. The
  // turn must survive it either way: failing would reverse the user's whole
  // turn over a counter that feeds chapter-close ranking.
  const next = priorCount + 1
  return {
    status: 'ok',
    targetTable: 'happening_awareness',
    targetId: id,
    op: 'update',
    // retrievalCount has no columnSchemas entry, so reverse-replay restores it by assignment.
    undoPayload: { retrievalCount: priorCount },
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
