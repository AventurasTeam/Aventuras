import type { HistoryTable } from '@/lib/history'
import {
  characterRelationshipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'

// Only id + the columns History shows, so a retrieval bump leaves the signature unchanged.
function signature<Row extends { id: string; branchId: string }>(
  rows: ReadonlyMap<string, Row>,
  branchId: string,
  namesTarget: (row: Row) => boolean,
  columns: (row: Row) => readonly unknown[],
): string {
  const named: string[] = []
  for (const row of rows.values())
    if (row.branchId === branchId && namesTarget(row))
      named.push(JSON.stringify([row.id, ...columns(row)]))
  return named.sort().join('\n')
}

/** A value whose identity changes only when a link row naming the target changes. */
export function useLinkVersion(table: HistoryTable, id: string, branchId: string): string {
  // Lore and threads have no link rows, so their selectors scan nothing.
  const relationships = characterRelationshipsStore.useRelationships((rows) =>
    table === 'entities'
      ? signature(
          rows,
          branchId,
          (row) => row.aId === id || row.bId === id,
          (row) => [row.kind, row.inverseKind],
        )
      : '',
  )
  const involvements = happeningInvolvementsStore.useInvolvements((rows) =>
    table === 'entities' || table === 'happenings'
      ? signature(
          rows,
          branchId,
          (row) => (table === 'entities' ? row.entityId : row.happeningId) === id,
          (row) => [row.role],
        )
      : '',
  )
  const awareness = happeningAwarenessStore.useAwareness((rows) =>
    table === 'entities' || table === 'happenings'
      ? signature(
          rows,
          branchId,
          (row) => (table === 'entities' ? row.characterId : row.happeningId) === id,
          (row) => [row.learnedAtEntryId, row.decayResistance, row.source],
        )
      : '',
  )
  return JSON.stringify([relationships, involvements, awareness])
}
