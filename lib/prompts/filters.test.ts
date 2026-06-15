import { describe, expect, it } from 'vitest'

import { byKind, active, proseJoin, jsonFilter } from './filters'

describe('prompt filters', () => {
  const entities = [
    { id: 'char_1', kind: 'character', status: 'active', name: 'Aria' },
    { id: 'char_2', kind: 'character', status: 'retired', name: 'Bex' },
    { id: 'loc_1', kind: 'location', status: 'active', name: 'The Keep' },
  ]

  it('byKind filters by the kind discriminator', () => {
    expect(byKind(entities, 'character').map((e) => e.id)).toEqual(['char_1', 'char_2'])
    expect(byKind(entities, 'location').map((e) => e.id)).toEqual(['loc_1'])
  })

  it('byKind returns [] for non-array input', () => {
    expect(byKind(undefined as unknown as unknown[], 'character')).toEqual([])
  })

  it('active filters to status active', () => {
    expect(active(entities).map((e) => e.id)).toEqual(['char_1', 'loc_1'])
  })

  it('proseJoin renders an Oxford-comma list', () => {
    expect(proseJoin([])).toBe('')
    expect(proseJoin(['Aria'])).toBe('Aria')
    expect(proseJoin(['Aria', 'Bex'])).toBe('Aria and Bex')
    expect(proseJoin(['Aria', 'Bex', 'Cy'])).toBe('Aria, Bex, and Cy')
  })

  it('jsonFilter stringifies', () => {
    expect(jsonFilter({ a: 1 })).toBe('{"a":1}')
  })
})
