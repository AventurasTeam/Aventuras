import { describe, expect, it } from 'vitest'

import { placeNewLocation, settlingOrder } from './new-place-order'

const order = (creates: { handle: string; parent?: string }[], ids: readonly string[] = []) =>
  settlingOrder(creates, (id) => ids.includes(id)).map(
    ({ emission, parentUnresolved }) => `${emission.handle}${parentUnresolved ? '!' : ''}`,
  )

describe('settlingOrder', () => {
  it('settles a child listed before its parent after the parent', () => {
    expect(
      order(
        [
          { handle: 'b', parent: 'a' },
          { handle: 'a', parent: 'loc_1' },
        ],
        ['loc_1'],
      ),
    ).toEqual(['a', 'b'])
  })

  it('roots a create whose parent is neither a declared handle nor a location', () => {
    expect(order([{ handle: 'a', parent: 'loc_gone' }])).toEqual(['a!'])
  })

  it('roots both sides of a handle cycle, then settles what hangs off it', () => {
    expect(
      order([
        { handle: 'a', parent: 'b' },
        { handle: 'b', parent: 'a' },
        { handle: 'c', parent: 'a' },
      ]),
    ).toEqual(['a!', 'b!', 'c'])
  })

  it('waits for a declared handle even when its string is also a location id', () => {
    expect(order([{ handle: 'b', parent: 'loc_1' }, { handle: 'loc_1' }], ['loc_1'])).toEqual([
      'loc_1',
      'b',
    ])
  })
})

describe('placeNewLocation', () => {
  const base = {
    handle: 'new:inn',
    parentUnresolved: false,
    statusOf: (id: string) => (id === 'loc_ruin' ? ('retired' as const) : ('active' as const)),
    parentOf: (id: string) => (id === 'loc_a' ? 'loc_b' : id === 'loc_b' ? 'loc_a' : null),
  }

  it('keeps a live parent', () => {
    expect(placeNewLocation({ ...base, parentId: 'loc_town' })).toEqual({
      parentId: 'loc_town',
      dropped: null,
    })
  })

  it('leaves a create that names no parent at the root, unlogged', () => {
    expect(placeNewLocation({ ...base, parentId: null })).toEqual({ parentId: null, dropped: null })
  })

  it.each([
    ['unresolved', { parentId: null, parentUnresolved: true }],
    ['retired', { parentId: 'loc_ruin' }],
    ['chain-broken', { parentId: 'loc_a' }],
  ])('roots a %s parent', (cause, over) => {
    expect(placeNewLocation({ ...base, ...over })).toEqual({ parentId: null, dropped: cause })
  })
})
