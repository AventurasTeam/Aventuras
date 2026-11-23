import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import { entitiesStore } from './entities'

function ent(id: string, kind: Entity['kind'], name: string, branchId = 'br_1'): Entity {
  return {
    id,
    branchId,
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    nameCollisionPartnerId: null,
    nameCollisionReason: null,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('entitiesStore', () => {
  it('hydrates and reads by id and by kind', () => {
    entitiesStore.__reset()
    entitiesStore.hydrate('br_1', [
      ent('char_1', 'character', 'Kael'),
      ent('loc_1', 'location', 'Tavern'),
    ])
    expect(entitiesStore.getById('char_1')?.name).toBe('Kael')
    expect(entitiesStore.getByKind('br_1', 'character').map((e) => e.id)).toEqual(['char_1'])
    expect(entitiesStore.getByKind('br_1', 'location').map((e) => e.id)).toEqual(['loc_1'])
  })

  it('reads nothing by kind for a branch it does not hold', () => {
    entitiesStore.__reset()
    expect(entitiesStore.getByKind(null, 'character')).toEqual([])
    entitiesStore.hydrate('br_1', [ent('char_1', 'character', 'Kael')])
    expect(entitiesStore.getByKind('br_2', 'character')).toEqual([])
    expect(entitiesStore.getByKind(null, 'character')).toEqual([])

    entitiesStore.hydrate('br_2', [ent('char_1', 'character', 'Kael on two', 'br_2')])
    expect(entitiesStore.getByKind('br_1', 'character')).toEqual([])
    expect(entitiesStore.getByKind('br_2', 'character').map((e) => e.name)).toEqual(['Kael on two'])
  })

  it('no-ops a patch for a non-held branch', () => {
    entitiesStore.__reset()
    entitiesStore.hydrate('br_1', [])
    entitiesStore.patch('br_2', {
      op: 'create',
      id: 'char_9',
      row: ent('char_9', 'character', 'Ghost'),
    })
    expect(entitiesStore.getById('char_9')).toBeUndefined()
  })
})
