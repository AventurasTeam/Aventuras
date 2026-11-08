import { t } from '@/lib/i18n'
import { isWorldCategory, type WorldCategory } from '@/lib/list-modules'
import { singleParam, type RouteParam } from '@/lib/route-param'

export type WorldSelection = { category: WorldCategory; id: string; tab?: string }

/** `kind` + `id` select a row on mount; `tab` carries the initial detail tab, when present. */
export function parseWorldSelection(params: {
  kind?: RouteParam
  id?: RouteParam
  tab?: RouteParam
}): WorldSelection | null {
  const kind = singleParam(params.kind)
  const id = singleParam(params.id)
  if (!isWorldCategory(kind) || id == null) return null
  const tab = singleParam(params.tab)
  return tab == null ? { category: kind, id } : { category: kind, id, tab }
}

/** The World route selecting `link`; producers build it here rather than by hand. */
export function worldHref(branchId: string, link: WorldSelection): string {
  const query = new URLSearchParams({ kind: link.category, id: link.id })
  if (link.tab != null) query.set('tab', link.tab)
  return `/world/${branchId}?${query.toString()}`
}

export function worldCategoryLabel(category: WorldCategory): string {
  return t(`world:categories.${category}`)
}

export function worldAddLabel(category: WorldCategory): string {
  return t(`world:add.${category}`)
}
