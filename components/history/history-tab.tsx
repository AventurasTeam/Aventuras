import { useEffect, useMemo, useReducer, useRef, useState } from 'react'

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

/** How long refresh triggers must hold still before the tab refetches once for all of them. */
export const REFRESH_COALESCE_MS = 150

export type HistoryTabProps = { branchId: string; targetTable: HistoryTable; targetId: string }

/** C4: one row's delta log; keyed by target so switching rows remounts and resets it. */
export function HistoryTab(props: HistoryTabProps) {
  return <HistoryTabForTarget key={`${props.targetTable}:${props.targetId}`} {...props} />
}

function otherEndIds(rows: readonly HistoryRow[]): string[] {
  return [...new Set(rows.flatMap((row) => (row.via.kind === 'own' ? [] : [row.via.otherId])))]
}

// Working-set names for the rows' other ends. Selectors return a string, so a patch to any
// other row leaves the tab alone.
function useStoreNames(branchId: string, ids: readonly string[]): ReadonlyMap<string, string> {
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

// A shown other end that leaves the working set must re-read its name from its delete payload,
// and under a search a rename changes which rows match server-side; either calls `onChange`.
function useOtherEndChanges(
  names: ReadonlyMap<string, string>,
  ids: readonly string[],
  searching: boolean,
  onChange: () => void,
): void {
  const seen = useRef(names)
  useEffect(() => {
    const before = seen.current
    seen.current = names
    const changed = ids.some((id) => {
      const was = before.get(id)
      if (was == null) return false
      const now = names.get(id)
      return now == null || (searching && now !== was)
    })
    if (changed) onChange()
  }, [names, ids, searching, onChange])
}

function HistoryTabForTarget({ branchId, targetTable, targetId }: HistoryTabProps) {
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  const [op, setOp] = useState<HistoryOp | null>(null)
  const [sort, setSort] = useState<HistorySort>('newest')
  const row = useHistoryTarget(targetTable, targetId)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  const links = useLinkVersion(targetTable, targetId, branchId)
  const [otherEnds, otherEndChanged] = useReducer((n: number) => n + 1, 0)
  // Fresh identity on world.md → History tab's Refresh triggers; a retrieval bump isn't one.
  const version = useMemo(
    () => ({ row, settleCount, links, otherEnds }),
    [row, settleCount, links, otherEnds],
  )
  // A classifier pass commits each write on its own; the burst gets one refetch, after it.
  const settledVersion = useDebouncedValue(version, REFRESH_COALESCE_MS)
  const chunks = useHistoryChunks(
    { branchId, targetTable, targetId, op: op ?? undefined, search, sort },
    settledVersion,
  )
  const entryIndex = useEntryIndex(branchId)
  const otherIds = useMemo(() => otherEndIds(chunks.rows), [chunks.rows])
  const storeNames = useStoreNames(branchId, otherIds)
  useOtherEndChanges(storeNames, otherIds, search !== '', otherEndChanged)
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
