import { and, eq, inArray, or } from 'drizzle-orm'

import {
  deleteVecIdsOps,
  deleteVecOps,
  listVecFamilyTables,
  SOURCE_TABLES,
  translations,
  type SqlOp,
  type Translation,
  type VecTargetKind,
} from '@/lib/db'

import type { DbCtx } from '../types'
import type { Cascade, StorePatch } from './registry'

type Rows = Record<string, unknown>[]

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

/** An embedded row's vectors in every dim family (retrieval.md → Compute lifecycle). */
export async function vecSweepOps(
  kind: VecTargetKind,
  branchId: string,
  id: string,
  listTables: () => Promise<string[]>,
): Promise<SqlOp[]> {
  return deleteVecOps(kind, id, branchId, await listTables())
}

/**
 * `vecSweepOps` for many rows of one table and branch: one statement per dim family. Takes the
 * table a delta names, so it sweeps nothing off embedded tables.
 */
export async function vecSweepIdsOps(
  table: string,
  branchId: string,
  ids: readonly string[],
  listTables: () => Promise<string[]>,
): Promise<SqlOp[]> {
  const kind = VEC_KIND_BY_TABLE.get(table)
  return kind === undefined || ids.length === 0
    ? []
    : deleteVecIdsOps(kind, ids, branchId, await listTables())
}

/** Translations of the named targets, deleted by the ids read so the payload holds exactly what went. */
export async function translationCascade(
  ctx: DbCtx,
  branchId: string,
  targets: readonly { kind: TranslationTargetKind; ids: readonly string[] }[],
): Promise<{ ops: SqlOp[]; children: { translations: Translation[] } }> {
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

type CascadeRun<C> = (
  branchId: string,
  targetId: string,
  ctx: DbCtx,
) => Promise<{ ops: SqlOp[]; children: C }>

/**
 * Declares a cascade once: `run`'s children are keyed by exactly the tables named, so the rows a
 * delete captures and the rows its undo restores can't drift apart.
 */
export function defineCascade<const T extends string, C extends Record<T, Rows>>(
  tables: readonly T[],
  run: CascadeRun<C> & (keyof C extends T ? unknown : never),
): Cascade<T> {
  return { tables, run }
}

/** An embedded row's own cascade: its translations and its vectors. */
export function rowCascade(kind: VecTargetKind): Cascade<'translations'> {
  return defineCascade(['translations'], async (branchId, id, ctx) => {
    const own = await translationCascade(ctx, branchId, [{ kind, ids: [id] }])
    const vectors = await vecSweepOps(kind, branchId, id, vecTableLister(ctx))
    return { ops: [...own.ops, ...vectors], children: own.children }
  })
}

// Stored undo payloads fix these key names; other tables ride under their table name.
const PAYLOAD_KEY: Record<string, string> = {
  happening_involvements: 'involvements',
  happening_awareness: 'awareness',
  character_relationships: 'relationships',
}

function payloadKey(table: string): string {
  return PAYLOAD_KEY[table] ?? table
}

export function payloadFromChildren(children: Record<string, Rows>): Record<string, Rows> {
  return Object.fromEntries(
    Object.entries(children).map(([table, rows]) => [payloadKey(table), rows]),
  )
}

export type CapturedChildren = { table: string; rows: Rows }[]

/**
 * The child rows a delete's payload captured, by registered table, and the payload keys holding
 * them. A payload written before a table joined the cascade reads empty for it.
 */
export function capturedChildren(
  cascade: Cascade | undefined,
  undoPayload: Record<string, unknown>,
): { children: CapturedChildren; cascadeKeys: string[] } {
  const tables = cascade?.tables ?? []
  return {
    children: tables.map((table) => ({
      table,
      rows: (undoPayload[payloadKey(table)] as Rows | undefined) ?? [],
    })),
    cascadeKeys: tables.map(payloadKey),
  }
}

type ChildPatch = { table: string; patch: StorePatch }

function deletePatches(table: string, rows: Rows): ChildPatch[] {
  return rows.map((row) => ({ table, patch: { op: 'delete' as const, id: row.id as string } }))
}

/** Store patches for the rows a cascade's `run` just removed. */
export function cascadePatches(children: Record<string, Rows>): ChildPatch[] {
  return Object.entries(children).flatMap(([table, rows]) => deletePatches(table, rows))
}

/** Store patches for the rows a delete's payload captured — what its undo would restore. */
export function capturedPatches(
  cascade: Cascade | undefined,
  undoPayload: Record<string, unknown> | null,
): ChildPatch[] {
  if (undoPayload == null) return []
  return capturedChildren(cascade, undoPayload).children.flatMap(({ table, rows }) =>
    deletePatches(table, rows),
  )
}
