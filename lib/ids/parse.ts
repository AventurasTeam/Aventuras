import type { IdBiMap } from './bimap'
import { MalformedPlaceholderError } from './errors'
import { PLACEHOLDER_PATTERN } from './prefixes'

export function parseAndSubstitute<T>(value: T, idMap: IdBiMap): T {
  if (typeof value === 'string') {
    const uuid = idMap.getUuidFor(value)
    if (uuid !== undefined) return uuid as T
    if (PLACEHOLDER_PATTERN.test(value)) throw new MalformedPlaceholderError(value)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v) => parseAndSubstitute(v, idMap)) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, parseAndSubstitute(v, idMap)]),
    ) as T
  }
  return value
}
