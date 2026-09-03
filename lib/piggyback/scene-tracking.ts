import type { DeltaSource, PipelineAction } from '@/lib/actions'
import type { Entity } from '@/lib/db'

type SceneFields = { sceneEntities: string[]; currentLocationId: string | null }

type Args = {
  branchId: string
  source: DeltaSource
  entities: readonly Entity[]
  /** The PREVIOUS entry's state — supplies the lastSeenAt anchor. */
  previous: {
    entryId: string
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
 * Auto-promote on scene membership: naming a staged entity in the scene is a strong
 * signal of intentional introduction (docs/memory/piggyback.md → Auto-promote on
 * staged-ID emission). Shared by the generation fold and the scene editor so a user
 * adding a staged character promotes them exactly as the classifier would.
 *
 * Deliberately one-directional — removing someone never demotes. No demote action
 * exists, and retiring an entity over a scene-list typo is the worse failure.
 */
export function scenePromotionActions(args: {
  branchId: string
  source: DeltaSource
  entities: readonly Entity[]
  sceneEntities: readonly string[]
}): PipelineAction[] {
  const { branchId, source, entities, sceneEntities } = args
  const byId = new Map(entities.map((e) => [e.id, e]))
  return sceneEntities
    .filter((id) => byId.get(id)?.status === 'staged')
    .map((id) => ({ kind: 'promoteStagedEntity', source, payload: { branchId, id } }) as const)
}

/**
 * Per-character `current_location_id` and `lastSeenAt` behind a scene change
 * (docs/memory/piggyback.md → What piggyback writes). Three-way so an edit can pass this
 * entry's ORIGINAL scene as `before`: folding from `previous` alone would skip a
 * character in neither the previous nor the edited scene, stranding what the fold wrote.
 */
export function sceneTrackingActions(args: Args): PipelineAction[] {
  const { branchId, source, entities, previous, before, after } = args
  const actions: PipelineAction[] = []

  const wasInScene = new Set([...previous.sceneEntities, ...before.sceneEntities])
  const nowInScene = new Set(after.sceneEntities)

  for (const character of entities.filter((e) => e.kind === 'character')) {
    if (nowInScene.has(character.id)) {
      // Null included: an edit that clears the scene's location must clear it on the
      // members too, or their rows keep naming a location the entry no longer claims.
      actions.push({
        kind: 'updateEntityLocationTracking',
        source,
        payload: { branchId, id: character.id, currentLocationId: after.currentLocationId },
      })
    } else if (wasInScene.has(character.id)) {
      // A lastSeenAt anchored at an unknown location records nothing useful.
      if (previous.currentLocationId !== null) {
        actions.push({
          kind: 'updateEntityLocationTracking',
          source,
          payload: {
            branchId,
            id: character.id,
            // Out of scene, current_location_id tracks the lastSeenAt anchor. Written
            // rather than left alone because the fold may already have moved them with
            // a scene this edit says they were never in.
            currentLocationId: previous.currentLocationId,
            lastSeenAt: {
              entryId: previous.entryId,
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
