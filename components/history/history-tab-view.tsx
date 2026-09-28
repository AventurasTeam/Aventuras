import { View } from 'react-native'

import { DeltaLogRow } from '@/components/compounds/delta-log-row'
import { Toolbar } from '@/components/compounds/toolbar'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { HISTORY_OPS, type HistoryOp, type HistoryRowView, type HistorySort } from '@/lib/history'
import { t } from '@/lib/i18n'

import type { HistoryStatus } from './use-history-chunks'

export type HistoryTabViewProps = {
  rows: readonly HistoryRowView[]
  status: HistoryStatus
  hasMore: boolean
  /** A search or op filter is applied to `rows`, so an empty list reads as "no match". */
  filtered: boolean
  search: string
  onSearchChange: (search: string) => void
  op: HistoryOp | null
  onOpChange: (op: HistoryOp | null) => void
  sort: HistorySort
  onSortChange: (sort: HistorySort) => void
  onLoadMore: () => void
  onRetry: () => void
}

type BodyProps = Pick<
  HistoryTabViewProps,
  'rows' | 'status' | 'hasMore' | 'filtered' | 'sort' | 'onLoadMore' | 'onRetry'
>

function HistoryBody({ rows, status, hasMore, sort, onLoadMore, onRetry, filtered }: BodyProps) {
  if (status === 'loading')
    return (
      <View className="items-center py-8">
        <Spinner />
      </View>
    )
  if (status === 'failed')
    return (
      <View className="items-center gap-3 py-6">
        <EmptyState title={t('history:tab.failed')} subtext={t('history:tab.failedBody')} />
        <Button variant="secondary" onPress={onRetry}>
          <Text>{t('history:tab.retry')}</Text>
        </Button>
      </View>
    )
  if (rows.length === 0)
    return filtered ? (
      <EmptyState title={t('history:tab.noResults')} subtext={t('history:tab.noResultsBody')} />
    ) : (
      <EmptyState title={t('history:tab.empty')} subtext={t('history:tab.emptyBody')} />
    )
  return (
    <View>
      {rows.map((row) => (
        <DeltaLogRow key={row.id} delta={row} />
      ))}
      {hasMore ? (
        <View className="items-center pt-2">
          <Button variant="secondary" onPress={onLoadMore} loading={status === 'loading-more'}>
            <Text>
              {sort === 'newest' ? t('history:tab.loadOlder') : t('history:tab.loadNewer')}
            </Text>
          </Button>
        </View>
      ) : null}
    </View>
  )
}

/** world.md → History tab: read-only rows under search, op chips and sort; more rows on demand. */
export function HistoryTabView({
  rows,
  status,
  hasMore,
  filtered,
  search,
  onSearchChange,
  op,
  onOpChange,
  sort,
  onSortChange,
  onLoadMore,
  onRetry,
}: HistoryTabViewProps) {
  return (
    <View className="gap-3">
      <Toolbar narrow>
        <Toolbar.Search
          value={search}
          onChange={onSearchChange}
          placeholder={t('history:tab.searchPlaceholder')}
          scope={[
            t('history:tab.scopeFieldPaths'),
            t('history:tab.scopeOp'),
            t('history:tab.scopeSummary'),
          ]}
        />
        <Toolbar.FilterChips>
          <Chip selected={op == null} onPress={() => onOpChange(null)}>
            {t('history:tab.filterAll')}
          </Chip>
          {HISTORY_OPS.map((value) => (
            <Chip key={value} selected={op === value} onPress={() => onOpChange(value)}>
              {t(`history:opFilter.${value}`)}
            </Chip>
          ))}
        </Toolbar.FilterChips>
        <Toolbar.Sort
          value={sort}
          onChange={(value) => onSortChange(value as HistorySort)}
          label={t('history:tab.sortLabel')}
          options={[
            { value: 'newest', label: t('history:tab.sortNewest') },
            { value: 'oldest', label: t('history:tab.sortOldest') },
          ]}
        />
      </Toolbar>
      <HistoryBody
        rows={rows}
        status={status}
        hasMore={hasMore}
        sort={sort}
        onLoadMore={onLoadMore}
        onRetry={onRetry}
        filtered={filtered}
      />
    </View>
  )
}
