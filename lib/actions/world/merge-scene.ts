import type { CharacterState, Entity, EntityState } from '@/lib/db'
import type { DeleteTail } from '@/lib/world'

import type { PipelineAction } from '../types'

type CanonicalUpdate = Extract<PipelineAction, { kind: 'updateEntity' }>

/**
 * A merge that seats the canonical in the tail promotes it if staged and, for a character in the
 * scene, moves it to the tail's location: the next turn's structural floor seats only active rows.
 * Columns the plan's canonical update already writes are folded into it (a group writes each once).
 */
export function withMergeSceneEffects(input: {
  branchId: string
  actions: readonly PipelineAction[]
  canonical: Entity
  tail: DeleteTail | null
}): PipelineAction[] {
  const { branchId, actions, canonical, tail } = input
  const rewritesTail = actions.some(
    (a) => a.kind === 'updateStoryEntryMetadata' && a.payload.id === tail?.id,
  )
  if (tail == null || !rewritesTail) return [...actions]

  const update = actions.find(
    (a): a is CanonicalUpdate => a.kind === 'updateEntity' && a.payload.id === canonical.id,
  )
  let patch = update?.payload.patch ?? {}
  const added: PipelineAction[] = []

  if ((patch.status ?? canonical.status) === 'staged') {
    if (patch.status === undefined)
      added.push({
        kind: 'promoteStagedEntity',
        source: 'user_edit',
        payload: { branchId, id: canonical.id, proseEntryId: null },
      })
    else patch = { ...patch, status: 'active' }
  }

  // A rewritten tail always seats a character canonical in its scene and never changes its
  // location, so a null one is "never known", not a clear.
  const location = tail.currentLocationId
  if (canonical.kind === 'character' && location != null) {
    if (patch.state == null)
      added.push({
        kind: 'updateEntityLocationTracking',
        source: 'user_edit',
        payload: { branchId, id: canonical.id, currentLocationId: location },
      })
    else
      patch = {
        ...patch,
        state: { ...(patch.state as CharacterState), current_location_id: location } as EntityState,
      }
  }

  const folded = actions.map((a) =>
    a === update ? { ...update, payload: { ...update.payload, patch } } : a,
  )
  return [...folded, ...added]
}
