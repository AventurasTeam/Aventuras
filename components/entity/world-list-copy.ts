import { i18n, t } from '@/lib/i18n'
import type { EntityFilter } from '@/lib/list-modules'

import type { ListCopy } from './list-module'

/** World's list copy for a category; the kind's translated search scope and empty subtext vary. */
export function worldListCopy(
  categoryLabel: string,
  searchScope: readonly string[],
  emptySubtext: string,
): ListCopy<EntityFilter> {
  // The app language, not the host locale: a Turkish host lowercases "I" to a dotless "ı".
  const category = categoryLabel.toLocaleLowerCase(i18n.language)
  return {
    searchPlaceholder: t('world:search.placeholder', { category }),
    searchScope,
    filterLabel: (filter) => t(`world:filters.${filter}`),
    emptyTitle: t('world:empty.title', { category }),
    emptySubtext,
    noResults: t('world:noResults'),
    noResultsHint: t('world:noResultsHint'),
  }
}
