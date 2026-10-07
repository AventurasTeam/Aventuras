import type { HistoryTable } from '@/lib/history'
import {
  characterRelationshipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'

// The rows naming the target, by id and the columns History shows; a retrieval bump changes none.
function signature<Row extends { id: string }>(
  rows: ReadonlyMap<string, Row>,
  namesTarget: (row: Row) => boolean,
  columns: (row: Row) => readonly unknown[],
): string {
  const named: string[] = []
  for (const row of rows.values())
    if (namesTarget(row)) named.push(JSON.stringify([row.id, ...columns(row)]))
  return named.sort().join('\n')
}

/** A value whose identity changes only when a link row naming the target changes. */
export function useLinkVersion(table: HistoryTable, id: string): string {
  const relationships = characterRelationshipsStore.useRelationships((rows) =>
    table === 'entities'
      ? signature(
          rows,
          (row) => row.aId === id || row.bId === id,
          (row) => [row.kind, row.inverseKind],
        )
      : '',
  )
  const involvements = happeningInvolvementsStore.useInvolvements((rows) =>
    signature(
      rows,
      (row) =>
        (table === 'entities' && row.entityId === id) ||
        (table === 'happenings' && row.happeningId === id),
      (row) => [row.role],
    ),
  )
  const awareness = happeningAwarenessStore.useAwareness((rows) =>
    signature(
      rows,
      (row) =>
        (table === 'entities' && row.characterId === id) ||
        (table === 'happenings' && row.happeningId === id),
      (row) => [row.learnedAtEntryId, row.decayResistance, row.source],
    ),
  )
  return JSON.stringify([relationships, involvements, awareness])
}
