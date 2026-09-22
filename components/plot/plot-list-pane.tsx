import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { View } from 'react-native'

import type { RowSignals } from '@/components/list/list-module'
import { ModuleList } from '@/components/list/module-list'
import { planReveal } from '@/components/list/reveal-plan'
import type { RevealRequest } from '@/components/list/use-reveal-scroll'
import { Select } from '@/components/ui/select'
import type { Happening, Thread } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  isPlotKind,
  PLOT_KINDS,
  type HappeningBucket,
  type HappeningFilter,
  type PlotKind,
  type PlotListSignals,
  type ThreadFilter,
  type ThreadTier,
} from '@/lib/list-modules'
import type { RecentlyClassified } from '@/lib/row-signals'
import { listCollapseStore } from '@/lib/stores'

import { happeningListModule } from './happening-list-module'
import { plotKindLabel } from './plot-selection'
import { threadListModule } from './thread-list-module'

export type PlotListPaneHandle = {
  /**
   * Scrolls to the row, widening the filter/search hiding it and expanding its group. No-ops on
   * a kind mismatch — switch `kind` first, then call again once the pane re-renders under it.
   */
  revealRow: (kind: PlotKind, id: string) => void
}

export type PlotListPaneProps = {
  kind: PlotKind
  onKindChange: (kind: PlotKind) => void
  threadFilter: ThreadFilter
  onThreadFilterChange: (filter: ThreadFilter) => void
  happeningFilter: HappeningFilter
  onHappeningFilterChange: (filter: HappeningFilter) => void
  search: string
  onSearchChange: (search: string) => void
  threads: readonly Thread[]
  happenings: readonly Happening[]
  listSignals: PlotListSignals
  selectedId: string | null
  onSelect: (id: string) => void
  recentlyClassified: ReadonlyMap<string, RecentlyClassified>
  addSlot: ReactNode
  ref?: Ref<PlotListPaneHandle>
}

// patterns/entity.md → Accordion grouping: the working tier / bucket starts open, the rest closed.
const THREAD_COLLAPSED_DEFAULTS: ReadonlySet<string> = new Set<ThreadTier>([
  'pending',
  'resolved',
  'failed',
])
const HAPPENING_COLLAPSED_DEFAULTS: ReadonlySet<string> = new Set<HappeningBucket>([
  'earlier',
  'out-of-narrative',
])

function collapseDefaults(kind: PlotKind): ReadonlySet<string> {
  return kind === 'thread' ? THREAD_COLLAPSED_DEFAULTS : HAPPENING_COLLAPSED_DEFAULTS
}

export function PlotListPane({
  kind,
  onKindChange,
  threadFilter,
  onThreadFilterChange,
  happeningFilter,
  onHappeningFilterChange,
  search,
  onSearchChange,
  threads,
  happenings,
  listSignals,
  selectedId,
  onSelect,
  recentlyClassified,
  addSlot,
  ref,
}: PlotListPaneProps) {
  const collapsed = listCollapseStore.useCollapsed(kind, collapseDefaults(kind))
  const [reveal, setReveal] = useState<RevealRequest | null>(null)

  // Filter-set shrinkage: `This chapter` leaves the vocabulary when no chapter is closed.
  const offered = happeningListModule.filters(listSignals)
  // useLayoutEffect: land the reset before paint, or the chip row briefly shows nothing selected.
  useLayoutEffect(() => {
    if (!offered.includes(happeningFilter)) onHappeningFilterChange('all')
  }, [offered, happeningFilter, onHappeningFilterChange])

  const revealRow = useCallback(
    (rowKind: PlotKind, id: string) => {
      if (rowKind !== kind) return
      if (rowKind === 'thread') {
        const row = threads.find((r) => r.id === id)
        if (row == null) return
        const plan = planReveal({
          listModule: threadListModule,
          row,
          view: { search, filter: threadFilter },
          allFilter: 'all',
          signals: listSignals,
        })
        if (plan.widen) {
          onThreadFilterChange('all')
          onSearchChange('')
        }
        if (plan.expandGroup != null) {
          listCollapseStore.setCollapsed(
            'thread',
            plan.expandGroup,
            false,
            THREAD_COLLAPSED_DEFAULTS,
          )
        }
      } else {
        const row = happenings.find((r) => r.id === id)
        if (row == null) return
        const plan = planReveal({
          listModule: happeningListModule,
          row,
          view: { search, filter: happeningFilter },
          allFilter: 'all',
          signals: listSignals,
        })
        if (plan.widen) {
          onHappeningFilterChange('all')
          onSearchChange('')
        }
        if (plan.expandGroup != null) {
          listCollapseStore.setCollapsed(
            'happening',
            plan.expandGroup,
            false,
            HAPPENING_COLLAPSED_DEFAULTS,
          )
        }
      }
      setReveal({ id })
    },
    [
      kind,
      threads,
      happenings,
      search,
      threadFilter,
      happeningFilter,
      listSignals,
      onThreadFilterChange,
      onHappeningFilterChange,
      onSearchChange,
    ],
  )
  useImperativeHandle(ref, () => ({ revealRow }), [revealRow])

  const rowSignals = (id: string): RowSignals => ({
    recentlyClassified: recentlyClassified.get(id),
  })

  // plot.md → Layout: a two-cell segment at every tier (forms.md → Select primitive).
  const kindSelector = (
    <View testID="plot-segment">
      <Select
        mode="segment"
        size="sm"
        label={t('plot:kindSelect')}
        value={kind}
        onValueChange={(value) => {
          if (isPlotKind(value)) onKindChange(value)
        }}
        options={PLOT_KINDS.map((k) => ({ value: k, label: plotKindLabel(k) }))}
      />
    </View>
  )

  const shared = {
    search,
    onSearchChange,
    categoryLabel: plotKindLabel(kind),
    kindSelector,
    addSlot,
    listSignals,
    rowSignals,
    selectedId,
    onSelect,
    collapsed,
    onCollapsedChange: (key: string, value: boolean) =>
      listCollapseStore.setCollapsed(kind, key, value, collapseDefaults(kind)),
    onReveal: (id: string) => revealRow(kind, id),
    reveal,
    resetKey: kind,
  }

  return kind === 'thread' ? (
    <ModuleList
      {...shared}
      listModule={threadListModule}
      rows={threads}
      filter={threadFilter}
      onFilterChange={onThreadFilterChange}
    />
  ) : (
    <ModuleList
      {...shared}
      listModule={happeningListModule}
      rows={happenings}
      filter={happeningFilter}
      onFilterChange={onHappeningFilterChange}
    />
  )
}
