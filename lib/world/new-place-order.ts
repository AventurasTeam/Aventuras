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

export type SettlingOrder<E extends NewPlaceDeclaration> = { order: SettlingPlace<E>[] }

/** Why a new place landed unplaced although it named a parent (piggyback.md → Parent). */
export type ParentDropCause = 'unresolved' | 'retired' | 'chain-broken'

/** Where a new place goes: the placement its parent gives, or unplaced for `cause`. */
export type NewPlacement =
  | { kind: 'kept'; placement: PlacePlacement }
  | { kind: 'dropped'; cause: ParentDropCause; parent: string }

function inHandleCycle(
  create: NewPlaceDeclaration,
  parentOf: ReadonlyMap<string, string | undefined>,
) {
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
 * Top-down, else in list order: a create waits for its own parent only, so one whose parent never
 * resolves (an undeclared handle, a non-location id, a handle cycle) settles unplaced in its own
 * place. Handles are unique: each caller drops a repeated one first.
 */
export function settlingOrder<E extends NewPlaceDeclaration>(
  creates: readonly E[],
  isLocationId: (id: string) => boolean,
): SettlingOrder<E> {
  const declared = new Set(creates.map((create) => create.handle))
  const parentOf = new Map(creates.map((create) => [create.handle, create.parent]))
  const cyclic = new Set(
    creates.filter((create) => inHandleCycle(create, parentOf)).map((create) => create.handle),
  )
  const order: SettlingPlace<E>[] = []
  const settled = new Set<string>()
  const resolvable = (parent: string | undefined) =>
    parent === undefined ||
    parent === TOP_LEVEL ||
    settled.has(parent) ||
    (!declared.has(parent) && isLocationId(parent))
  const neverResolves = (create: E): create is E & { parent: string } =>
    namesParent(create) &&
    create.parent !== TOP_LEVEL &&
    (cyclic.has(create.handle) || (!declared.has(create.parent) && !isLocationId(create.parent)))

  let waiting = creates
  while (waiting.length > 0) {
    const next = waiting.find((e) => resolvable(e.parent) || neverResolves(e))
    // Every waiting create hangs off one that settles, so one always can.
    if (next === undefined) throw new Error('settlingOrder: no create can settle')
    order.push(
      neverResolves(next)
        ? { emission: next, parentUnresolved: true }
        : { emission: next, parentUnresolved: false },
    )
    settled.add(next.handle)
    waiting = waiting.filter((e) => !settled.has(e.handle))
  }
  return { order }
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
