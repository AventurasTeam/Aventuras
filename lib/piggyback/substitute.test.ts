import { describe, expect, it } from 'vitest'

import { IdBiMap } from '@/lib/ids'

import { substitutePiggybackIds } from './substitute'

function mapWith(uuids: string[]): IdBiMap {
  const idMap = new IdBiMap()
  for (const uuid of uuids) idMap.allocate(uuid)
  return idMap
}

describe('substitutePiggybackIds', () => {
  it('resolves placeholders back to real ids across every id-bearing field', () => {
    const idMap = mapWith([
      'char_00000000-0000-4000-8000-000000000001',
      'char_00000000-0000-4000-8000-000000000002',
      'loc_00000000-0000-4000-8000-000000000003',
      'item_00000000-0000-4000-8000-000000000004',
    ])
    // Allocation order above pins c1/c2/l1/i1 per IdBiMap's per-kind counters.
    const result = substitutePiggybackIds(
      {
        sceneEntities: ['c1', 'c2'],
        currentLocation: 'l1',
        visualChanges: [{ id: 'c2', type: 'attire', text: 'a cloak' }],
        transfers: {
          items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c2' }],
          stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
        },
      },
      idMap,
    )

    expect(result.failures).toEqual([])
    expect(result.block).toEqual({
      sceneEntities: [
        'char_00000000-0000-4000-8000-000000000001',
        'char_00000000-0000-4000-8000-000000000002',
      ],
      currentLocation: 'loc_00000000-0000-4000-8000-000000000003',
      visualChanges: [
        {
          id: 'char_00000000-0000-4000-8000-000000000002',
          type: 'attire',
          text: 'a cloak',
        },
      ],
      transfers: {
        items: [
          {
            id: 'item_00000000-0000-4000-8000-000000000004',
            slot: 'inventory',
            to: 'char_00000000-0000-4000-8000-000000000001',
            from: 'char_00000000-0000-4000-8000-000000000002',
          },
        ],
        stackables: [{ key: 'gold', amount: 5, to: 'char_00000000-0000-4000-8000-000000000001' }],
      },
    })
  })

  it('leaves worldTimeDelta and summary untouched (no ids to resolve)', () => {
    const idMap = new IdBiMap()
    const result = substitutePiggybackIds({ worldTimeDelta: 30, summary: 'A quiet turn.' }, idMap)
    expect(result.failures).toEqual([])
    expect(result.block).toEqual({ worldTimeDelta: 30, summary: 'A quiet turn.' })
  })

  it('drops sceneEntities and records a failure when it contains an unresolvable but placeholder-shaped id', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds({ sceneEntities: ['c1', 'c99'] }, idMap)
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'sceneEntities', detail: expect.any(String) }])
  })

  it('one field failing does not block a sibling field from resolving', () => {
    const idMap = mapWith(['loc_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds({ sceneEntities: ['c99'], currentLocation: 'l1' }, idMap)
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.block.currentLocation).toBe('loc_00000000-0000-4000-8000-000000000001')
    expect(result.failures).toEqual([{ field: 'sceneEntities', detail: expect.any(String) }])
  })

  it('drops sceneEntities and records a failure for non-placeholder-shaped garbage', () => {
    const idMap = new IdBiMap()
    const result = substitutePiggybackIds({ sceneEntities: ['not-a-placeholder-!!'] }, idMap)
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'sceneEntities', detail: expect.any(String) }])
  })

  it('resolves a bracket-wrapped placeholder the same as the bare form', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds({ sceneEntities: ['[c1]'] }, idMap)
    expect(result.failures).toEqual([])
    expect(result.block.sceneEntities).toEqual(['char_00000000-0000-4000-8000-000000000001'])
  })

  it('drops currentLocation and records a failure when the bracketed form has no match', () => {
    const idMap = new IdBiMap()
    const result = substitutePiggybackIds({ currentLocation: '[l9]' }, idMap)
    expect(result.block.currentLocation).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'currentLocation', detail: expect.any(String) }])
  })

  it('drops transfers when a nested item id is an unresolvable placeholder', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds(
      { transfers: { items: [{ id: 'i9', slot: 'inventory', to: 'c1' }], stackables: [] } },
      idMap,
    )
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'transfers', detail: expect.any(String) }])
  })
})
