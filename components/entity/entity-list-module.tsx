import type { Entity, EntityKind } from '@/lib/db'
import { i18n, t } from '@/lib/i18n'
import {
  ENTITY_FILTERS,
  entitySearchScope,
  groupEntitiesByTier,
  queryEntities,
  type EntityFilter,
  type EntityListSignals,
  type EntityTier,
} from '@/lib/list-modules'

import { EntityRow } from './entity-row'
import type { ListModule } from './list-module'

export type EntityListModule = ListModule<Entity, EntityFilter, EntityListSignals, EntityTier>

function buildEntityListModule(kind: EntityKind): EntityListModule {
  return {
    filters: () => ENTITY_FILTERS,
    query: (rows, input, signals) => queryEntities(rows, kind, input, signals),
    grouping: {
      group: (rows, signals) => groupEntitiesByTier(rows, signals.leadId),
      label: (key) => t(`world:tiers.${key}`),
    },
    copy: (categoryLabel) => {
      // The app language, not the host locale: a Turkish host lowercases "I" to a dotless "ı".
      const category = categoryLabel.toLocaleLowerCase(i18n.language)
      return {
        searchPlaceholder: t('world:search.placeholder', { category }),
        searchScope: entitySearchScope(kind).map((key) => t(`world:search.scope.${key}`)),
        filterLabel: (filter) => t(`world:filters.${filter}`),
        emptyTitle: t('world:empty.title', { category }),
        emptySubtext: t('world:empty.classifierBody'),
        noResults: t('world:noResults'),
        noResultsHint: t('world:noResultsHint'),
      }
    },
    Row: EntityRow,
  }
}

// One instance per kind so consumers compare by identity.
const ENTITY_LIST_MODULES: Record<EntityKind, EntityListModule> = {
  character: buildEntityListModule('character'),
  location: buildEntityListModule('location'),
  item: buildEntityListModule('item'),
  faction: buildEntityListModule('faction'),
}

export function entityListModule(kind: EntityKind): EntityListModule {
  return ENTITY_LIST_MODULES[kind]
}
