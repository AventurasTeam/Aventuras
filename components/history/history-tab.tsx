import { useMemo, useState } from 'react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { formatEntryRef } from '@/lib/entry-refs'
import {
  humanizeDelta,
  pathsMatchingLabel,
  type HistoryOp,
  type HistorySort,
  type HistoryTable,
} from '@/lib/history'
import { t } from '@/lib/i18n'
import { generationStore } from '@/lib/stores'

import { HistoryTabView } from './history-tab-view'
import { useHistoryChunks } from './use-history-chunks'
import { historyTargetName, useHistoryTarget } from './use-history-target'

const SEARCH_DEBOUNCE_MS = 250

export type HistoryTabProps = { branchId: string; targetTable: HistoryTable; targetId: string }

/** C4: one row's delta log. */
export function HistoryTab({ branchId, targetTable, targetId }: HistoryTabProps) {
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  const [op, setOp] = useState<HistoryOp | null>(null)
  const [sort, setSort] = useState<HistorySort>('newest')
  const row = useHistoryTarget(targetTable, targetId)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  // A fresh identity whenever the row is patched or a run or reversal settles: the log may have moved.
  const version = useMemo(() => ({ row, settleCount }), [row, settleCount])
  const labelPaths = useMemo(() => pathsMatchingLabel(targetTable, search), [targetTable, search])
  const chunks = useHistoryChunks(
    { branchId, targetTable, targetId, op: op ?? undefined, search, labelPaths, sort },
    version,
  )
  const entryIndex = useEntryIndex(branchId)
  const name = historyTargetName(row) ?? t('history:unknownTarget')
  const rows = useMemo(() => {
    const nowMs = Date.now()
    const entryLabel = (entryId: string) => {
      const ref = entryIndex.index.get(entryId)
      return ref == null ? null : formatEntryRef(ref.position)
    }
    return chunks.rows.map((delta) =>
      humanizeDelta(delta, { targetTable, targetName: name, entryLabel, nowMs }),
    )
  }, [chunks.rows, entryIndex.index, targetTable, name])

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
