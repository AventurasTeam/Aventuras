import { describe, expect, it } from 'vitest'

import { placeNewLocation, settlingOrder, TOP_LEVEL, type SettlingPlace } from './new-place-order'

const order = (creates: { handle: string; parent?: string }[], ids: readonly string[] = []) =>
  settlingOrder(creates, (id) => ids.includes(id)).order.map(
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

  it('settles in list order where parents allow: a create waits for its own parent alone', () => {
    expect(
      order(
        [{ handle: 'a', parent: 'p' }, { handle: 'p', parent: 'loc_port' }, { handle: 'b' }],
        ['loc_port'],
      ),
    ).toEqual(['p', 'a', 'b'])
  })

  it('settles a top-level create at once, as one that names no parent', () => {
    expect(
      order([{ handle: 'b', parent: 'a' }, { handle: 'a', parent: TOP_LEVEL }, { handle: 'c' }]),
    ).toEqual(['a', 'b', 'c'])
  })

  // Its parent never resolves, so it waits for nothing and keeps its place in the list.
  it('leaves unresolved, in its own place, a create whose parent is no handle or location', () => {
    expect(order([{ handle: 'a', parent: 'loc_gone' }, { handle: 'b' }])).toEqual(['a!', 'b'])
  })

  it('leaves both sides of a handle cycle unresolved in their own places', () => {
    expect(
      order([
        { handle: 'a', parent: 'b' },
        { handle: 'c', parent: 'a' },
        { handle: 'd' },
        { handle: 'b', parent: 'a' },
      ]),
    ).toEqual(['a!', 'c', 'd', 'b!'])
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
    resolve: (parent: string) =>
      parent.startsWith('new:') ? parent.replace('new:', 'loc_') : parent,
    statusOf: (id: string) => (id === 'loc_ruin' ? ('retired' as const) : ('active' as const)),
    parentOf: (id: string) => (id === 'loc_a' ? 'loc_b' : id === 'loc_b' ? 'loc_a' : null),
  }
  const settled = (parent?: string): SettlingPlace<{ handle: string; parent?: string }> => ({
    emission: { handle: 'new:inn', ...(parent === undefined ? {} : { parent }) },
    parentUnresolved: false,
  })

  it('keeps a live parent, a declared handle under the row it resolved to', () => {
    expect(placeNewLocation({ ...base, place: settled('loc_town') })).toEqual({
      kind: 'kept',
      placement: { kind: 'under', parentId: 'loc_town' },
    })
    expect(placeNewLocation({ ...base, place: settled('new:town') })).toEqual({
      kind: 'kept',
      placement: { kind: 'under', parentId: 'loc_town' },
    })
  })

  // piggyback.md → Parent: top makes the place top-level, and no parent leaves it unplaced.
  it("makes a create naming the per-turn tag's top token top-level", () => {
    expect(placeNewLocation({ ...base, place: settled('top') })).toEqual({
      kind: 'kept',
      placement: { kind: 'top' },
    })
  })

  it('keeps a create that names no parent unplaced, as no drop', () => {
    expect(placeNewLocation({ ...base, place: settled() })).toEqual({
      kind: 'kept',
      placement: { kind: 'unplaced' },
    })
  })

  it.each([
    [
      'unresolved',
      { emission: { handle: 'new:inn', parent: 'loc_gone' }, parentUnresolved: true } as const,
    ],
    ['retired', settled('loc_ruin')],
    ['retired', settled('new:ruin')],
    ['chain-broken', settled('loc_a')],
  ])('drops a %s parent, naming it as declared: the place lands unplaced', (cause, place) => {
    expect(placeNewLocation({ ...base, place })).toEqual({
      kind: 'dropped',
      cause,
      parent: place.emission.parent,
    })
  })
})
