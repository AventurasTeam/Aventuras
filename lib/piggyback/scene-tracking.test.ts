import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import { sceneTrackingActions } from './scene-tracking'

const branchId = 'branch_a'
const entities = [
  { id: 'char_a', kind: 'character', status: 'active' },
  { id: 'char_b', kind: 'character', status: 'active' },
  { id: 'item_a', kind: 'item', status: 'active' },
] as unknown as Entity[]

function payloadsFor(actions: ReturnType<typeof sceneTrackingActions>, id: string) {
  return actions
    .filter((a) => a.kind === 'updateEntityLocationTracking')
    .map((a) => a.payload as { id: string; currentLocationId?: string; lastSeenAt?: unknown })
    .filter((p) => p.id === id)
}

describe('sceneTrackingActions', () => {
  it('sets location tracking for a character entering the scene', () => {
    const actions = sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities,
      previous: { entryId: 'ent_0', sceneEntities: [], currentLocationId: null, worldTime: 0 },
      before: { sceneEntities: [], currentLocationId: null },
      after: { sceneEntities: ['char_a'], currentLocationId: 'loc_a' },
    })
    expect(payloadsFor(actions, 'char_a')).toEqual([
      { branchId, id: 'char_a', currentLocationId: 'loc_a' },
    ])
  })

  // The trap the three-way shape exists for: char_b was in this entry's ORIGINAL
  // scene but is in neither the previous entry's nor the edited one. Folding from
  // `previous` alone never visits it, leaving the location the first fold wrote.
  it('closes tracking for a character the edit removed from the scene', () => {
    const actions = sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities,
      previous: {
        entryId: 'ent_0',
        sceneEntities: ['char_a'],
        currentLocationId: 'loc_a',
        worldTime: 100,
      },
      before: { sceneEntities: ['char_a', 'char_b'], currentLocationId: 'loc_a' },
      after: { sceneEntities: ['char_a'], currentLocationId: 'loc_a' },
    })
    const forB = payloadsFor(actions, 'char_b')
    expect(forB).toHaveLength(1)
    expect(forB[0]).toMatchObject({
      lastSeenAt: { entryId: 'ent_0', locationId: 'loc_a', worldTime: 100 },
    })
  })

  // Promotion is a semantic event; no demote action exists and retiring an entity
  // over a scene-list typo is the worse failure.
  it('never emits a demotion', () => {
    const actions = sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities,
      previous: {
        entryId: 'ent_0',
        sceneEntities: ['char_a'],
        currentLocationId: 'loc_a',
        worldTime: 0,
      },
      before: { sceneEntities: ['char_a'], currentLocationId: 'loc_a' },
      after: { sceneEntities: [], currentLocationId: 'loc_a' },
    })
    expect(actions.every((a) => a.kind === 'updateEntityLocationTracking')).toBe(true)
  })

  it('re-points every in-scene character when the location alone changed', () => {
    const actions = sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities,
      previous: {
        entryId: 'ent_0',
        sceneEntities: ['char_a'],
        currentLocationId: 'loc_a',
        worldTime: 0,
      },
      before: { sceneEntities: ['char_a', 'char_b'], currentLocationId: 'loc_a' },
      after: { sceneEntities: ['char_a', 'char_b'], currentLocationId: 'loc_b' },
    })
    expect(actions).toHaveLength(2)
    expect(
      actions.every(
        (a) => (a.payload as { currentLocationId?: string }).currentLocationId === 'loc_b',
      ),
    ).toBe(true)
  })

  // A null previous location yields a delta the handler rejects (piggyback creates
  // no rows), so the emission is skipped rather than written and dropped.
  it('skips the lastSeenAt write when the previous location is unknown', () => {
    const actions = sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities,
      previous: {
        entryId: 'ent_0',
        sceneEntities: ['char_b'],
        currentLocationId: null,
        worldTime: 0,
      },
      before: { sceneEntities: ['char_b'], currentLocationId: null },
      after: { sceneEntities: [], currentLocationId: null },
    })
    expect(payloadsFor(actions, 'char_b')).toEqual([])
  })

  // sceneEntities carries items as well as characters, but only characters have
  // current_location_id / lastSeenAt on their state.
  it('ignores non-character members of the scene', () => {
    const actions = sceneTrackingActions({
      branchId,
      source: 'user_edit',
      entities,
      previous: { entryId: 'ent_0', sceneEntities: [], currentLocationId: null, worldTime: 0 },
      before: { sceneEntities: [], currentLocationId: null },
      after: { sceneEntities: ['item_a'], currentLocationId: 'loc_a' },
    })
    expect(actions).toEqual([])
  })
})
