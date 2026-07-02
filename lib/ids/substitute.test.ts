import { describe, expect, it } from 'vitest'

import { IdBiMap } from './bimap'
import { substituteIds } from './substitute'

const charA = 'char_0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const locA = 'loc_2a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const entryA = 'entry_9a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

describe('substituteIds', () => {
  it('swaps LLM-facing UUIDs and leaves everything else untouched', () => {
    const m = new IdBiMap()
    const input = {
      scene: [charA, locA],
      entryId: entryA,
      note: 'plain text',
      count: 3,
      missing: null,
    }
    expect(substituteIds(input, m)).toEqual({
      scene: ['c1', 'l1'],
      entryId: entryA,
      note: 'plain text',
      count: 3,
      missing: null,
    })
  })

  it('reuses one placeholder for a repeated uuid across the structure', () => {
    const m = new IdBiMap()
    expect(substituteIds([charA, { ref: charA }], m)).toEqual(['c1', { ref: 'c1' }])
  })

  it('passes a bare non-substitutable string through', () => {
    const m = new IdBiMap()
    expect(substituteIds(entryA, m)).toBe(entryA)
  })
})
