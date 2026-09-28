import { and, eq, inArray, or } from 'drizzle-orm'

import {
  deleteVecOps,
  listVecFamilyTables,
  SOURCE_TABLES,
  translations,
  type SqlOp,
  type Translation,
  type VecTargetKind,
} from '@/lib/db'

import type { DbCtx } from '../types'
import type { CascadeDeleteOps, CascadeRestore, StorePatch } from './registry'

type Rows = Record<string, unknown>[]

export type DeleteCascade = { ops: SqlOp[]; children: Record<string, Rows> }

export type TranslationTargetKind = Translation['targetKind']

const VEC_KIND_BY_TABLE = new Map<string, VecTargetKind>(
  (Object.entries(SOURCE_TABLES) as [VecTargetKind, string][]).map(([kind, table]) => [
    table,
    kind,
  ]),
)

/** Lists the dim families once per delete or reversal, however many rows it sweeps. */
export function vecTableLister(ctx: DbCtx): () => Promise<string[]> {
  let tables: Promise<string[]> | null = null
  return () => (tables ??= listVecFamilyTables(ctx.db))
}

/** A row's vectors in every dim family (retrieval.md → Compute lifecycle); none off embedded tables. */
export async function vecSweepOps(
  table: string,
  branchId: string,
  id: string,
  listTables: () => Promise<string[]>,
): Promise<SqlOp[]> {
  const kind = VEC_KIND_BY_TABLE.get(table)
  return kind === undefined ? [] : deleteVecOps(kind, id, branchId, await listTables())
}

/** Translations of the named targets, deleted by the ids read so the payload holds exactly what went. */
export async function translationCascade(
  ctx: DbCtx,
  branchId: string,
  targets: readonly { kind: TranslationTargetKind; ids: readonly string[] }[],
): Promise<DeleteCascade> {
  const clauses = targets
    .filter((target) => target.ids.length > 0)
    .map((target) =>
      and(
        eq(translations.targetKind, target.kind),
        inArray(translations.targetId, [...target.ids]),
      ),
    )
  if (clauses.length === 0) return { ops: [], children: { translations: [] } }
  const rows = await ctx.db
    .select()
    .from(translations)
    .where(and(eq(translations.branchId, branchId), or(...clauses)))
  const ops =
    rows.length === 0
      ? []
      : [
          ctx.db
            .delete(translations)
            .where(
              and(
                eq(translations.branchId, branchId),
                inArray(
                  translations.id,
                  rows.map((row) => row.id),
                ),
              ),
            )
            .toSQL(),
        ]
  return { ops, children: { translations: rows } }
}

/** A lore, thread or chapter row's cascade: its translations and its vectors. */
export function rowCascade(table: string, kind: TranslationTargetKind): CascadeDeleteOps {
  return async (branchId, id, ctx) => {
    const own = await translationCascade(ctx, branchId, [{ kind, ids: [id] }])
    const vectors = await vecSweepOps(table, branchId, id, vecTableLister(ctx))
    return { ops: [...own.ops, ...vectors], children: own.children }
  }
}

// The undo-payload key each child table's rows ride under; `involvements` / `awareness` predate this.
const PAYLOAD_KEY: Record<string, string> = {
  happening_involvements: 'involvements',
  happening_awareness: 'awareness',
  character_relationships: 'relationships',
  translations: 'translations',
}

function payloadKey(table: string): string {
  return PAYLOAD_KEY[table] ?? table
}

export function payloadFromChildren(children: Record<string, Rows>): Record<string, Rows> {
  return Object.fromEntries(
    Object.entries(children).map(([table, rows]) => [payloadKey(table), rows]),
  )
}

/** Restores `tables`' rows from a delete's payload; a payload written before a table joined reads empty. */
export function restoreChildren(tables: readonly string[]): CascadeRestore {
  return (undoPayload) => ({
    children: tables.map((table) => ({
      table,
      rows: (undoPayload[payloadKey(table)] as Rows | undefined) ?? [],
    })),
    cascadeKeys: tables.map(payloadKey),
  })
}

export function cascadePatches(
  children: Record<string, Rows>,
): { table: string; patch: StorePatch }[] {
  return Object.entries(children).flatMap(([table, rows]) =>
    rows.map((row) => ({ table, patch: { op: 'delete' as const, id: row.id as string } })),
  )
}
