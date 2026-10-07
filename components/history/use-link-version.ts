import { HISTORY_LINK_WATCH, type HistoryLinkWatch, type HistoryTable } from '@/lib/history'
import {
  characterRelationshipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'

// Id and the columns whose change gets a delta listed, so a retrieval bump leaves it unchanged.
function signature<Row extends { id: string; branchId: string }>(
  rows: ReadonlyMap<string, Row>,
  branchId: string,
  id: string,
  watch: HistoryLinkWatch | undefined,
): string {
  if (watch == null) return ''
  const named: string[] = []
  for (const row of rows.values()) {
    const cells: Readonly<Record<string, unknown>> = row
    if (row.branchId === branchId && watch.keys.some((key) => cells[key] === id))
      named.push(JSON.stringify([row.id, ...watch.listed.map((column) => cells[column])]))
  }
  return named.sort().join('\n')
}

/** A value whose identity changes only when a link row naming the target changes. */
export function useLinkVersion(table: HistoryTable, id: string, branchId: string): string {
  // A table no link row names (lore, threads) watches nothing, so its selectors scan nothing.
  const watch = HISTORY_LINK_WATCH[table]
  const relationships = characterRelationshipsStore.useRelationships((rows) =>
    signature(rows, branchId, id, watch.character_relationships),
  )
  const involvements = happeningInvolvementsStore.useInvolvements((rows) =>
    signature(rows, branchId, id, watch.happening_involvements),
  )
  const awareness = happeningAwarenessStore.useAwareness((rows) =>
    signature(rows, branchId, id, watch.happening_awareness),
  )
  return JSON.stringify([relationships, involvements, awareness])
}
