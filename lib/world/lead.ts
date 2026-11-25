import type { Entity, StoryDefinition, StoryMode } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

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

/** Adventure in any narration, or a creative story told in the first or second person. */
export function needsLead(
  mode: StoryDefinition['mode'],
  narration: StoryDefinition['narration'],
): boolean {
  return mode === 'adventure' || narration === 'first' || narration === 'second'
}

function flaggedCharacters(entities: ReadonlyMap<string, Entity>, branchId: string): Entity[] {
  const flagged: Entity[] = []
  for (const row of entities.values())
    if (row.isLead === 1 && row.kind === 'character' && row.branchId === branchId) flagged.push(row)
  return flagged
}

/**
 * The branch's lead by the flag, whatever its status; null with none or two. Silent: a render path
 * sees a redo's transient double (data-model.md → The lead).
 */
export function resolveLead(
  entities: ReadonlyMap<string, Entity>,
  branchId: string,
): Entity | null {
  const flagged = flaggedCharacters(entities, branchId)
  return flagged.length === 1 ? flagged[0] : null
}

/** As resolveLead, logging a double: for the actions and the pipelines. */
export function resolveLeadLogged(
  entities: ReadonlyMap<string, Entity>,
  branchId: string,
  site: string,
): Entity | null {
  const flagged = flaggedCharacters(entities, branchId)
  if (flagged.length > 1)
    logger.error('pipeline.lead_double', { site, branchId, ids: flagged.map((row) => row.id) })
  return flagged.length === 1 ? flagged[0] : null
}
