import { describe, expect, it } from 'vitest'

import { happeningLinkTab, parsePlotSelection, threadLinkTab } from './plot-selection'

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

  it("drops a tab the kind doesn't have", () => {
    expect(parsePlotSelection({ kind: 'thread', id: 't_1', tab: 'awareness' })).toEqual({
      kind: 'thread',
      id: 't_1',
    })
    expect(parsePlotSelection({ kind: 'happening', id: 'h_1', tab: 'connections' })).toEqual({
      kind: 'happening',
      id: 'h_1',
    })
    expect(parsePlotSelection({ kind: 'thread', id: 't_1', tab: 'history' })).toEqual({
      kind: 'thread',
      id: 't_1',
      tab: 'history',
    })
  })
})

describe('link tabs', () => {
  const link = { kind: 'happening' as const, id: 'h_1', tab: 'awareness' as const }

  it("hands the tab to the linked row's pane only", () => {
    expect(happeningLinkTab(link, 'h_1')).toBe('awareness')
    expect(happeningLinkTab(link, 'h_2')).toBeUndefined()
    expect(threadLinkTab(link, 'h_1')).toBeUndefined()
  })

  it('has nothing to hand without a link or a tab', () => {
    expect(happeningLinkTab(null, 'h_1')).toBeUndefined()
    expect(happeningLinkTab({ kind: 'happening', id: 'h_1' }, 'h_1')).toBeUndefined()
  })
})
