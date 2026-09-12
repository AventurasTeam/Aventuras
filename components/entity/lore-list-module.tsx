import type { Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import { LORE_SEARCH_SCOPE, queryLore } from '@/lib/list-modules'

import type { ListModule } from './list-module'
import { LoreRow } from './lore-row'

/** Lore has no filter chips (world.md → List filter — lore); the one value keeps the query shape. */
export const LORE_FILTER = 'all' as const

const NO_FILTERS: readonly (typeof LORE_FILTER)[] = []

export const loreListModule: ListModule<Lore, typeof LORE_FILTER> = {
  filters: () => NO_FILTERS,
  query: (rows, input) => queryLore(rows, { search: input.search }),
  grouping: null,
  copy: (categoryLabel) => ({
    searchPlaceholder: t('world:search.placeholder', {
      category: categoryLabel.toLocaleLowerCase(),
    }),
    searchScope: LORE_SEARCH_SCOPE.map((key) => t(`world:search.scope.${key}`)),
    filterLabel: (filter) => t(`world:filters.${filter}`),
    emptyTitle: t('world:empty.title', { category: categoryLabel.toLocaleLowerCase() }),
    emptySubtext: t('world:empty.loreBody'),
    noResults: t('world:noResults'),
    noResultsHint: t('world:noResultsHint'),
  }),
  Row: LoreRow,
}
