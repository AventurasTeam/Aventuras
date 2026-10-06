import type { Entity } from '@/lib/db'
import { namesakeKey } from '@/lib/world'

export type CollisionTarget = { otherId: string; otherName: string }

// namesakeKey is the flag writer's rule (lib/world pins it to the classifier's), so the review
// surface can't disagree with what tripped the flag.
const keyOf = namesakeKey

/**
 * Flagged rows → the same-kind namesake they collide with. Ranked
 * unflagged-first, then oldest, then by id — a total order independent of
 * Map/array iteration order.
 */
export function deriveCollisions(
  entities: readonly Entity[],
): ReadonlyMap<string, CollisionTarget> {
  const byKey = new Map<string, Entity[]>()
  for (const e of entities) {
    const key = keyOf(e)
    const group = byKey.get(key)
    if (group) group.push(e)
    else byKey.set(key, [e])
  }
  const out = new Map<string, CollisionTarget>()
  for (const e of entities) {
    if (e.nameCollisionFlag !== 1) continue
    const namesakes = (byKey.get(keyOf(e)) ?? []).filter((n) => n.id !== e.id)
    const other = [...namesakes].sort(
      (a, b) =>
        a.nameCollisionFlag - b.nameCollisionFlag ||
        a.createdAt - b.createdAt ||
        (a.id < b.id ? -1 : 1),
    )[0]
    if (other == null) continue
    out.set(e.id, { otherId: other.id, otherName: other.name })
  }
  return out
}
