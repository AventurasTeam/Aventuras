import type { Entity } from '@/lib/db'

import { checkParentChain, type ParentOf } from './parent-chain'
import type { PlacePlacement } from './placement'

/** A declaration's parent for a top-level place; every surface's own token maps to it. */
export const TOP_LEVEL = 'top'

/**
 * A place a writer declares, by its temporary handle. `parent`: a place id, another declaration's
 * handle, `TOP_LEVEL`, or absent for a place known to exist but not where.
 */
export type NewPlaceDeclaration = { handle: string; parent?: string }

/** A create in settling order. One whose parent never resolved still names that parent. */
export type SettlingPlace<E extends NewPlaceDeclaration> =
  | { emission: E; parentUnresolved: false }
  | { emission: E & { parent: string }; parentUnresolved: true }

export type SettlingOrder<E extends NewPlaceDeclaration> = {
  order: SettlingPlace<E>[]
  /** Creates declaring a handle an earlier create declared: the first declaration keeps it. */
  duplicates: E[]
}

/** Why a new place landed unplaced although it named a parent (piggyback.md → Parent). */
export type ParentDropCause = 'unresolved' | 'retired' | 'chain-broken'

/** Where a new place goes: the placement its parent gives, or unplaced for `cause`. */
export type NewPlacement =
  | { kind: 'kept'; placement: PlacePlacement }
  | { kind: 'dropped'; cause: ParentDropCause; parent: string }

function inHandleCycle(create: NewPlaceDeclaration, waiting: readonly NewPlaceDeclaration[]) {
  const parentOf = new Map(waiting.map((e) => [e.handle, e.parent]))
  const seen = new Set<string>()
  let at = create.parent
  while (at !== undefined && !seen.has(at)) {
    if (at === create.handle) return true
    seen.add(at)
    at = parentOf.get(at)
  }
  return false
}

const namesParent = <E extends NewPlaceDeclaration>(e: E): e is E & { parent: string } =>
  e.parent !== undefined

/**
 * Top-down, else in list order: a create waits for its own parent only. No parent or `TOP_LEVEL`
 * settles at once; an unresolvable parent (undeclared handle, non-location id, cycle) unplaces it.
 */
export function settlingOrder<E extends NewPlaceDeclaration>(
  creates: readonly E[],
  isLocationId: (id: string) => boolean,
): SettlingOrder<E> {
  const declared = new Set<string>()
  const unique: E[] = []
  const duplicates: E[] = []
  for (const create of creates) {
    if (declared.has(create.handle)) {
      duplicates.push(create)
    } else {
      declared.add(create.handle)
      unique.push(create)
    }
  }

  const order: SettlingPlace<E>[] = []
  const settled = new Set<string>()
  const settle = (place: SettlingPlace<E>) => {
    order.push(place)
    settled.add(place.emission.handle)
  }
  const resolvable = (parent: string | undefined) =>
    parent === undefined ||
    parent === TOP_LEVEL ||
    settled.has(parent) ||
    (!declared.has(parent) && isLocationId(parent))

  let waiting = unique
  while (waiting.length > 0) {
    const next = waiting.find((e) => resolvable(e.parent))
    if (next !== undefined) settle({ emission: next, parentUnresolved: false })
    else {
      // No parent and TOP_LEVEL always settle, so every waiting create names another parent.
      const parented = waiting.filter(namesParent)
      const handles = new Set(waiting.map((e) => e.handle))
      const orphans = parented.filter((e) => !handles.has(e.parent))
      // No orphan: every waiting create is in a handle cycle or hangs off one.
      const stuck = orphans.length > 0 ? orphans : parented.filter((e) => inHandleCycle(e, waiting))
      for (const emission of stuck) settle({ emission, parentUnresolved: true })
    }
    waiting = waiting.filter((e) => !settled.has(e.handle))
  }
  return { order, duplicates }
}

/**
 * piggyback.md → Parent: `TOP_LEVEL` is top-level; no parent, a retired parent, a broken stored
 * chain or an unresolvable one unplaces it. `resolve` maps the declared parent to its row id.
 */
export function placeNewLocation(args: {
  place: SettlingPlace<NewPlaceDeclaration>
  resolve: (parent: string) => string
  statusOf: (id: string) => Entity['status'] | undefined
  parentOf: ParentOf
}): NewPlacement {
  const { place, resolve, statusOf, parentOf } = args
  if (place.parentUnresolved)
    return { kind: 'dropped', cause: 'unresolved', parent: place.emission.parent }
  const { handle, parent } = place.emission
  if (parent === undefined) return { kind: 'kept', placement: { kind: 'unplaced' } }
  if (parent === TOP_LEVEL) return { kind: 'kept', placement: { kind: 'top' } }
  const parentId = resolve(parent)
  // Nothing active may sit inside a retired place (data-model.md → LocationState shape).
  if (statusOf(parentId) === 'retired') return { kind: 'dropped', cause: 'retired', parent }
  // The new row has no children, so only a loop already stored above its parent fails.
  if (checkParentChain(handle, parentId, parentOf) !== 'ok')
    return { kind: 'dropped', cause: 'chain-broken', parent }
  return { kind: 'kept', placement: { kind: 'under', parentId } }
}
