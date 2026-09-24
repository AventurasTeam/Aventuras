import type { Entity, LocationState } from '@/lib/db'

/** data-model.md → LocationState: the pre-commit walk's depth cap. */
export const PARENT_CHAIN_DEPTH_CAP = 100

/** The `reason` and `code` a `parent_location_id` write that would loop is refused with. */
export const PARENT_CYCLE = 'parent-cycle'

export type ParentOf = (id: string) => string | null

export type ParentChainCheck = 'ok' | 'cycle' | 'cap-hit'

/**
 * `cycle`: the walk up from `proposedParentId` reaches `id`. `cap-hit`: it passes the cap first
 * (a loop elsewhere, or an over-deep chain) — callers refuse both.
 */
export function checkParentChain(
  id: string,
  proposedParentId: string | null,
  parentOf: ParentOf,
): ParentChainCheck {
  let current = proposedParentId
  for (let depth = 0; current != null; depth++) {
    if (current === id) return 'cycle'
    if (depth >= PARENT_CHAIN_DEPTH_CAP) return 'cap-hit'
    current = parentOf(current)
  }
  return 'ok'
}

type LocationRow = Pick<Entity, 'id' | 'kind' | 'state'>

/** Parent pointers of the location rows; any other id has none. */
export function parentOfLocations(rows: readonly LocationRow[]): ParentOf {
  const parents = new Map<string, string | null>()
  for (const row of rows) {
    if (row.kind !== 'location') continue
    parents.set(row.id, (row.state as LocationState | null)?.parent_location_id ?? null)
  }
  return (id) => parents.get(id) ?? null
}

/** Ancestors, nearest first; stops at a repeat or the cap so a corrupt chain still renders. */
export function parentChainIds(id: string, parentOf: ParentOf): string[] {
  const chain: string[] = []
  const seen = new Set([id])
  let current = parentOf(id)
  while (current != null && !seen.has(current) && chain.length < PARENT_CHAIN_DEPTH_CAP) {
    chain.push(current)
    seen.add(current)
    current = parentOf(current)
  }
  return chain
}
