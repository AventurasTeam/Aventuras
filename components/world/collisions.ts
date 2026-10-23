import type { Entity } from '@/lib/db'
import { collisionPairOf } from '@/lib/world'

export type CollisionTarget = { otherId: string; otherName: string }

/**
 * Flagged rows → the stored partner each pairs with (world.md → Surfacing), under the resolve
 * action's pair rule, so a strip shows only where Resolve can act. A dormant flag gets none.
 */
export function deriveCollisions(
  entities: readonly Entity[],
): ReadonlyMap<string, CollisionTarget> {
  const out = new Map<string, CollisionTarget>()
  for (const e of entities) {
    if (e.nameCollisionFlag !== 1 || e.nameCollisionPartnerId == null) continue
    const lookup = collisionPairOf(entities, [e.id, e.nameCollisionPartnerId])
    if ('miss' in lookup) continue
    const [, partner] = lookup.pair
    out.set(e.id, { otherId: partner.id, otherName: partner.name })
  }
  return out
}
