import type { IdBiMap } from '@/lib/ids'

// The reference fields a new row's handle can stand in; `happening` and `thread` name listed rows.
const HANDLE_FIELDS = ['ref', 'subject', 'object', 'parent', 'character', 'faction'] as const

/** Schema fields whose string value is an entity reference. Must stay in sync
 * with the planner's ref consumers. */
export const PLACEHOLDER_FIELDS = [...HANDLE_FIELDS, 'happening', 'thread'] as const

/**
 * Namespace the prompt reserves for `newCharacters`, `newFactions` and `newPlaces` handles, so a
 * handle can never be mistaken for an entity placeholder (`c1`, `hp1`, ...).
 */
export const NEW_HANDLE_PREFIX = 'new:'

/** The ID inside the brackets the prompt shows it in, for a reply that copied them: "[c1]" is c1. */
export const unbracketed = (value: string): string | undefined => /^\[([^[\]]+)\]$/.exec(value)?.[1]

/**
 * Placeholder -> UUID, the return trip of `substituteIds`; unknown strings pass through for the
 * planner's handleMap. `reservedHandles` are never rewritten where a handle can stand: a model
 * ignoring NEW_HANDLE_PREFIX and naming a new character `c1` has its refs sent to entity `c1`.
 */
export function substituteClassifierIds<T>(
  value: T,
  idMap: IdBiMap,
  reservedHandles: ReadonlySet<string> = new Set(),
): T {
  if (Array.isArray(value))
    return value.map((v) => substituteClassifierIds(v, idMap, reservedHandles)) as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (typeof v === 'string' && (PLACEHOLDER_FIELDS as readonly string[]).includes(key)) {
        const handleField = (HANDLE_FIELDS as readonly string[]).includes(key)
        const known = (ref: string): boolean =>
          (handleField && reservedHandles.has(ref)) || idMap.getUuidFor(ref) != null
        const bare = unbracketed(v)
        const ref = bare != null && !known(v) && known(bare) ? bare : v
        const reserved = handleField && reservedHandles.has(ref)
        return [key, reserved ? ref : (idMap.getUuidFor(ref) ?? ref)]
      }
      return [key, substituteClassifierIds(v, idMap, reservedHandles)]
    }),
  ) as T
}
