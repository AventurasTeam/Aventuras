import { and, eq, getTableColumns, inArray } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'

import {
  characterRelationships,
  happeningAwareness,
  happeningInvolvements,
  type DbCtx,
} from '@/lib/db'

import type { SignalDelta } from './types'

export const LINK_TABLES = [
  'happening_awareness',
  'happening_involvements',
  'character_relationships',
] as const
export type LinkTable = (typeof LINK_TABLES)[number]

export function isLinkTable(table: string): table is LinkTable {
  return (LINK_TABLES as readonly string[]).includes(table)
}

export type LinkDeltaRow = {
  source: SignalDelta['source']
  targetTable: LinkTable
  targetId: string
  logPosition: number
  op: 'create' | 'update' | 'delete'
  undoPayload: Record<string, unknown> | null
}

type Owner = { targetTable: 'entities' | 'happenings'; targetId: string }

type LinkDescriptor = {
  table: SQLiteTable
  branchCol: SQLiteColumn
  // Row/payload key -> the table it owns. Drives both the undo-payload and row-lookup paths.
  owners: readonly (readonly [key: string, ownerTable: 'entities' | 'happenings'])[]
}

const LINK_DESCRIPTORS: Record<LinkTable, LinkDescriptor> = {
  happening_awareness: {
    table: happeningAwareness,
    branchCol: happeningAwareness.branchId,
    owners: [
      ['happeningId', 'happenings'],
      ['characterId', 'entities'],
    ],
  },
  happening_involvements: {
    table: happeningInvolvements,
    branchCol: happeningInvolvements.branchId,
    owners: [
      ['happeningId', 'happenings'],
      ['entityId', 'entities'],
    ],
  },
  character_relationships: {
    table: characterRelationships,
    branchCol: characterRelationships.branchId,
    owners: [
      ['aId', 'entities'],
      ['bId', 'entities'],
    ],
  },
}

// per-turn-retrieval.ts bumps retrieval_count every turn; counting it would
// over-tint every aware character.
function isRetrievalBumpOnly(
  op: LinkDeltaRow['op'],
  payload: LinkDeltaRow['undoPayload'],
): boolean {
  if (op !== 'update' || payload == null) return false
  return Object.keys(payload).every((k) => k === 'retrievalCount')
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function ownersFromPayload(
  descriptor: LinkDescriptor,
  payload: Record<string, unknown>,
): Owner[] | null {
  const owners: Owner[] = []
  for (const [key, ownerTable] of descriptor.owners) {
    const id = stringOrNull(payload[key])
    if (id == null) return null
    owners.push({ targetTable: ownerTable, targetId: id })
  }
  return owners
}

async function fetchOwners(
  db: DbCtx['db'],
  branchId: string,
  descriptor: LinkDescriptor,
  ids: readonly string[],
): Promise<Map<string, Owner[]>> {
  const map = new Map<string, Owner[]>()
  if (ids.length === 0) return map
  const columns = getTableColumns(descriptor.table)
  const selection: Record<string, SQLiteColumn> = { id: columns.id }
  for (const [key] of descriptor.owners) selection[key] = columns[key]
  const rows = await db
    .select(selection)
    .from(descriptor.table)
    .where(and(eq(descriptor.branchCol, branchId), inArray(columns.id, ids)))
  for (const r of rows) {
    const id = stringOrNull(r.id)
    const owners = ownersFromPayload(descriptor, r)
    if (id != null && owners != null) map.set(id, owners)
  }
  return map
}

/**
 * Resolves link-table deltas to their owning row(s). Deletes read owners from the undo
 * payload; creates/updates look the link row up (one query per table). A lookup miss is
 * dropped — an in-window delete for the same link emits its own owners separately.
 */
export async function resolveLinkOwners(
  db: DbCtx['db'],
  branchId: string,
  rows: readonly LinkDeltaRow[],
): Promise<SignalDelta[]> {
  // Retrieval bumps are always plain updates; drop them once, before any resolution.
  const relevant = rows.filter((r) => !isRetrievalBumpOnly(r.op, r.undoPayload))

  const pendingByTable: Record<LinkTable, string[]> = {
    happening_awareness: [],
    happening_involvements: [],
    character_relationships: [],
  }
  for (const r of relevant) {
    if (r.op !== 'delete') pendingByTable[r.targetTable].push(r.targetId)
  }
  const fetched = Object.fromEntries(
    await Promise.all(
      LINK_TABLES.map(
        async (table) =>
          [
            table,
            await fetchOwners(db, branchId, LINK_DESCRIPTORS[table], pendingByTable[table]),
          ] as const,
      ),
    ),
  ) as Record<LinkTable, Map<string, Owner[]>>

  const out: SignalDelta[] = []
  for (const r of relevant) {
    const owners =
      r.op === 'delete'
        ? r.undoPayload != null
          ? ownersFromPayload(LINK_DESCRIPTORS[r.targetTable], r.undoPayload)
          : null
        : (fetched[r.targetTable].get(r.targetId) ?? null)
    if (owners == null) continue
    for (const o of owners) {
      out.push({
        source: r.source,
        targetTable: o.targetTable,
        targetId: o.targetId,
        logPosition: r.logPosition,
      })
    }
  }
  return out
}
