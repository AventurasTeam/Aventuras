import { describe, expect, it } from 'vitest'

import { parsePlotSelection } from './plot-selection'

describe('parsePlotSelection', () => {
  it('needs a Plot kind and an id; carries tab when present', () => {
    expect(parsePlotSelection({ kind: 'thread', id: 't_1' })).toEqual({ kind: 'thread', id: 't_1' })
    expect(parsePlotSelection({ kind: 'happening', id: 'h_1', tab: 'awareness' })).toEqual({
      kind: 'happening',
      id: 'h_1',
      tab: 'awareness',
    })
    expect(parsePlotSelection({ kind: 'character', id: 'c_1' })).toBeNull()
    expect(parsePlotSelection({ kind: 'thread' })).toBeNull()
    expect(parsePlotSelection({ kind: ['thread', 'happening'], id: 't_1' })).toBeNull()
  })
})
