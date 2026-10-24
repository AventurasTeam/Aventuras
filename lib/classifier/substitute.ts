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

/**
 * Placeholder -> UUID, the return trip for a classifier extraction (`substituteIds`
 * only maps the forward direction). Unknown strings pass through untouched, so the
 * planner can still resolve temp handles through its own handleMap.
 *
 * `reservedHandles` are never rewritten where a handle can stand, even on a placeholder collision:
 * a model that ignores NEW_HANDLE_PREFIX and names a new character `c1` would
 * otherwise have every ref to it silently redirected to the existing entity `c1`.
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
        const reserved =
          (HANDLE_FIELDS as readonly string[]).includes(key) && reservedHandles.has(v)
        return [key, reserved ? v : (idMap.getUuidFor(v) ?? v)]
      }
      return [key, substituteClassifierIds(v, idMap, reservedHandles)]
    }),
  ) as T
}
