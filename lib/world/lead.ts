import type { Entity, StoryDefinition, StoryEntry, StoryMode } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { oneLine } from '@/lib/text'

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

/** As resolveLead, logging a double: for a reader outside the render path. */
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

/** Who "I" and "you" are from a marked turn on (architecture.md → System and user halves). */
export type LeadMark =
  | { id: string; name: string; gone?: never; none?: never }
  | { gone: true; none?: never }
  | { none: true; gone?: never }

/** The lead an entry was written under: its `metadata.leadId`, undefined when unstamped. */
export function leadStampOf(entry: Pick<StoryEntry, 'metadata'>): string | undefined {
  return entry.metadata?.leadId
}

/**
 * Each turn's mark in render order, undefined on an unmarked turn; a mark's name is on one line.
 * `nameOf` gives the character row's name, undefined when the branch holds no such row.
 */
export function leadMarks(
  stamps: readonly (string | undefined)[],
  namedLeadId: string | null,
  nameOf: (id: string) => string | undefined,
): (LeadMark | undefined)[] {
  // A named lead of null is no lead, as an unstamped turn is: the two compare equal.
  let previous = namedLeadId ?? undefined
  return stamps.map((stamp): LeadMark | undefined => {
    if (stamp === previous) return undefined
    previous = stamp
    if (stamp === undefined) return { none: true }
    const name = nameOf(stamp)
    return name === undefined ? { gone: true } : { id: stamp, name: oneLine(name) }
  })
}
