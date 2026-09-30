import type { Entity } from '@/lib/db'

/**
 * The lead's row on this branch, or null. The lead is story-level while entities are per branch,
 * and a reversal of the lead's create keeps its id, so it can dangle (data-model.md → Story
 * settings shape); readers treat a dangling lead as absent.
 */
export function resolveLead(
  leadEntityId: string | null | undefined,
  entities: ReadonlyMap<string, Entity>,
  branchId: string,
): Entity | null {
  if (leadEntityId == null) return null
  const row = entities.get(leadEntityId)
  return row != null && row.branchId === branchId && row.kind === 'character' ? row : null
}
