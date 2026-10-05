import { and, eq } from 'drizzle-orm'

import {
  translations,
  type CharacterRelationship,
  type HappeningAwareness,
  type HappeningInvolvement,
  type Translation,
} from '@/lib/db'

import type { DbCtx } from '../types'
import { createdKey, resolveByTable, type GroupScope, type HandlerOutcome } from './registry'

/** Tables a row can name: the link tables' ends, and every translation target. */
export type RefTable =
  | 'entities'
  | 'happenings'
  | 'lore'
  | 'threads'
  | 'story_entries'
  | 'character_relationships'
  | 'chapters'

export type LiveRef = { table: RefTable; id: string }

type ReferringRows = {
  happening_involvements: HappeningInvolvement
  happening_awareness: HappeningAwareness
  character_relationships: CharacterRelationship
  translations: Translation
}

/** Tables whose rows name other rows. */
export type ReferringTable = keyof ReferringRows

/** A column of `Row` naming a `refTable` row; `when` limits it to one translation target kind. */
type RefColumnOf<Row> = {
  readonly column: keyof Row & string
  readonly refTable: RefTable
  readonly when?: { readonly column: keyof Row & string; readonly value: Translation['targetKind'] }
}

export type RefColumn = { [T in ReferringTable]: RefColumnOf<ReferringRows[T]> }[ReferringTable]

export const TRANSLATION_TARGET_TABLE = {
  entity: 'entities',
  lore: 'lore',
  thread: 'threads',
  happening: 'happenings',
  story_entry: 'story_entries',
  character_relationship: 'character_relationships',
  chapter: 'chapters',
} as const satisfies Record<Translation['targetKind'], RefTable>

/**
 * The one reference registry, keyed by the referring table's registered name
 * (generation-pipeline.md → Reverse-replay).
 */
export const REF_COLUMNS: {
  readonly [T in ReferringTable]: readonly RefColumnOf<ReferringRows[T]>[]
} = {
  happening_involvements: [
    { column: 'happeningId', refTable: 'happenings' },
    { column: 'entityId', refTable: 'entities' },
  ],
  happening_awareness: [
    { column: 'happeningId', refTable: 'happenings' },
    { column: 'characterId', refTable: 'entities' },
  ],
  character_relationships: [
    { column: 'aId', refTable: 'entities' },
    { column: 'bId', refTable: 'entities' },
  ],
  translations: translations.targetKind.enumValues.map((kind) => ({
    column: 'targetId',
    refTable: TRANSLATION_TARGET_TABLE[kind],
    when: { column: 'targetKind', value: kind },
  })),
}

// The annotation above closes REF_COLUMNS' keys, so its entries are exactly these.
const REFERRING = Object.entries(REF_COLUMNS) as [ReferringTable, readonly RefColumn[]][]

const isReferringTable = (table: string): table is ReferringTable =>
  Object.hasOwn(REF_COLUMNS, table)

const REF_TABLES: ReadonlySet<string> = new Set(
  REFERRING.flatMap(([, refs]) => refs.map((ref) => ref.refTable)),
)

/** Whether some REF_COLUMNS entry can name a row of `table`. */
export function isRefTable(table: string): table is RefTable {
  return REF_TABLES.has(table)
}

/** The rows `row` of `table` names; none if the table names nothing or the row lacks columns. */
export function rowRefs(table: string, row: Record<string, unknown>): LiveRef[] {
  const refs: readonly RefColumn[] = isReferringTable(table) ? REF_COLUMNS[table] : []
  return refs.flatMap(({ column, refTable, when }) => {
    if (when && row[when.column] !== when.value) return []
    const id = row[column]
    return typeof id === 'string' ? [{ table: refTable, id }] : []
  })
}

const REFERRERS = new Map<RefTable, { table: ReferringTable; ref: RefColumn }[]>()
for (const [table, refs] of REFERRING) {
  for (const ref of refs) {
    const referrers = REFERRERS.get(ref.refTable) ?? []
    referrers.push({ table, ref })
    REFERRERS.set(ref.refTable, referrers)
  }
}

/** Every referring table and column that can name a row of `refTable`. */
export function referrersOf(
  refTable: RefTable,
): readonly { table: ReferringTable; ref: RefColumn }[] {
  return REFERRERS.get(refTable) ?? []
}

async function exists(ctx: DbCtx, branchId: string, ref: LiveRef): Promise<boolean> {
  const entry = resolveByTable(ref.table)
  if (!entry) throw new Error(`missingRef: ${ref.table} is not a registered table`)
  const { table, idCol, branchCol } = entry.descriptor
  const [row] = await ctx.db
    .select({ id: idCol })
    .from(table)
    .where(branchCol ? and(eq(branchCol, branchId), eq(idCol, ref.id)) : eq(idCol, ref.id))
    .limit(1)
  return row != null
}

/**
 * FK-less tables take a dead id (cadence.md → User edits and classifier writes); group-created
 * rows count.
 */
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
