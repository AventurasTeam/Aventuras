import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import {
  checkParentChain,
  PARENT_CHAIN_DEPTH_CAP,
  parentChainIds,
  parentOfLocations,
  type ParentOf,
} from './parent-chain'

function parents(map: Record<string, string | null>): ParentOf {
  return (id) => map[id] ?? null
}

describe('checkParentChain', () => {
  it('pins the cap at 100', () => {
    expect(PARENT_CHAIN_DEPTH_CAP).toBe(100)
  })

  it('refuses a location as its own parent', () => {
    expect(checkParentChain('loc_a', 'loc_a', parents({}))).toBe('cycle')
  })

  it('refuses A → B when B → A', () => {
    expect(checkParentChain('loc_a', 'loc_b', parents({ loc_b: 'loc_a' }))).toBe('cycle')
  })

  it('refuses a loop closed deep in the chain', () => {
    const map: Record<string, string | null> = {}
    for (let i = 1; i < 50; i++) map[`loc_${i}`] = `loc_${i + 1}`
    map.loc_50 = 'loc_0'
    expect(checkParentChain('loc_0', 'loc_1', parents(map))).toBe('cycle')
  })

  it('accepts a chain as long as the cap that never returns', () => {
    const map: Record<string, string | null> = {}
    for (let i = 1; i < 100; i++) map[`loc_${i}`] = `loc_${i + 1}`
    expect(checkParentChain('loc_0', 'loc_1', parents(map))).toBe('ok')
  })

  it('refuses a chain one longer than the cap that never returns', () => {
    const map: Record<string, string | null> = {}
    for (let i = 1; i <= 100; i++) map[`loc_${i}`] = `loc_${i + 1}`
    expect(checkParentChain('loc_0', 'loc_1', parents(map))).toBe('cap-hit')
  })

  it('stops at the cap on an existing loop that does not include the location', () => {
    expect(checkParentChain('loc_c', 'loc_x', parents({ loc_x: 'loc_y', loc_y: 'loc_x' }))).toBe(
      'cap-hit',
    )
  })

  it('accepts clearing the parent', () => {
    expect(checkParentChain('loc_a', null, parents({ loc_a: 'loc_a' }))).toBe('ok')
  })
})

describe('parentOfLocations', () => {
  it('reads location parents and ignores other kinds and unknown ids', () => {
    const rows = [
      { id: 'loc_shop', kind: 'location', state: { parent_location_id: 'loc_square' } },
      { id: 'char_kael', kind: 'character', state: { parent_location_id: 'loc_square' } },
    ] as unknown as Pick<Entity, 'id' | 'kind' | 'state'>[]
    const parentOf = parentOfLocations(rows)
    expect(parentOf('loc_shop')).toBe('loc_square')
    expect(parentOf('char_kael')).toBeNull()
    expect(parentOf('loc_unknown')).toBeNull()
  })
})

describe('parentChainIds', () => {
  it('lists ancestors nearest first', () => {
    expect(
      parentChainIds('loc_shop', parents({ loc_shop: 'loc_square', loc_square: 'loc_city' })),
    ).toEqual(['loc_square', 'loc_city'])
  })

  it('stops at a repeat instead of looping', () => {
    expect(
      parentChainIds('loc_a', parents({ loc_a: 'loc_b', loc_b: 'loc_c', loc_c: 'loc_b' })),
    ).toEqual(['loc_b', 'loc_c'])
  })

  it('stops before looping back to the location itself', () => {
    expect(parentChainIds('loc_a', parents({ loc_a: 'loc_b', loc_b: 'loc_a' }))).toEqual(['loc_b'])
  })
})
