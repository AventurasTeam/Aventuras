import { describe, expect, it } from 'vitest'

import { emptyEntityState, type CharacterState, type Entity } from '@/lib/db'

import { withMergeSceneEffects } from './merge-scene'
import type { PipelineAction } from '../types'

const canonical = {
  id: 'char_a',
  branchId: 'b1',
  kind: 'character',
  name: 'Brannoc',
  status: 'active',
  state: emptyEntityState('character'),
} as Entity

const tail = { id: 'entry_2', sceneEntities: ['char_b'], currentLocationId: 'loc_b' }

const rewrite: PipelineAction = {
  kind: 'updateStoryEntryMetadata',
  source: 'user_edit',
  payload: { branchId: 'b1', id: 'entry_2', metadata: { sceneEntities: ['char_a'] } },
}

describe('withMergeSceneEffects', () => {
  // No character merge plans a state patch on the canonical today: this pins the fold if one does.
  it("folds the tail's location into a state patch the plan already writes", () => {
    const state: CharacterState = { ...emptyEntityState('character'), inventory: ['item_a'] }
    const update: PipelineAction = {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_a', patch: { state } },
    }

    const actions = withMergeSceneEffects({
      branchId: 'b1',
      actions: [update, rewrite],
      canonical,
      tail,
    })

    expect(actions).toEqual([
      {
        ...update,
        payload: {
          ...update.payload,
          patch: { state: { ...state, current_location_id: 'loc_b' } },
        },
      },
      rewrite,
    ])
  })
})
