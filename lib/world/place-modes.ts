import type { Entity } from '@/lib/db'

import { parentChainIds, parentOfLocations } from './parent-chain'

type PlaceRow = Pick<Entity, 'id' | 'kind' | 'injectionMode' | 'state'>

export type PlaceModes<Row extends PlaceRow> = {
  /** Kept out of the prompt by its own `disabled`, or by an ancestor's that reaches it. */
  isDisabled: (id: string) => boolean
  /** The nearest ancestor whose `disabled` reaches the place; null when none does. */
  disabledThrough: (id: string) => Row | null
}

/**
 * data-model.md → LocationState shape. An ancestor at or above `storyLocationId` disables nothing
 * under it yet stays disabled itself; that location never is. Null gives the plain cascade.
 */
export function placeModes<Row extends PlaceRow>(
  rows: readonly Row[],
  storyLocationId: string | null,
): PlaceModes<Row> {
  const parentOf = parentOfLocations(rows)
  const places = new Map(rows.filter((r) => r.kind === 'location').map((r) => [r.id, r]))
  const aroundStory = new Set(
    storyLocationId == null ? [] : [storyLocationId, ...parentChainIds(storyLocationId, parentOf)],
  )
  const disabledThrough = (id: string): Row | null => {
    for (const ancestorId of parentChainIds(id, parentOf)) {
      const ancestor = places.get(ancestorId)
      if (ancestor?.injectionMode === 'disabled' && !aroundStory.has(ancestorId)) return ancestor
    }
    return null
  }
  const isDisabled = (id: string): boolean => {
    const place = places.get(id)
    if (place === undefined || id === storyLocationId) return false
    return place.injectionMode === 'disabled' || disabledThrough(id) !== null
  }
  return { isDisabled, disabledThrough }
}
