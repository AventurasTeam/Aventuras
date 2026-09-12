import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from 'react'

import { entityListModule } from '@/components/entity/entity-list-module'
import type { LeadLabel, RowSignals } from '@/components/entity/list-module'
import { LORE_FILTER, loreListModule } from '@/components/entity/lore-list-module'
import { Select } from '@/components/ui/select'
import type { RowSignalsSnapshot } from '@/hooks/use-row-signals'
import type { Entity, Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  ENTITY_TIERS,
  isEntityCategory,
  isWorldCategory,
  WORLD_CATEGORIES,
  type EntityFilter,
  type EntityListSignals,
  type EntityTier,
  type WorldCategory,
} from '@/lib/list-modules'
import { worldListStore } from '@/lib/stores'

import type { CollisionTarget } from './collisions'
import { ModuleList } from './module-list'
import type { RevealRequest } from './use-reveal-scroll'
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
  onResolveCollision: (id: string) => void
  /** Present → Resolve renders disabled with this reason. */
  resolveDisabledReason?: string
  addSlot: ReactNode
  ref?: Ref<WorldListPaneHandle>
}

function isEntityTier(key: string): key is EntityTier {
  return (ENTITY_TIERS as readonly string[]).includes(key)
}

// The collapse store holds entity tiers only; other group keys have nowhere to persist.
function setGroupCollapsed(key: string, collapsed: boolean) {
  if (isEntityTier(key)) worldListStore.setCollapsed(key, collapsed)
}

// Where the row lands on the All view: the pinned slot sits outside every tier.
function tierToExpand(entity: Entity, signals: EntityListSignals): EntityTier | null {
  const grouping = entityListModule(entity.kind).grouping
  if (grouping == null) return null
  const { pinned, groups } = grouping.group([entity], signals)
  return pinned == null ? (groups[0]?.key ?? null) : null
}

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
  onResolveCollision,
  resolveDisabledReason,
  addSlot,
  ref,
}: WorldListPaneProps) {
  const collapsed = worldListStore.useCollapsedTiers()
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
      const loreRow = entity == null ? lore.find((l) => l.id === id) : undefined
      if (entity == null && loreRow == null) return
      // Another category's row is never listed: this closure still holds the old
      // category's chip and search, which the caller's switch discards in the same update.
      const inCategory = entity != null ? entity.kind === category : category === 'lore'
      const input = { search, filter }
      const listed =
        inCategory &&
        (entity != null
          ? entityListModule(entity.kind).query([entity], input, listSignals).length > 0
          : loreRow != null &&
            loreListModule.query([loreRow], { search, filter: LORE_FILTER }, listSignals).length >
              0)
      if (!listed) {
        onFilterChange('all')
        onSearchChange('')
      }
      // Under a narrowing chip the list is flat; only the All view's tiers can hide a listed row.
      const tier =
        entity != null && (!listed || filter === 'all') ? tierToExpand(entity, listSignals) : null
      if (tier != null) worldListStore.setCollapsed(tier, false)
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
              onResolve: () => onResolveCollision(id),
              resolveDisabled: resolveDisabledReason != null,
              resolveDisabledReason,
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
