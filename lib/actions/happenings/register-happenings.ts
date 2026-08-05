import { and, eq } from 'drizzle-orm'

import type { Happening, NewHappening } from '@/lib/db'
import {
  happenings,
  happeningWriteObject,
  happeningWriteSchema,
  happeningInvolvements,
  happeningAwareness,
} from '@/lib/db'
import { happeningsStore } from '@/lib/stores'

import { nullifyRef } from '../coerce'
import {
  register,
  type ActionHandler,
  type CascadeRestore,
  type CascadeDeleteOps,
} from '../delta/registry'
import type { DbCtx, DeltaSource } from '../types'

type HappeningUpdatePatch = Partial<{
  title: string
  description: string | null
  category: string | null
  icon: string | null
  temporal: string | null
  occurredAtEntryId: string | null
  commonKnowledge: 0 | 1
}>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createHappening: { source: DeltaSource; payload: { entry: NewHappening } }
    updateHappening: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: HappeningUpdatePatch }
    }
    deleteHappening: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

// Delta-logged columns.
const UPDATABLE = [
  'title',
  'description',
  'category',
  'icon',
  'temporal',
  'occurredAtEntryId',
  'commonKnowledge',
] as const

function fullRow(entry: NewHappening): Happening {
  // Apply SQLite defaults so the inserted row and the store create-patch row are byte-identical.
  return {
    id: entry.id,
    branchId: entry.branchId,
    title: entry.title,
    description: entry.description ?? null,
    category: entry.category ?? null,
    icon: entry.icon ?? null,
    temporal: nullifyRef(entry.temporal),
    occurredAtEntryId: nullifyRef(entry.occurredAtEntryId),
    commonKnowledge: entry.commonKnowledge ?? 0,
    embeddingStale: entry.embeddingStale ?? 0,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createHappening')
    throw new Error(`handler/kind mismatch: expected 'createHappening', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = happeningWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid happening: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'happenings',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(happenings).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateHappening')
    throw new Error(`handler/kind mismatch: expected 'updateHappening', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = happeningWriteObject.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid happening patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target happening ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    const next =
      col === 'temporal' || col === 'occurredAtEntryId' ? nullifyRef(patch[col]) : patch[col]
    set[col] = next
    undoPayload[col] = current[col as keyof Happening]
  }
  // A patch that parsed but touched no updatable column would reach Drizzle's
  // .set({}) and throw "No values to set" — reject instead.
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for happening ${bid}:${id} has no updatable fields`,
    }
  const merged = { ...current, ...set } as Happening
  // Friendly graceful-reject surface over the DDL CHECK constraint.
  if (merged.occurredAtEntryId != null && merged.temporal != null)
    return {
      status: 'rejected',
      reason: 'occurred_at_entry_id and temporal are mutually exclusive',
    }

  return {
    status: 'ok',
    targetTable: 'happenings',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(happenings)
        .set(set)
        .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

// Reads the children, then deletes them in a later transaction. Safe only while
// the classifier is the sole writer of these tables and only ever attaches rows
// to happenings it creates in the same plan — nothing can add a child to an
// existing happening mid-delete. A user-facing "add involvement" affordance
// breaks that premise and needs this read and delete in one critical section.
async function buildChildDeleteOps(branchId: string, happeningId: string, ctx: DbCtx) {
  const involvements = await ctx.db
    .select()
    .from(happeningInvolvements)
    .where(
      and(
        eq(happeningInvolvements.branchId, branchId),
        eq(happeningInvolvements.happeningId, happeningId),
      ),
    )
  const awareness = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.branchId, branchId),
        eq(happeningAwareness.happeningId, happeningId),
      ),
    )

  const ops = [
    ctx.db
      .delete(happeningInvolvements)
      .where(
        and(
          eq(happeningInvolvements.branchId, branchId),
          eq(happeningInvolvements.happeningId, happeningId),
        ),
      )
      .toSQL(),
    ctx.db
      .delete(happeningAwareness)
      .where(
        and(
          eq(happeningAwareness.branchId, branchId),
          eq(happeningAwareness.happeningId, happeningId),
        ),
      )
      .toSQL(),
  ]
  return {
    ops,
    children: {
      happening_involvements: involvements,
      happening_awareness: awareness,
    },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteHappening')
    throw new Error(`handler/kind mismatch: expected 'deleteHappening', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(happenings)
    .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target happening ${bid}:${id} not found` }

  const { ops: childDeleteOps, children } = await buildChildDeleteOps(bid, id, ctx)

  return {
    status: 'ok',
    targetTable: 'happenings',
    targetId: id,
    op: 'delete',
    // The link rows have no delta of their own here, so the parent's payload is
    // the only place reverse-replay can rebuild them from.
    undoPayload: {
      ...current,
      involvements: children.happening_involvements,
      awareness: children.happening_awareness,
    },
    ops: [
      ...childDeleteOps,
      ctx.db
        .delete(happenings)
        .where(and(eq(happenings.branchId, bid), eq(happenings.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

const restoreCascade: CascadeRestore = (undoPayload) => {
  const involvements = undoPayload.involvements as Record<string, unknown>[] | undefined
  const awareness = undoPayload.awareness as Record<string, unknown>[] | undefined

  // Both halves declared unconditionally — the engine skips the empty ones. An
  // empty array is still a key the parent row must not carry into the re-insert
  // or the store patch, so the cascade shape must not depend on the row counts.
  return {
    children: [
      { table: 'happening_involvements', rows: involvements ?? [] },
      { table: 'happening_awareness', rows: awareness ?? [] },
    ],
    cascadeKeys: ['involvements', 'awareness'],
  }
}

const cascadeDeleteOps: CascadeDeleteOps = buildChildDeleteOps

export function registerHappenings(): void {
  register({
    table: 'happenings',
    descriptor: { table: happenings, idCol: happenings.id, branchCol: happenings.branchId },
    columnSchemas: {},
    handlers: {
      createHappening: createHandler,
      updateHappening: updateHandler,
      deleteHappening: deleteHandler,
    },
    patcher: (branchId, p) => happeningsStore.patch(branchId, p),
    restoreCascade,
    cascadeDeleteOps,
  })
}
