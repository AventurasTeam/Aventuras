import type { ListCopy } from '@/components/list/list-module'
import { i18n, t } from '@/lib/i18n'
import type { HappeningFilter, PlotKind, ThreadFilter } from '@/lib/list-modules'

type PlotScopeKey = 'title' | 'description' | 'category'

// Ties each kind to its own filter type, so a mismatched kind/Filter pairing (e.g. a thread's
// filters handed to the happening module) fails to typecheck instead of drifting silently.
type PlotFilterOf = { thread: ThreadFilter; happening: HappeningFilter }

/**
 * Plot's list copy for a kind. Scope keys translate inside the callback, not at module load,
 * so the strings follow the current language (the lore module's pattern).
 */
export function plotListCopy<K extends PlotKind>(
  kind: K,
  scopeKeys: readonly PlotScopeKey[],
): (categoryLabel: string) => ListCopy<PlotFilterOf[K]> {
  return (categoryLabel) => {
    // The app language, not the host locale: a Turkish host lowercases "I" to a dotless "ı".
    const category = categoryLabel.toLocaleLowerCase(i18n.language)
    return {
      searchPlaceholder: t('plot:search.placeholder', { category }),
      searchScope: scopeKeys.map((key) => t(`plot:search.scope.${key}`)),
      filterLabel: (filter) => t(`plot:filters.${filter}`),
      emptyTitle: t(`plot:empty.${kind}`),
      emptySubtext: t('plot:empty.classifierBody'),
      noResults: t('plot:noResults'),
      noResultsHint: t('plot:noResultsHint'),
    }
  }
}
