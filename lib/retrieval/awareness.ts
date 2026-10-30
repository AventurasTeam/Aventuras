import type { StoryDefinition } from '@/lib/db'

import type { QueryAll } from './types'

export type AwarenessRow = {
  id: string
  happeningId: string
  characterId: string
  learnedAtEntryId: string | null
  decayResistance: number | null
  source: string | null
  /**
   * Read here rather than in the bump handler: this query already returns the
   * rows the bumps target, so carrying the count spares the handler a read per
   * bump on a path that fires once per aware in-scene character per seated
   * happening, ahead of the narrative stream.
   */
  retrievalCount: number
}

/**
 * retrieval.md → POV-awareness scope: the scene's characters, plus the lead where the story is told
 * from their side, so a missed scene tag can't wipe what they know. `leadId` is resolved, or null.
 */
export function awarenessScope(
  sceneCharacterIds: readonly string[],
  leadId: string | null,
  definition: Pick<StoryDefinition, 'mode' | 'narration'>,
): string[] {
  const toldFromLead = definition.mode === 'adventure' || definition.narration !== 'third'
  return leadId != null && toldFromLead
    ? [...new Set([...sceneCharacterIds, leadId])]
    : [...sceneCharacterIds]
}

/**
 * retrieval.md → POV-awareness scope: the union of the scope's rows, not lead-only; the prompt, not
 * retrieval, keeps each character to what they know.
 */
export async function loadAwarenessForScene(
  queryAll: QueryAll,
  branchId: string,
  sceneCharacterIds: readonly string[],
): Promise<AwarenessRow[]> {
  if (sceneCharacterIds.length === 0) return []
  // Unchunked: one bind per character the tail entry puts in the scene.
  const placeholders = sceneCharacterIds.map(() => '?').join(', ')
  // branch_id leads the predicate because it also leads haw_natural_uniq
  // (branch_id, character_id, happening_id).
  const rows = await queryAll(
    `SELECT id, happening_id, character_id, learned_at_entry_id, decay_resistance, source, retrieval_count
     FROM happening_awareness
     WHERE branch_id = ? AND character_id IN (${placeholders})`,
    [branchId, ...sceneCharacterIds],
  )
  return rows.map((r) => {
    const [
      id,
      happeningId,
      characterId,
      learnedAtEntryId,
      decayResistance,
      source,
      retrievalCount,
    ] = r as [string, string, string, string | null, number | null, string | null, number]
    return {
      id,
      happeningId,
      characterId,
      learnedAtEntryId,
      decayResistance,
      source,
      retrievalCount,
    }
  })
}
