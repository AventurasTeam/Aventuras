import type { Entity, Happening, Lore, Thread } from '@/lib/db'
import type { HistoryTable } from '@/lib/history'
import { entitiesStore, happeningsStore, loreStore, threadsStore } from '@/lib/stores'

export type HistoryTarget = Entity | Lore | Thread | Happening

/** The tab's row from the working set; a new identity whenever a write patches it. */
export function useHistoryTarget(table: HistoryTable, id: string): HistoryTarget | undefined {
  const entity = entitiesStore.useEntities((m) => (table === 'entities' ? m.get(id) : undefined))
  const lore = loreStore.useLore((m) => (table === 'lore' ? m.get(id) : undefined))
  const thread = threadsStore.useThreads((m) => (table === 'threads' ? m.get(id) : undefined))
  const happening = happeningsStore.useHappenings((m) =>
    table === 'happenings' ? m.get(id) : undefined,
  )
  return entity ?? lore ?? thread ?? happening
}

export function historyTargetName(row: HistoryTarget | undefined): string | null {
  if (row == null) return null
  return 'name' in row ? row.name : row.title
}
