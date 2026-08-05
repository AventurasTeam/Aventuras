import type { IdBiMap } from '@/lib/ids'

/** Schema fields whose string value is an entity reference. Must stay in sync
 * with plan.ts's `resolveRef` call sites. */
export const PLACEHOLDER_FIELDS = ['ref', 'subject', 'object'] as const

/**
 * Namespace the prompt reserves for `newCharacters` handles, so a handle can never
 * be mistaken for an entity placeholder (`c1`, `hp1`, ...).
 */
export const NEW_HANDLE_PREFIX = 'new:'

/**
 * Placeholder -> UUID, the return trip for a classifier extraction (`substituteIds`
 * only maps the forward direction). Unknown strings pass through untouched, so the
 * planner can still resolve `newCharacters` temp handles through its own handleMap.
 *
 * `reservedHandles` are never rewritten even when they collide with a placeholder:
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
        return [key, reservedHandles.has(v) ? v : (idMap.getUuidFor(v) ?? v)]
      }
      return [key, substituteClassifierIds(v, idMap, reservedHandles)]
    }),
  ) as T
}
