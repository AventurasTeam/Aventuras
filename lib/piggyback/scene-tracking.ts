import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'

type SceneFields = { sceneEntities: string[]; currentLocationId: string | null }

type Args = {
  branchId: string
  source: DeltaSource
  entities: readonly Entity[]
  /** The PREVIOUS entry's state — supplies the lastSeenAt anchor. */
  previous: {
    entryId?: string
    sceneEntities: string[]
    currentLocationId: string | null
    worldTime: number
  }
  /** This entry's scene as it stands now. On the generation path it equals `previous`. */
  before: SceneFields
  /** This entry's scene after the change. */
  after: SceneFields
}

/**
 * The computed bookkeeping behind a scene change: per-character
 * `current_location_id` and `lastSeenAt` (docs/memory/piggyback.md → What piggyback
 * writes).
 *
 * Three-way rather than two-way. The generation path passes `before === previous` and
 * folds one step; an edit passes this entry's ORIGINAL scene as `before`, so a
 * character the edit removed is still visited and gets their tracking closed. Folding
 * from `previous` alone would skip anyone who was in the original scene but in neither
 * the previous entry's nor the edited one, stranding the location the first fold wrote.
 *
 * Never demotes: no demote action exists, and retiring an entity over a scene-list typo
 * is the worse failure (docs/ui/patterns/entry-card.md → Scene editor).
 */
export function sceneTrackingActions(args: Args): PipelineAction[] {
  const { branchId, source, entities, previous, before, after } = args
  const actions: PipelineAction[] = []

  const wasInScene = new Set([...previous.sceneEntities, ...before.sceneEntities])
  const nowInScene = new Set(after.sceneEntities)

  for (const character of entities.filter((e) => e.kind === 'character')) {
    if (nowInScene.has(character.id) && after.currentLocationId !== null) {
      actions.push({
        kind: 'updateEntityLocationTracking',
        source,
        payload: { branchId, id: character.id, currentLocationId: after.currentLocationId },
      })
    } else if (wasInScene.has(character.id) && !nowInScene.has(character.id)) {
      // Only when we know where they were: a null locationId produces a delta the
      // handler rejects, since piggyback creates no rows.
      if (previous.currentLocationId !== null) {
        actions.push({
          kind: 'updateEntityLocationTracking',
          source,
          payload: {
            branchId,
            id: character.id,
            lastSeenAt: {
              entryId: previous.entryId ?? '',
              locationId: previous.currentLocationId,
              worldTime: previous.worldTime,
            },
          },
        })
      }
    }
  }
  return actions
}
