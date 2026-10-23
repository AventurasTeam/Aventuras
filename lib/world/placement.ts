import type { Entity, LocationState } from '@/lib/db'

/** data-model.md → LocationState shape: under a parent, top-level, or known to exist but not where. */
export type PlacePlacement =
  | { kind: 'under'; parentId: string }
  | { kind: 'top' }
  | { kind: 'unplaced' }

type StoredPlacement = Partial<Pick<LocationState, 'parent_location_id' | 'unplaced'>>

/** A row's stored placement; a reader holding the rows reads a parent naming no place as unplaced. */
export function placementOf(row: Pick<Entity, 'state'>): PlacePlacement {
  const state = row.state as StoredPlacement | null
  if (state?.unplaced === true) return { kind: 'unplaced' }
  const parentId = state?.parent_location_id ?? null
  return parentId === null ? { kind: 'top' } : { kind: 'under', parentId }
}

/** The stored flag only: a parent naming no place reads as placed. Row readers use `realPlacementOf`. */
export function isUnplaced(row: Pick<Entity, 'state'>): boolean {
  return placementOf(row).kind === 'unplaced'
}

/** The state with both keys for `placement`; the only writer of the parent and flag together. */
export function withPlacement(state: LocationState, placement: PlacePlacement): LocationState {
  const next: LocationState = { ...state }
  delete next.unplaced
  switch (placement.kind) {
    case 'under':
      next.parent_location_id = placement.parentId
      return next
    case 'top':
      next.parent_location_id = null
      return next
    case 'unplaced':
      next.parent_location_id = null
      next.unplaced = true
      return next
  }
}

/** Two unplaced places are the same placement, not places sharing a parent. */
export function samePlacement(a: PlacePlacement, b: PlacePlacement): boolean {
  if (a.kind === 'under' && b.kind === 'under') return a.parentId === b.parentId
  return a.kind === b.kind
}
