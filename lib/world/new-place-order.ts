import type { Entity } from '@/lib/db'

import { checkParentChain, type ParentOf } from './parent-chain'

/** A place a writer declares, by its temporary handle, nested under a `parent` id or handle. */
export type NewPlaceDeclaration = { handle: string; parent?: string }

export type SettlingPlace<E> = { emission: E; parentUnresolved: boolean }

/** Why a new place went to the root although it named a parent (piggyback.md → Parent). */
export type ParentDropCause = 'unresolved' | 'retired' | 'chain-broken'

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

/**
 * Top-down passes: a child listed before its parent settles on a later pass. A parent that never
 * resolves (undeclared handle, non-location id, handle cycle) roots its create; children follow it.
 */
export function settlingOrder<E extends NewPlaceDeclaration>(
  creates: readonly E[],
  isLocationId: (id: string) => boolean,
): SettlingPlace<E>[] {
  const order: SettlingPlace<E>[] = []
  const declared = new Set(creates.map((e) => e.handle))
  const settled = new Set<string>()
  const settle = (emission: E, parentUnresolved: boolean) => {
    order.push({ emission, parentUnresolved })
    settled.add(emission.handle)
  }
  const resolvable = (parent: string | undefined) =>
    parent === undefined || settled.has(parent) || (!declared.has(parent) && isLocationId(parent))

  let waiting = [...creates]
  while (waiting.length > 0) {
    const before = order.length
    for (const emission of waiting) if (resolvable(emission.parent)) settle(emission, false)
    if (order.length === before) {
      const handles = new Set(waiting.map((e) => e.handle))
      const orphans = waiting.filter((e) => e.parent === undefined || !handles.has(e.parent))
      // No orphan: every waiting create is in a handle cycle or hangs off one.
      const stuck = orphans.length > 0 ? orphans : waiting.filter((e) => inHandleCycle(e, waiting))
      for (const emission of stuck) settle(emission, true)
    }
    waiting = waiting.filter((e) => !settled.has(e.handle))
  }
  return order
}

/**
 * piggyback.md → Parent: a retired parent, or one whose stored chain is already broken, puts the new
 * place at the root, as an unresolvable one does. `parentId` is the parent's row id, null for none.
 */
export function placeNewLocation(args: {
  handle: string
  parentId: string | null
  parentUnresolved: boolean
  statusOf: (id: string) => Entity['status'] | undefined
  parentOf: ParentOf
}): { parentId: string | null; dropped: ParentDropCause | null } {
  const { handle, parentId, parentUnresolved, statusOf, parentOf } = args
  if (parentUnresolved) return { parentId: null, dropped: 'unresolved' }
  if (parentId === null) return { parentId: null, dropped: null }
  // Nothing active may sit inside a retired place (data-model.md → LocationState shape).
  if (statusOf(parentId) === 'retired') return { parentId: null, dropped: 'retired' }
  // The new row has no children, so only a loop already stored above its parent fails.
  if (checkParentChain(handle, parentId, parentOf) !== 'ok')
    return { parentId: null, dropped: 'chain-broken' }
  return { parentId, dropped: null }
}
