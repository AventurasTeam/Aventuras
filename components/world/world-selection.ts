import { t } from '@/lib/i18n'
import { isWorldCategory, type WorldCategory } from '@/lib/list-modules'

export type WorldSelection = { category: WorldCategory; id: string; tab?: string }

type RawParam = string | string[] | undefined

// expo-router hands back string[] for a repeated query param; one value or nothing.
export function single(value: RawParam): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** `kind` + `id` select a row on mount; `tab` carries the initial detail tab, when present. */
export function parseWorldSelection(params: {
  kind?: RawParam
  id?: RawParam
  tab?: RawParam
}): WorldSelection | null {
  const kind = single(params.kind)
  const id = single(params.id)
  if (!isWorldCategory(kind) || id == null) return null
  const tab = single(params.tab)
  return tab == null ? { category: kind, id } : { category: kind, id, tab }
}

export function worldCategoryLabel(category: WorldCategory): string {
  return t(`world:categories.${category}`)
}

export function worldKindName(category: WorldCategory): string {
  return t(`world:kindName.${category}`)
}

export function worldAddLabel(category: WorldCategory): string {
  return t(`world:add.${category}`)
}
