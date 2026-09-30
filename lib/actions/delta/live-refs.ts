import { and, eq } from 'drizzle-orm'

import { entities, happenings } from '@/lib/db'

import type { DbCtx } from '../types'
import { createdKey, type GroupScope, type HandlerOutcome } from './registry'

export type LiveRef = { table: 'entities' | 'happenings'; id: string }

const LINK_REF_COLUMNS: Record<string, readonly (readonly [string, LiveRef['table']])[]> = {
  happening_involvements: [
    ['happeningId', 'happenings'],
    ['entityId', 'entities'],
  ],
  happening_awareness: [
    ['happeningId', 'happenings'],
    ['characterId', 'entities'],
  ],
  character_relationships: [
    ['aId', 'entities'],
    ['bId', 'entities'],
  ],
}

/** The rows a link-table row names; none for any other table, or a row lacking the columns. */
export function linkRefs(table: string, row: Record<string, unknown>): LiveRef[] {
  return (LINK_REF_COLUMNS[table] ?? []).flatMap(([column, refTable]) => {
    const id = row[column]
    return typeof id === 'string' ? [{ table: refTable, id }] : []
  })
}

async function exists(ctx: DbCtx, branchId: string, ref: LiveRef): Promise<boolean> {
  if (ref.table === 'entities') {
    const [row] = await ctx.db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.branchId, branchId), eq(entities.id, ref.id)))
    return row != null
  }
  const [row] = await ctx.db
    .select({ id: happenings.id })
    .from(happenings)
    .where(and(eq(happenings.branchId, branchId), eq(happenings.id, ref.id)))
  return row != null
}

/** FK-less link tables take a dead id (cadence.md → Live-row guards); group-created rows count. */
export async function missingRef(
  ctx: DbCtx,
  branchId: string,
  refs: readonly LiveRef[],
  group?: GroupScope,
): Promise<boolean> {
  for (const ref of refs) {
    if (group?.created.has(createdKey(ref.table, ref.id))) continue
    if (!(await exists(ctx, branchId, ref))) return true
  }
  return false
}

export const MISSING_REF = {
  status: 'rejected',
  reason: 'the link names a row that no longer exists',
  code: 'noop',
} as const satisfies Extract<HandlerOutcome, { status: 'rejected' }>
