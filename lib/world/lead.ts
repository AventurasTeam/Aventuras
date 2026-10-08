import type { Entity, StoryMode } from '@/lib/db'

/** The lead badge's copy key (`world:lead.<label>`). */
export type LeadLabel = 'you' | 'protagonist'

/** `you` in adventure, `protagonist` in creative. */
export function leadLabelFor(mode: StoryMode): LeadLabel {
  switch (mode) {
    case 'adventure':
      return 'you'
    case 'creative':
      return 'protagonist'
  }
}

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
