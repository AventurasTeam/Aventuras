import { useMemo, useState } from 'react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { formatEntryRef } from '@/lib/entry-refs'
import {
  humanizeDelta,
  type HistoryOp,
  type HistoryRow,
  type HistorySort,
  type HistoryTable,
} from '@/lib/history'
import { t } from '@/lib/i18n'
import { entitiesStore, generationStore, happeningsStore } from '@/lib/stores'

import { HistoryTabView } from './history-tab-view'
import { useHistoryChunks } from './use-history-chunks'
import { historyTargetName, useHistoryTarget } from './use-history-target'
import { useLinkVersion } from './use-link-version'

const SEARCH_DEBOUNCE_MS = 250

export type HistoryTabProps = { branchId: string; targetTable: HistoryTable; targetId: string }

/** C4: one row's delta log; keyed by target so switching rows remounts and resets it. */
export function HistoryTab(props: HistoryTabProps) {
  return <HistoryTabForTarget key={`${props.targetTable}:${props.targetId}`} {...props} />
}

// Working-set names for the rows' other ends. Selectors return a string, so a patch to any
// other row leaves the tab alone.
function useStoreNames(branchId: string, rows: readonly HistoryRow[]): ReadonlyMap<string, string> {
  const ids = useMemo(
    () => [...new Set(rows.flatMap((row) => (row.via.kind === 'own' ? [] : [row.via.otherId])))],
    [rows],
  )
  const entityNames = entitiesStore.useEntities((m) =>
    JSON.stringify(ids.map((id) => (m.get(id)?.branchId === branchId ? m.get(id)?.name : null))),
  )
  const happeningTitles = happeningsStore.useHappenings((m) =>
    JSON.stringify(ids.map((id) => (m.get(id)?.branchId === branchId ? m.get(id)?.title : null))),
  )
  return useMemo(() => {
    const entity = JSON.parse(entityNames) as (string | null)[]
    const happening = JSON.parse(happeningTitles) as (string | null)[]
    const names = new Map<string, string>()
    ids.forEach((id, i) => {
      const name = entity[i] ?? happening[i]
      if (name != null) names.set(id, name)
    })
    return names
  }, [ids, entityNames, happeningTitles])
}

function HistoryTabForTarget({ branchId, targetTable, targetId }: HistoryTabProps) {
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  const [op, setOp] = useState<HistoryOp | null>(null)
  const [sort, setSort] = useState<HistorySort>('newest')
  const row = useHistoryTarget(targetTable, targetId)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const links = useLinkVersion(targetTable, targetId, branchId)
  // Fresh identity when the row or a link row naming it is patched, or a run/reversal settles.
  const version = useMemo(() => ({ row, settleCount, links }), [row, settleCount, links])
  const chunks = useHistoryChunks(
    { branchId, targetTable, targetId, op: op ?? undefined, search, sort },
    version,
  )
  const entryIndex = useEntryIndex(branchId)
  const storeNames = useStoreNames(branchId, chunks.rows)
  const name = historyTargetName(row) ?? t('history:unknownTarget')
  const rows = useMemo(() => {
    const nowMs = Date.now()
    const entryLabel = (entryId: string) => {
      const ref = entryIndex.index.get(entryId)
      return ref == null ? null : formatEntryRef(ref.position)
    }
    // The working set first, so a renamed other end reads its new name.
    const otherName = (id: string) => storeNames.get(id) ?? chunks.names[id] ?? null
    return chunks.rows.map((historyRow) =>
      humanizeDelta(historyRow, { targetTable, targetName: name, otherName, entryLabel, nowMs }),
    )
  }, [chunks.rows, chunks.names, entryIndex.index, targetTable, name, storeNames])

  return (
    <HistoryTabView
      rows={rows}
      status={chunks.status}
      hasMore={chunks.hasMore}
      filtered={search !== '' || op != null}
      search={searchInput}
      onSearchChange={setSearchInput}
      op={op}
      onOpChange={setOp}
      sort={sort}
      onSortChange={setSort}
      onLoadMore={chunks.loadMore}
      onRetry={chunks.retry}
    />
  )
}
