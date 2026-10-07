import { useContext, useMemo, type ReactNode } from 'react'
import { View, type ViewStyle } from 'react-native'

import { EntityListPane } from '@/components/shells/entity-list-pane'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollComponentContext } from '@/components/ui/scroll-component'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

import { arrangeRows, type ListModule, type RowDensity, type RowSignals } from './list-module'
import { useRevealScroll, type RevealRequest } from './use-reveal-scroll'

export type ModuleListProps<
  Row extends { id: string },
  Filter extends string,
  Key extends string,
  Signals,
> = {
  listModule: ListModule<Row, Filter, Signals, Key>
  /** Every row of the category, before search and filter. */
  rows: readonly Row[]
  filter: Filter
  onFilterChange: (filter: Filter) => void
  search: string
  onSearchChange: (search: string) => void
  categoryLabel: string
  kindSelector: ReactNode
  addSlot: ReactNode
  listSignals: Signals
  rowSignals: (id: string) => RowSignals
  /** Rows counted by a collapsed group's `⚠ N` badge; omit for a kind with no flagged rows. */
  flagged?: { has: (id: string) => boolean }
  selectedId: string | null
  onSelect: (id: string) => void
  /** Group keys the All view shows collapsed; the owner persists changes. */
  collapsed: ReadonlySet<string>
  onCollapsedChange: (key: Key, collapsed: boolean) => void
  /**
   * A badge press; the owner widens the view, expands the group and sends `reveal`. Without it
   * no `⚠ N` badge renders, whatever `flagged` holds.
   */
  onReveal?: (id: string) => void
  reveal?: RevealRequest | null
  /** A change scrolls the list back to the top, unless a reveal lands with it. */
  resetKey: string
  /** Forwarded to every row; `compact` is the rail's narrower column. */
  density?: RowDensity
  /** Replaces the module's empty-state subtext, for a surface whose add affordance differs. */
  emptySubtext?: string
}

// Style, not `className`: NativeWind drops classes on a component it doesn't register, and the
// injected scroll component may be gorhom's.
const SCROLL_FILL: ViewStyle = { flex: 1 }

/** List-pane shell's row list: chips, search, All view's grouped accordion with `⚠ N` badges. */
export function ModuleList<
  Row extends { id: string },
  Filter extends string,
  Key extends string,
  Signals,
>({
  listModule,
  rows,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  categoryLabel,
  kindSelector,
  addSlot,
  listSignals,
  rowSignals,
  flagged,
  selectedId,
  onSelect,
  collapsed,
  onCollapsedChange,
  onReveal,
  reveal = null,
  resetKey,
  density = 'default',
  emptySubtext,
}: ModuleListProps<Row, Filter, Key, Signals>) {
  const { scrollRef, contentRef, rowRef, focusRef } = useRevealScroll(reveal, resetKey)
  const Scroll = useContext(ScrollComponentContext)
  const badge = flagged != null && onReveal != null ? { flagged, onReveal } : null

  const { visible, grouped } = useMemo(
    () => arrangeRows(listModule, rows, { search, filter }, listSignals),
    [listModule, rows, search, filter, listSignals],
  )

  const copy = listModule.copy(categoryLabel)
  const filters = listModule.filters(listSignals)
  const RowRenderer = listModule.Row

  const renderRow = (row: Row) => (
    <View key={row.id} ref={rowRef(row.id)}>
      <RowRenderer
        row={row}
        selected={row.id === selectedId}
        onPress={() => onSelect(row.id)}
        signals={rowSignals(row.id)}
        listSignals={listSignals}
        density={density}
        focusRef={focusRef(row.id)}
      />
    </View>
  )

  const list =
    grouped == null ? (
      visible.map(renderRow)
    ) : (
      <>
        {grouped.pinned != null ? renderRow(grouped.pinned) : null}
        <Accordion
          type="multiple"
          value={grouped.groups.map((g) => g.key).filter((key) => !collapsed.has(key))}
          onValueChange={(value: string[]) => {
            const expanded = new Set(value)
            for (const g of grouped.groups) onCollapsedChange(g.key, !expanded.has(g.key))
          }}
        >
          {grouped.groups.map((group) => {
            const flaggedRows =
              badge == null ? [] : group.rows.filter((r) => badge.flagged.has(r.id))
            return (
              <AccordionItem key={group.key} value={group.key}>
                <View className="flex-row items-center gap-2 px-row-x-md">
                  <View className="min-w-0 flex-1">
                    <AccordionTrigger>
                      <View className="flex-row items-center gap-2">
                        <Text className="font-medium">{grouped.label(group.key)}</Text>
                        <Text size="sm" variant="muted">
                          {group.rows.length}
                        </Text>
                      </View>
                    </AccordionTrigger>
                  </View>
                  {badge != null && collapsed.has(group.key) && flaggedRows.length > 0 ? (
                    <Tag
                      tone="warning"
                      accessibilityLabel={t('list.groupNeedReview', {
                        count: flaggedRows.length,
                        group: grouped.label(group.key),
                      })}
                      onPress={() => badge.onReveal(flaggedRows[0].id)}
                    >
                      {`⚠ ${flaggedRows.length}`}
                    </Tag>
                  ) : null}
                </View>
                <AccordionContent className="pb-0">{group.rows.map(renderRow)}</AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </>
    )

  return (
    <EntityListPane
      kindSelector={kindSelector}
      addSlot={addSlot}
      search={{
        value: search,
        onChange: onSearchChange,
        placeholder: copy.searchPlaceholder,
        scope: copy.searchScope,
      }}
      filterChips={
        filters.length === 0
          ? null
          : filters.map((f) => (
              <Chip key={f} selected={filter === f} onPress={() => onFilterChange(f)}>
                {copy.filterLabel(f)}
              </Chip>
            ))
      }
      isEmpty={rows.length === 0}
      emptyState={
        <EmptyState title={copy.emptyTitle} subtext={emptySubtext ?? copy.emptySubtext} />
      }
    >
      {visible.length === 0 ? (
        <View className="px-row-x-md py-row-y-lg">
          <Text size="sm">
            {copy.noResults}{' '}
            <Text size="xs" variant="muted">
              {copy.noResultsHint}
            </Text>
          </Text>
        </View>
      ) : (
        <Scroll keyboardShouldPersistTaps="handled" ref={scrollRef} style={SCROLL_FILL}>
          <View ref={contentRef}>{list}</View>
        </Scroll>
      )}
    </EntityListPane>
  )
}
