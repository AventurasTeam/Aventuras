import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from 'react'

import { entityListModule } from '@/components/entity/entity-list-module'
import { LORE_FILTER, loreListModule } from '@/components/entity/lore-list-module'
import type { LeadLabel, RowSignals } from '@/components/list/list-module'
import { ModuleList } from '@/components/list/module-list'
import { planReveal, type RevealPlan } from '@/components/list/reveal-plan'
import type { RevealRequest } from '@/components/list/use-reveal-scroll'
import { Select } from '@/components/ui/select'
import type { RowSignalsSnapshot } from '@/hooks/use-row-signals'
import type { Entity, Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  isEntityCategory,
  isWorldCategory,
  WORLD_CATEGORIES,
  type EntityFilter,
  type EntityListSignals,
  type EntityTier,
  type WorldCategory,
} from '@/lib/list-modules'
import { listCollapseStore } from '@/lib/stores'

import type { CollisionTarget } from './collisions'
import { worldCategoryLabel } from './world-selection'

export type WorldListPaneHandle = {
  /**
   * Scrolls to the row, first widening a chip/search that hides it, expanding its tier on the
   * All view (never the pinned lead's); switching category must happen in the same update.
   */
  revealRow: (id: string) => void
}

export type WorldListPaneProps = {
  category: WorldCategory
  onCategoryChange: (category: WorldCategory) => void
  filter: EntityFilter
  onFilterChange: (filter: EntityFilter) => void
  search: string
  onSearchChange: (search: string) => void
  entities: readonly Entity[]
  lore: readonly Lore[]
  selectedId: string | null
  onSelect: (id: string) => void
  signals: RowSignalsSnapshot
  leadId: string | null
  leadLabel: LeadLabel | null
  collisions: ReadonlyMap<string, CollisionTarget>
  /** In-surface jump from a collision strip: select and reveal the other row. */
  onJumpToRow: (id: string) => void
  /** Resolve on each flagged row: acts on it, or stays inert with this reason. */
  resolveCollision: { onResolve: (id: string) => void } | { disabledReason: string }
  addSlot: ReactNode
  ref?: Ref<WorldListPaneHandle>
}

// patterns/entity.md → Accordion grouping: the working tier starts open, the rest closed.
const WORLD_COLLAPSED_DEFAULTS: ReadonlySet<string> = new Set<EntityTier>(['staged', 'retired'])

export function WorldListPane({
  category,
  onCategoryChange,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  entities,
  lore,
  selectedId,
  onSelect,
  signals,
  leadId,
  leadLabel,
  collisions,
  onJumpToRow,
  resolveCollision,
  addSlot,
  ref,
}: WorldListPaneProps) {
  const collapsed = listCollapseStore.useCollapsed(category, WORLD_COLLAPSED_DEFAULTS)
  const setGroupCollapsed = useCallback(
    (key: string, value: boolean) =>
      listCollapseStore.setCollapsed(category, key, value, WORLD_COLLAPSED_DEFAULTS),
    [category],
  )
  const [reveal, setReveal] = useState<RevealRequest | null>(null)
  const listSignals = useMemo<EntityListSignals>(
    () => ({ leadId, inScene: signals.inScene }),
    [leadId, signals.inScene],
  )
  const entityScope = useMemo(
    () => (isEntityCategory(category) ? entities.filter((e) => e.kind === category) : []),
    [entities, category],
  )

  // A row the current chip or search hides never mounts, so never scrolls; only
  // then does the reveal widen the view — a search that shows the row survives.
  const revealRow = useCallback(
    (id: string) => {
      const entity = entities.find((e) => e.id === id)
      // A pill jump switches category in the same update as calling this, so `category` here is
      // the pre-switch closure: the view below is planned against where the switch lands, and
      // the collapse write further down keys by the row's own kind rather than this closure.
      const inCategory = entity != null ? entity.kind === category : category === 'lore'
      let plan: RevealPlan<string>
      if (entity != null) {
        plan = planReveal({
          listModule: entityListModule(entity.kind),
          row: entity,
          view: inCategory ? { search, filter } : { search: '', filter: 'all' },
          allFilter: 'all',
          signals: listSignals,
        })
      } else {
        const loreRow = lore.find((l) => l.id === id)
        if (loreRow == null) return
        plan = planReveal({
          listModule: loreListModule,
          row: loreRow,
          view: { search: inCategory ? search : '', filter: LORE_FILTER },
          allFilter: LORE_FILTER,
          signals: listSignals,
        })
      }
      if (!inCategory || plan.widen) {
        onFilterChange('all')
        onSearchChange('')
      }
      const targetKind = entity != null ? entity.kind : 'lore'
      if (plan.expandGroup != null)
        listCollapseStore.setCollapsed(
          targetKind,
          plan.expandGroup,
          false,
          WORLD_COLLAPSED_DEFAULTS,
        )
      setReveal({ id })
    },
    [entities, lore, category, search, filter, listSignals, onFilterChange, onSearchChange],
  )
  useImperativeHandle(ref, () => ({ revealRow }), [revealRow])

  const rowSignals = (id: string): RowSignals => {
    const target = collisions.get(id)
    return {
      lead: id === leadId ? leadLabel : null,
      inScene: signals.inScene.has(id),
      recentlyClassified: signals.recentlyClassified.rows.get(id),
      collision:
        target == null
          ? undefined
          : {
              otherName: target.otherName,
              onJumpToOther: () => onJumpToRow(target.otherId),
              ...('onResolve' in resolveCollision
                ? { onResolve: () => resolveCollision.onResolve(id) }
                : { resolveDisabledReason: resolveCollision.disabledReason }),
            },
    }
  }

  const kindSelector = (
    <Select
      mode="dropdown"
      size="sm"
      sheetSize="short"
      label={t('world:categorySelect')}
      value={category}
      onValueChange={(value) => {
        if (isWorldCategory(value)) onCategoryChange(value)
      }}
      options={WORLD_CATEGORIES.map((c) => ({ value: c, label: worldCategoryLabel(c) }))}
    />
  )

  const shared = {
    search,
    onSearchChange,
    categoryLabel: worldCategoryLabel(category),
    kindSelector,
    addSlot,
    listSignals,
    rowSignals,
    flagged: collisions,
    selectedId,
    onSelect,
    collapsed,
    onCollapsedChange: setGroupCollapsed,
    onReveal: revealRow,
    reveal,
    resetKey: category,
  }

  return isEntityCategory(category) ? (
    <ModuleList
      {...shared}
      listModule={entityListModule(category)}
      rows={entityScope}
      filter={filter}
      onFilterChange={onFilterChange}
    />
  ) : (
    <ModuleList
      {...shared}
      listModule={loreListModule}
      rows={lore}
      filter={LORE_FILTER}
      onFilterChange={onFilterChange}
    />
  )
}
