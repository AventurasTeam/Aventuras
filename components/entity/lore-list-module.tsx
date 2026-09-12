import type { Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import { LORE_SEARCH_SCOPE, queryLore } from '@/lib/list-modules'

import type { ListModule } from './list-module'
import { LoreRow } from './lore-row'
import { worldListCopy } from './world-list-copy'

/** Lore has no filter chips (world.md → List filter — lore); the one value keeps the query shape. */
export const LORE_FILTER = 'all' as const

const NO_FILTERS: readonly (typeof LORE_FILTER)[] = []

export const loreListModule: ListModule<Lore, typeof LORE_FILTER> = {
  filters: () => NO_FILTERS,
  query: (rows, input) => queryLore(rows, { search: input.search }),
  grouping: null,
  copy: (categoryLabel) =>
    worldListCopy(
      categoryLabel,
      LORE_SEARCH_SCOPE.map((key) => t(`world:search.scope.${key}`)),
      t('world:empty.loreBody'),
    ),
  Row: LoreRow,
}
