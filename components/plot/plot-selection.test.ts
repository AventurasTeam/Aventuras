import { describe, expect, it } from 'vitest'

import { deepLinkTab, parsePlotSelection } from './plot-selection'

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

describe('deepLinkTab', () => {
  const link = { kind: 'happening' as const, id: 'h_1', tab: 'awareness' }

  it("hands the tab to the linked row's pane only", () => {
    expect(deepLinkTab(link, 'happening', 'h_1')).toBe('awareness')
    expect(deepLinkTab(link, 'happening', 'h_2')).toBeUndefined()
    expect(deepLinkTab(link, 'thread', 'h_1')).toBeUndefined()
  })

  it('has nothing to hand without a link or a tab', () => {
    expect(deepLinkTab(null, 'happening', 'h_1')).toBeUndefined()
    expect(deepLinkTab({ kind: 'happening', id: 'h_1' }, 'happening', 'h_1')).toBeUndefined()
  })
})
