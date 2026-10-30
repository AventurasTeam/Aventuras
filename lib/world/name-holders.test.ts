import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import { nameHolders } from './name-holders'
import type { PlacePlacement } from './placement'

const row = (id: string, name: string, createdAt = 1) =>
  ({ id, name, createdAt }) as Pick<Entity, 'id' | 'name' | 'createdAt'>

const under = (parentId: string): PlacePlacement => ({ kind: 'under', parentId })
const TOP: PlacePlacement = { kind: 'top' }
const UNPLACED: PlacePlacement = { kind: 'unplaced' }

describe('nameHolders', () => {
  const character = { id: 'char_a', kind: 'character' } as const
  const place = { id: 'loc_a', kind: 'location' } as const

  it('finds another row of that name, case and spacing aside, and never the row itself', () => {
    const rows = [row('char_a', 'Kael'), row('char_b', 'KAEL  '), row('char_c', 'Kael Vale')]
    expect(nameHolders(character, 'kael', rows, () => TOP).map((r) => r.id)).toEqual(['char_b'])
  })

  it('takes the oldest first, then the lowest id', () => {
    const rows = [row('char_c', 'Kael', 3), row('char_e', 'Kael', 1), row('char_d', 'Kael', 1)]
    expect(nameHolders(character, 'Kael', rows, () => TOP).map((r) => r.id)).toEqual([
      'char_d',
      'char_e',
      'char_c',
    ])
  })

  it('leaves `rows` in its order', () => {
    const rows = [row('char_c', 'Kael', 3), row('char_b', 'Kael', 1)]
    nameHolders(character, 'Kael', rows, () => TOP)
    expect(rows.map((r) => r.id)).toEqual(['char_c', 'char_b'])
  })

  it('ignores placement for a row that is no place', () => {
    const rows = [row('char_b', 'Kael')]
    const placementAt = (id: string) => (id === 'char_b' ? under('x') : under('y'))
    expect(nameHolders(character, 'Kael', rows, placementAt)).toHaveLength(1)
  })

  it.each<[string, PlacePlacement, PlacePlacement, boolean]>([
    ['the same parent', under('p'), under('p'), true],
    ['another parent', under('p'), under('q'), false],
    ['the top level', TOP, TOP, true],
    ['a parent against the top level', under('p'), TOP, false],
    ['an unplaced row against a placed holder', UNPLACED, under('q'), true],
    ['a placed row against an unplaced holder', under('p'), UNPLACED, true],
    ['two unplaced places', UNPLACED, UNPLACED, true],
  ])('compares a place by %s', (_label, own, holder, holds) => {
    const placementAt = (id: string) => (id === 'loc_a' ? own : holder)
    const rows = [row('loc_b', 'Varn')]
    expect(nameHolders(place, 'Varn', rows, placementAt)).toHaveLength(holds ? 1 : 0)
  })
})
