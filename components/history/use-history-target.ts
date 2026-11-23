import type { Entity, Happening, Lore, Thread } from '@/lib/db'
import type { HistoryTable } from '@/lib/history'
import { entitiesStore, happeningsStore, loreStore, threadsStore } from '@/lib/stores'

export type HistoryTarget = Entity | Lore | Thread | Happening

/** The tab's row on its branch, from the working set; a new identity whenever a write patches it. */
export function useHistoryTarget(
  branchId: string,
  table: HistoryTable,
  id: string,
): HistoryTarget | undefined {
  const entity = entitiesStore.useById(branchId, id)
  const lore = loreStore.useById(branchId, id)
  const thread = threadsStore.useById(branchId, id)
  const happening = happeningsStore.useById(branchId, id)
  switch (table) {
    case 'entities':
      return entity
    case 'lore':
      return lore
    case 'threads':
      return thread
    case 'happenings':
      return happening
  }
}

export function historyTargetName(row: HistoryTarget | undefined): string | null {
  if (row == null) return null
  return 'name' in row ? row.name : row.title
}
