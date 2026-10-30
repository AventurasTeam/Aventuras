import type { Entity } from '@/lib/db'
import { compareAge } from '@/lib/list-modules'

import { nameBasis } from './namesakes'
import { samePlacement, type PlacePlacement } from './placement'

/**
 * classifier.md → What the classifier writes → Names: the rows holding `name` against `row`, oldest
 * first. `rows` are the rows of its kind, any status. A place holds it against a real sibling, or
 * against any place when either is unplaced (piggyback.md → Matching before creating).
 */
export function nameHolders<R extends Pick<Entity, 'id' | 'name' | 'createdAt'>>(
  row: Pick<Entity, 'id' | 'kind'>,
  name: string,
  rows: readonly R[],
  placementAt: (id: string) => PlacePlacement,
): R[] {
  const compared = (id: string): boolean => {
    if (row.kind !== 'location') return true
    const [own, other] = [placementAt(row.id), placementAt(id)]
    return own.kind === 'unplaced' || other.kind === 'unplaced' || samePlacement(own, other)
  }
  return rows
    .filter((r) => r.id !== row.id && nameBasis(r.name, name) === 'same-name' && compared(r.id))
    .sort(compareAge)
}
