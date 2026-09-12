import { useMemo, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'

import type { ListModule, RowSignals } from '@/components/entity/list-module'
import { EntityListPane } from '@/components/shells/entity-list-pane'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

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
  /** Rows counted by a collapsed group's `⚠ N` badge. */
  flagged: { has: (id: string) => boolean }
  selectedId: string | null
  onSelect: (id: string) => void
  /** Group keys the All view shows collapsed; the owner persists changes. */
  collapsed: ReadonlySet<string>
  onCollapsedChange: (key: Key, collapsed: boolean) => void
  /** A badge press; the owner widens the view, expands the group and sends `reveal`. */
  onReveal: (id: string) => void
  reveal: RevealRequest | null
  /** A change scrolls the list back to the top, unless a reveal lands with it. */
  resetKey: string
}

/**
 * A module's list inside the list-pane shell: chips, search, the All view's
 * group accordion with its pinned row and `⚠ N` badges, empty and no-results.
 */
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
  reveal,
  resetKey,
}: ModuleListProps<Row, Filter, Key, Signals>) {
  const { scrollRef, contentRef, rowRef } = useRevealScroll(reveal, resetKey)

  const visible = useMemo(
    () => listModule.query(rows, { search, filter }, listSignals),
    [listModule, rows, search, filter, listSignals],
  )
  const grouped = useMemo(() => {
    const grouping = listModule.grouping
    if (filter !== 'all' || grouping == null) return null
    return { ...grouping.group(visible, listSignals), label: grouping.label }
  }, [listModule, visible, filter, listSignals])

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
            const flaggedRows = group.rows.filter((r) => flagged.has(r.id))
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
                  {collapsed.has(group.key) && flaggedRows.length > 0 ? (
                    <Tag
                      tone="warning"
                      accessibilityLabel={t('world:collision.groupNeedReview', {
                        count: flaggedRows.length,
                        group: grouped.label(group.key),
                      })}
                      onPress={() => onReveal(flaggedRows[0].id)}
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
      emptyState={<EmptyState title={copy.emptyTitle} subtext={copy.emptySubtext} />}
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
        <ScrollView ref={scrollRef} className="flex-1">
          <View ref={contentRef}>{list}</View>
        </ScrollView>
      )}
    </EntityListPane>
  )
}
