import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { View } from 'react-native'

import { LORE_FILTER } from '@/components/entity/lore-list-module'
import { ModuleList } from '@/components/list/module-list'
import { plotCollapseDefaults } from '@/components/plot/plot-list-pane'
import type { EntityListPaneSurface } from '@/components/shells/entity-list-pane'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Text } from '@/components/ui/text'
import { WORLD_COLLAPSED_DEFAULTS } from '@/components/world/world-list-pane'
import { t } from '@/lib/i18n'
import type { RailCategory, RailView } from '@/lib/reader-rail'
import { listCollapseStore } from '@/lib/stores'

import { RAIL_MODULES, railCategoryLabel, railEmptySubtext } from './rail-modules'
import type { RailData } from './use-rail-data'

export type RailListProps = {
  data: RailData
  view: RailView
  onViewChange: (view: RailView) => void
  /** The kind-selector slot: the category Select on desktop, the `← <Category>` head on phone. */
  header: ReactNode
  headerAction?: ReactNode
  onRowPress: (category: RailCategory, id: string) => void
  /** `transparent` on the Sheet, whose surface every level shares. */
  surface?: EntityListPaneSurface
}

// The panels' own defaults under the panels' own keys, so the rail and World / Plot share one
// session collapse state per category (patterns/entity.md → Accordion grouping).
function railCollapseDefaults(category: RailCategory): ReadonlySet<string> {
  return category === 'thread' || category === 'happening'
    ? plotCollapseDefaults(category)
    : WORLD_COLLAPSED_DEFAULTS
}

function ignoreFilter(): void {}

/** The happening body while the entry index is unread (every anchor would read dangling) or failed. */
function EntryIndexStatus({ entryIndex }: { entryIndex: RailData['entryIndex'] }): ReactNode {
  if (!entryIndex.failed) return <EmptyState title={t('reader:rail.happeningsLoading')} />
  return (
    <View className="items-center gap-3">
      <EmptyState
        title={t('plot:entryIndexFailed')}
        subtext={t('reader:rail.entryIndexFailedBody')}
      />
      <Button variant="secondary" onPress={entryIndex.retry}>
        <Text>{t('plot:entryIndexRetry')}</Text>
      </Button>
    </View>
  )
}

/** The active category's C2 module, at the rail's density, over the rail's data. */
export function RailList({
  data,
  view,
  onViewChange,
  header,
  headerAction,
  onRowPress,
  surface,
}: RailListProps): ReactNode {
  const { category } = view
  const defaults = railCollapseDefaults(category)
  const collapsed = listCollapseStore.useCollapsed(category, defaults)
  const kindRows = useMemo(
    () => data.entities.filter((e) => e.kind === category),
    [data.entities, category],
  )

  // Filter-set shrinkage: `This chapter` leaves the vocabulary when no chapter is closed.
  const offeredHappeningFilters = RAIL_MODULES.happening.filters(data.plotListSignals)
  // A layout effect lands the reset before paint, so the chip row never shows nothing selected.
  useLayoutEffect(() => {
    if (view.category === 'happening' && !offeredHappeningFilters.includes(view.filter)) {
      onViewChange({ ...view, filter: 'all' })
    }
  }, [view, offeredHappeningFilters, onViewChange])

  const shared = {
    search: view.search,
    onSearchChange: (search: string) => onViewChange({ ...view, search }),
    categoryLabel: railCategoryLabel(category),
    kindSelector: header,
    addSlot: headerAction ?? null,
    rowSignals: data.rowSignals,
    selectedId: null,
    onSelect: (id: string) => onRowPress(category, id),
    collapsed,
    onCollapsedChange: (key: string, value: boolean) =>
      listCollapseStore.setCollapsed(category, key, value, defaults),
    resetKey: category,
    density: 'compact' as const,
    emptySubtext: railEmptySubtext(category),
    surface,
  }

  switch (view.category) {
    case 'lore':
      return (
        <ModuleList
          {...shared}
          listModule={RAIL_MODULES.lore}
          rows={data.lore}
          filter={LORE_FILTER}
          onFilterChange={ignoreFilter}
          listSignals={data.entityListSignals}
        />
      )
    case 'thread':
      return (
        <ModuleList
          {...shared}
          listModule={RAIL_MODULES.thread}
          rows={data.threads}
          filter={view.filter}
          onFilterChange={(filter) => onViewChange({ ...view, filter })}
          listSignals={data.plotListSignals}
        />
      )
    case 'happening':
      return (
        <ModuleList
          {...shared}
          listModule={RAIL_MODULES.happening}
          // The header stays mounted while the body waits, so the Select keeps focus.
          body={
            data.entryIndex.ready ? undefined : <EntryIndexStatus entryIndex={data.entryIndex} />
          }
          rows={data.happenings}
          filter={view.filter}
          onFilterChange={(filter) => onViewChange({ ...view, filter })}
          listSignals={data.plotListSignals}
        />
      )
    default:
      return (
        <ModuleList
          {...shared}
          listModule={RAIL_MODULES[view.category]}
          rows={kindRows}
          filter={view.filter}
          onFilterChange={(filter) => onViewChange({ ...view, filter })}
          listSignals={data.entityListSignals}
        />
      )
  }
}
