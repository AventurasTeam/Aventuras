import { PAYLOAD_META_PREFIX } from '../delta/delta-encoding'

/**
 * chapter-close.md → 3f: the partner of the live flag a user edit cleared. A meta key, so a
 * reversal that rewrites the edit's prior flag (generation-pipeline.md → Reverse-replay) keeps it.
 */
export const RESOLVED_PAIR_KEY = `${PAYLOAD_META_PREFIX}resolvedPair` as const

/** `undoPayload` naming the partner whose live flag it records the user clearing, if it does. */
export function withResolvedPair(undoPayload: Record<string, unknown>): Record<string, unknown> {
  const partner = undoPayload.nameCollisionPartnerId
  if (undoPayload.nameCollisionFlag !== 1 || typeof partner !== 'string') return undoPayload
  return { ...undoPayload, [RESOLVED_PAIR_KEY]: partner }
}

/**
 * Whether a user edit's undo payload says the user resolved the pair with `partnerId`. The meta key
 * decides when present: a reversal may have rewritten the prior flag to a partner the user never saw.
 */
export function resolvesPair(undoPayload: Record<string, unknown> | null, partnerId: string) {
  if (undoPayload == null) return false
  if (Object.hasOwn(undoPayload, RESOLVED_PAIR_KEY))
    return undoPayload[RESOLVED_PAIR_KEY] === partnerId
  return undoPayload.nameCollisionFlag === 1 && undoPayload.nameCollisionPartnerId === partnerId
}
