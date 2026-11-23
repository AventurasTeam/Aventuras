import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import { isPayloadMetaKey, undoneColumnOf } from '@/lib/actions'
import {
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  readChainSnapshot,
  threads,
  type ChainSnapshot,
  type DbCtx,
  type Delta,
} from '@/lib/db'
import { isJsonObject } from '@/lib/json-object'

import { HELD_KEY, HOLDING_TABLES, namesOf } from './link-ends'
import { HISTORY_LINK_TABLES, isRetrievalBump, type HistoryLinkTable } from './link-rows'
import { DIFF_TABLES, refIdsOf, type DiffTable, type DiffValues } from './prose-fields'

export type DiffCacheEntry = DiffValues & {
  /** Walk-time names of the entry's ref ids: stored row, else latest delete payload. */
  readonly names: Readonly<Record<string, string>>
}

export type WalkResult = {
  /** One entry per listed update on the path, by delta id. */
  readonly entries: ReadonlyMap<string, DiffCacheEntry>
  /** Requested ids absent from their chain: pruned after their row loaded. */
  readonly gone: ReadonlySet<string>
}

/** The walk can't give entries: mixed or unlisted input, or a target with nothing to seed from. */
export class DiffWalkError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'DiffWalkError'
  }
}

/** Walks one target; every requested delta is an update on the same branch, table and target. */
export type DiffWalk = (requested: readonly Delta[]) => Promise<WalkResult>

type RowKey = { table: SQLiteTable; idCol: SQLiteColumn; branchCol: SQLiteColumn }

/** Each listed table's row and key columns, as the snapshot reads the target row. */
export const DIFF_TABLE_ROWS: Readonly<Record<DiffTable, RowKey>> = {
  entities: { table: entities, idCol: entities.id, branchCol: entities.branchId },
  lore: { table: lore, idCol: lore.id, branchCol: lore.branchId },
  threads: { table: threads, idCol: threads.id, branchCol: threads.branchId },
  happenings: { table: happenings, idCol: happenings.id, branchCol: happenings.branchId },
  character_relationships: {
    table: characterRelationships,
    idCol: characterRelationships.id,
    branchCol: characterRelationships.branchId,
  },
  happening_involvements: {
    table: happeningInvolvements,
    idCol: happeningInvolvements.id,
    branchCol: happeningInvolvements.branchId,
  },
  happening_awareness: {
    table: happeningAwareness,
    idCol: happeningAwareness.id,
    branchCol: happeningAwareness.branchId,
  },
}

const isDiffTable = (table: string): table is DiffTable =>
  (DIFF_TABLES as readonly string[]).includes(table)

const isLinkTable = (table: DiffTable): table is HistoryLinkTable =>
  (HISTORY_LINK_TABLES as readonly string[]).includes(table)

const sameTarget = (delta: Delta, first: Delta): boolean =>
  delta.op === 'update' &&
  delta.branchId === first.branchId &&
  delta.targetTable === first.targetTable &&
  delta.targetId === first.targetId

// A link row removed with its other end lives on in that end's delete payload, under its cascade
// key (generation-pipeline.md → Reverse-replay).
async function heldCopy(
  db: DbCtx['db'],
  branchId: string,
  table: HistoryLinkTable,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const key = HELD_KEY[table]
  const holders = await db
    .select({ logPosition: deltas.logPosition, undoPayload: deltas.undoPayload })
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, branchId),
        eq(deltas.op, 'delete'),
        inArray(deltas.targetTable, HOLDING_TABLES),
        sql`EXISTS (SELECT 1 FROM json_each(${deltas.undoPayload}, ${`$.${key}`}) AS held
          WHERE json_extract(held.value, '$.id') = ${targetId})`,
      ),
    )
  holders.sort((x, y) => y.logPosition - x.logPosition)
  for (const holder of holders) {
    const rows = holder.undoPayload?.[key]
    const copy = Array.isArray(rows)
      ? rows.find((row) => isJsonObject(row) && row.id === targetId)
      : undefined
    if (isJsonObject(copy)) return copy
  }
  return null
}

// The row as it stands, else the copy a later delete holds: the chain's own delete, else another
// row's delete that removed it.
async function seedOf(
  db: DbCtx['db'],
  snapshot: ChainSnapshot,
  table: DiffTable,
  branchId: string,
  targetId: string,
): Promise<Record<string, unknown>> {
  if (snapshot.row != null) return snapshot.row
  const head = snapshot.chain.at(-1)
  if (head?.op === 'delete' && head.undoPayload != null) return head.undoPayload
  const held = isLinkTable(table) ? await heldCopy(db, branchId, table, targetId) : null
  if (held != null) return held
  throw new DiffWalkError(`no row, head delete or held copy for ${table} ${targetId}`)
}

/** Walks one target's chain newest to oldest, giving each listed update its old and new values. */
export async function walkTarget(
  db: DbCtx['db'],
  requested: readonly Delta[],
): Promise<WalkResult> {
  const first = requested[0]
  if (first === undefined || !requested.every((delta) => sameTarget(delta, first)))
    throw new DiffWalkError('mixed targets')
  const { branchId, targetTable, targetId } = first
  if (!isDiffTable(targetTable)) throw new DiffWalkError(`no diff for table ${targetTable}`)

  const snapshot = await readChainSnapshot(db, {
    branchId,
    targetTable,
    targetId,
    fromLogPosition: requested.reduce(
      (oldest, delta) => Math.min(oldest, delta.logPosition),
      Infinity,
    ),
    row: DIFF_TABLE_ROWS[targetTable],
  })
  const chained = new Set(snapshot.chain.map((delta) => delta.id))
  const gone = new Set(requested.filter((delta) => !chained.has(delta.id)).map((delta) => delta.id))
  if (requested.every((delta) => gone.has(delta.id))) return { entries: new Map(), gone }

  const state: Record<string, unknown> = {
    ...(await seedOf(db, snapshot, targetTable, branchId, targetId)),
  }
  const stepped = new Map<string, DiffValues>()
  for (let i = snapshot.chain.length - 1; i >= 0; i--) {
    const delta = snapshot.chain[i]
    if (delta.op !== 'update') continue
    const payload = delta.undoPayload ?? {}
    const keys = Object.keys(payload).filter((key) => !isPayloadMetaKey(key))
    // Stepped through, never listed: a retrieval bumps each aware row once a turn.
    if (!isRetrievalBump(delta))
      stepped.set(delta.id, {
        old: Object.fromEntries(keys.map((key) => [key, payload[key]])),
        new: Object.fromEntries(keys.map((key) => [key, state[key]])),
      })
    for (const key of keys) state[key] = undoneColumnOf(targetTable, key, payload[key], state[key])
  }

  const ids = [...new Set([...stepped.values()].flatMap((values) => refIdsOf(targetTable, values)))]
  const names = ids.length === 0 ? {} : await namesOf(db, branchId, ids)
  const entries = new Map<string, DiffCacheEntry>()
  for (const [id, values] of stepped) entries.set(id, { ...values, names })
  return { entries, gone }
}
