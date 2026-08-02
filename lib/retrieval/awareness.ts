import type { QueryAll } from './types'

export type AwarenessRow = {
  id: string
  happeningId: string
  characterId: string
  learnedAtEntryId: string | null
  decayResistance: number | null
  source: string | null
}

/**
 * retrieval.md → POV-awareness scope: the UNION of all in-scene characters'
 * awareness rows in both modes, not lead-only. Detached-POV moments need the
 * wider scope; the `narration` setting is the lever for POV constraint via
 * prompt, not retrieval.
 */
export async function loadAwarenessForScene(
  queryAll: QueryAll,
  branchId: string,
  sceneCharacterIds: readonly string[],
): Promise<AwarenessRow[]> {
  if (sceneCharacterIds.length === 0) return []
  const placeholders = sceneCharacterIds.map(() => '?').join(', ')
  // branch_id leads the predicate because it also leads haw_natural_uniq
  // (branch_id, character_id, happening_id).
  const rows = await queryAll(
    `SELECT id, happening_id, character_id, learned_at_entry_id, decay_resistance, source
     FROM happening_awareness
     WHERE branch_id = ? AND character_id IN (${placeholders})`,
    [branchId, ...sceneCharacterIds],
  )
  return rows.map((r) => {
    const [id, happeningId, characterId, learnedAtEntryId, decayResistance, source] = r as [
      string,
      string,
      string,
      string | null,
      number | null,
      string | null,
    ]
    return { id, happeningId, characterId, learnedAtEntryId, decayResistance, source }
  })
}
