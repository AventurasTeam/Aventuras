import type { IdBiMap } from './bimap'
import { ID_PATTERN } from './prefixes'

export function substituteIds<T>(value: T, idMap: IdBiMap): T {
  if (typeof value === 'string' && ID_PATTERN.test(value)) {
    return (idMap.getPlaceholderFor(value) ?? idMap.allocate(value)) as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteIds(v, idMap)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substituteIds(v, idMap)]),
    ) as T
  }
  return value
}
