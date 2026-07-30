import type { IdBiMap } from '@/lib/ids'

/**
 * Schema fields whose string value is an entity reference, so the only ones the
 * return trip rewrites. Kept beside the schema, not in the pipeline shell: this
 * is the mirror of plan.ts's `resolveRef` call sites and the two must agree —
 * substitute.test.ts is the link that makes a new ref-bearing field break here.
 */
export const PLACEHOLDER_FIELDS = ['ref', 'subject', 'object'] as const

/**
 * Placeholder -> UUID, the return trip for a classifier extraction. The generic
 * `substituteIds` walker only maps UUID -> placeholder, so the way back needs
 * its own pass (same split as `substitutePiggybackIds`).
 *
 * Unknown strings pass through untouched — a model-invented handle, or a
 * `newCharacters` temp handle — which is what lets the planner resolve temp
 * handles through its own `handleMap` and report the rest as unresolved.
 */
export function substituteClassifierIds<T>(value: T, idMap: IdBiMap): T {
  if (Array.isArray(value)) return value.map((v) => substituteClassifierIds(v, idMap)) as T
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => {
      if (typeof v === 'string' && (PLACEHOLDER_FIELDS as readonly string[]).includes(key)) {
        return [key, idMap.getUuidFor(v) ?? v]
      }
      return [key, substituteClassifierIds(v, idMap)]
    }),
  ) as T
}
