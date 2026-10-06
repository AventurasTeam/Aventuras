import { useMemo, useState } from 'react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useEntryIndex } from '@/hooks/use-entry-index'
import { formatEntryRef } from '@/lib/entry-refs'
import { humanizeDelta, type HistoryOp, type HistorySort, type HistoryTable } from '@/lib/history'
import { t } from '@/lib/i18n'
import { generationStore } from '@/lib/stores'

import { HistoryTabView } from './history-tab-view'
import { useHistoryChunks } from './use-history-chunks'
import { historyTargetName, useHistoryTarget } from './use-history-target'

const SEARCH_DEBOUNCE_MS = 250

export type HistoryTabProps = { branchId: string; targetTable: HistoryTable; targetId: string }

/** C4: one row's delta log; keyed by target so switching rows remounts and resets it. */
export function HistoryTab(props: HistoryTabProps) {
  return <HistoryTabForTarget key={`${props.targetTable}:${props.targetId}`} {...props} />
}

function HistoryTabForTarget({ branchId, targetTable, targetId }: HistoryTabProps) {
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS)
  const [op, setOp] = useState<HistoryOp | null>(null)
  const [sort, setSort] = useState<HistorySort>('newest')
  const row = useHistoryTarget(targetTable, targetId)
  const settleCount = generationStore.useGeneration((s) => s.settleCount)
  // Fresh identity when the row is patched or a run/reversal settles: the log may have moved.
  const version = useMemo(() => ({ row, settleCount }), [row, settleCount])
  const chunks = useHistoryChunks(
    { branchId, targetTable, targetId, op: op ?? undefined, search, sort },
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
    const otherName = (id: string) => chunks.names[id] ?? null
    return chunks.rows.map((historyRow) =>
      humanizeDelta(historyRow, { targetTable, targetName: name, otherName, entryLabel, nowMs }),
    )
  }, [chunks.rows, chunks.names, entryIndex.index, targetTable, name])

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
