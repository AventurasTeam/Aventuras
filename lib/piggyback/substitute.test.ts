import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { IdBiMap } from '@/lib/ids'

import { substitutePiggybackIds } from './substitute'
import type { NormalizedStateBlock, ParsedStateBlock, ParsedTransfers } from './types'

// Cast, not normalized: these blocks are built already holding normalized creates.
const assumeNormalized = (block: ParsedStateBlock) => block as NormalizedStateBlock

function mapWith(uuids: string[]): IdBiMap {
  const idMap = new IdBiMap()
  for (const uuid of uuids) idMap.allocate(uuid)
  return idMap
}

// Every entity id the cases allocate, so the kind check reads them as stored rows.
const ROWS: Pick<Entity, 'id' | 'kind'>[] = [
  { id: 'char_00000000-0000-4000-8000-000000000001', kind: 'character' },
  { id: 'char_00000000-0000-4000-8000-000000000002', kind: 'character' },
  { id: 'item_00000000-0000-4000-8000-000000000003', kind: 'item' },
  { id: 'item_00000000-0000-4000-8000-000000000004', kind: 'item' },
  { id: 'loc_00000000-0000-4000-8000-000000000001', kind: 'location' },
  { id: 'loc_00000000-0000-4000-8000-000000000003', kind: 'location' },
]
const FAIL = { entities: ROWS, badRef: 'fail' } as const

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
      assumeNormalized({
        sceneEntities: ['c1', 'c2'],
        currentLocation: 'l1',
        visualChanges: [{ id: 'c2', type: 'attire', text: 'a cloak' }],
        conditions: [{ id: 'l1', text: 'flooded to the knee' }],
        transfers: {
          items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c2', seq: 0 }],
          stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
          drops: [{ id: 'i1', from: 'c1', seq: 1 }],
        },
      }),
      idMap,
      FAIL,
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
      conditions: [{ id: 'loc_00000000-0000-4000-8000-000000000003', text: 'flooded to the knee' }],
      transfers: {
        items: [
          {
            id: 'item_00000000-0000-4000-8000-000000000004',
            slot: 'inventory',
            to: 'char_00000000-0000-4000-8000-000000000001',
            from: 'char_00000000-0000-4000-8000-000000000002',
            seq: 0,
          },
        ],
        stackables: [{ key: 'gold', amount: 5, to: 'char_00000000-0000-4000-8000-000000000001' }],
        drops: [
          {
            id: 'item_00000000-0000-4000-8000-000000000004',
            from: 'char_00000000-0000-4000-8000-000000000001',
            seq: 1,
          },
        ],
      },
    })
  })

  it('leaves worldTimeDelta and summary untouched (no ids to resolve)', () => {
    const idMap = new IdBiMap()
    const result = substitutePiggybackIds(
      assumeNormalized({ worldTimeDelta: 30, summary: 'A quiet turn.' }),
      idMap,
      FAIL,
    )
    expect(result.failures).toEqual([])
    expect(result.block).toEqual({ worldTimeDelta: 30, summary: 'A quiet turn.' })
  })

  it('drops sceneEntities and records a failure when it contains an unresolvable but placeholder-shaped id', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds(
      assumeNormalized({ sceneEntities: ['c1', 'c99'] }),
      idMap,
      FAIL,
    )
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'sceneEntities', detail: expect.any(String) }])
  })

  it('one field failing does not block a sibling field from resolving', () => {
    const idMap = mapWith(['loc_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds(
      assumeNormalized({ sceneEntities: ['c99'], currentLocation: 'l1' }),
      idMap,
      FAIL,
    )
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.block.currentLocation).toBe('loc_00000000-0000-4000-8000-000000000001')
    expect(result.failures).toEqual([{ field: 'sceneEntities', detail: expect.any(String) }])
  })

  it('drops sceneEntities and records a failure for non-placeholder-shaped garbage', () => {
    const idMap = new IdBiMap()
    const result = substitutePiggybackIds(
      assumeNormalized({ sceneEntities: ['not-a-placeholder-!!'] }),
      idMap,
      FAIL,
    )
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'sceneEntities', detail: expect.any(String) }])
  })

  it('resolves a bracket-wrapped placeholder the same as the bare form', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds(
      assumeNormalized({ sceneEntities: ['[c1]'] }),
      idMap,
      FAIL,
    )
    expect(result.failures).toEqual([])
    expect(result.block.sceneEntities).toEqual(['char_00000000-0000-4000-8000-000000000001'])
  })

  it('drops currentLocation and records a failure when the bracketed form has no match', () => {
    const idMap = new IdBiMap()
    const result = substitutePiggybackIds(
      assumeNormalized({ currentLocation: '[l9]' }),
      idMap,
      FAIL,
    )
    expect(result.block.currentLocation).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'currentLocation', detail: expect.any(String) }])
  })

  it('drops transfers when a nested item id is an unresolvable placeholder', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds(
      assumeNormalized({
        transfers: {
          items: [{ id: 'i9', slot: 'inventory', to: 'c1', seq: 0 }],
          stackables: [],
          drops: [],
        },
      }),
      idMap,
      FAIL,
    )
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'transfers', detail: expect.any(String) }])
  })

  it('fails conditions on an unresolvable id, leaving the other fields', () => {
    const idMap = mapWith(['char_00000000-0000-4000-8000-000000000001'])
    const result = substitutePiggybackIds(
      assumeNormalized({ sceneEntities: ['c1'], conditions: [{ id: 'l9', text: 'burned' }] }),
      idMap,
      FAIL,
    )
    expect(result.block.conditions).toBeUndefined()
    expect(result.block.sceneEntities).toEqual(['char_00000000-0000-4000-8000-000000000001'])
    expect(result.failures).toEqual([{ field: 'conditions', detail: expect.any(String) }])
  })
})

describe('substitutePiggybackIds with creates', () => {
  const LOC = 'loc_00000000-0000-4000-8000-000000000001'
  const CHAR = 'char_00000000-0000-4000-8000-000000000002'
  const ITEM = 'item_00000000-0000-4000-8000-000000000003'
  // Allocation order pins l1 / c1 / i1.
  const idMap = () => mapWith([LOC, CHAR, ITEM])
  const docks = { handle: 'new:docks', name: 'the Docks', description: 'a pier', parent: 'l1' }
  const key = { handle: 'new:key', name: 'rusted key', description: 'an iron key' }

  it('passes a declared handle through in the scene, the location and a transfer item', () => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        newLocations: [docks],
        newItems: [key],
        sceneEntities: ['c1', 'new:key'],
        currentLocation: 'new:docks',
        transfers: {
          items: [{ id: 'new:key', slot: 'inventory', to: 'c1', seq: 0 }],
          stackables: [],
          drops: [{ id: 'new:key', from: 'c1', seq: 1 }],
        },
      }),
      idMap(),
      FAIL,
    )
    expect(result.failures).toEqual([])
    expect(result.block.sceneEntities).toEqual([CHAR, 'new:key'])
    expect(result.block.currentLocation).toBe('new:docks')
    expect(result.block.transfers?.items).toEqual([
      { id: 'new:key', slot: 'inventory', to: CHAR, seq: 0 },
    ])
    expect(result.block.transfers?.drops).toEqual([{ id: 'new:key', from: CHAR, seq: 1 }])
  })

  it('unwraps a bracketed handle like a bracketed placeholder', () => {
    const result = substitutePiggybackIds(
      assumeNormalized({ newLocations: [docks], currentLocation: '[new:docks]' }),
      idMap(),
      FAIL,
    )
    expect(result.failures).toEqual([])
    expect(result.block.currentLocation).toBe('new:docks')
  })

  const undeclared: [keyof ParsedStateBlock, ParsedStateBlock][] = [
    ['sceneEntities', { sceneEntities: ['c1', 'new:ghost'] }],
    ['currentLocation', { currentLocation: 'new:ghost' }],
    [
      'transfers',
      {
        transfers: {
          items: [{ id: 'new:ghost', slot: 'inventory', to: 'c1', seq: 0 }],
          stackables: [],
          drops: [],
        },
      },
    ],
  ]
  it.each(undeclared)('fails %s on a handle no create declares', (field, refs) => {
    const result = substitutePiggybackIds(
      assumeNormalized({ newItems: [key], ...refs }),
      idMap(),
      FAIL,
    )
    expect(result.block[field]).toBeUndefined()
    expect(result.failures).toEqual([{ field, detail: expect.any(String) }])
  })

  it('fails transfers on a drop naming a handle no create declares', () => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        newItems: [key],
        transfers: { items: [], stackables: [], drops: [{ id: 'new:ghost', seq: 0 }] },
      }),
      idMap(),
      FAIL,
    )
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'transfers', detail: expect.any(String) }])
  })

  it('refuses a declared handle as a transfer holder or a visual change target', () => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        newItems: [key],
        visualChanges: [{ id: 'new:key', type: 'attire', text: 'rusted' }],
        conditions: [{ id: 'new:key', text: 'rusted' }],
        transfers: {
          items: [{ id: 'i1', slot: 'inventory', to: 'new:key', seq: 0 }],
          stackables: [],
          drops: [],
        },
      }),
      idMap(),
      FAIL,
    )
    expect(result.block.visualChanges).toBeUndefined()
    expect(result.block.conditions).toBeUndefined()
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual([
      'visualChanges',
      'conditions',
      'transfers',
    ])
  })

  it.each([
    [
      'an item transfer from',
      { items: [{ id: 'i1', slot: 'inventory' as const, from: 'new:key', seq: 0 }] },
    ],
    ['a stackable to', { stackables: [{ key: 'gold', amount: 1, to: 'new:key' }] }],
    ['a stackable from', { stackables: [{ key: 'gold', amount: 1, from: 'new:key' }] }],
  ])('refuses a declared handle in %s', (_label, partial) => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        newItems: [key],
        transfers: { items: [], stackables: [], drops: [], ...partial },
      }),
      idMap(),
      FAIL,
    )
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['transfers'])
  })

  // piggyback.md → Parent: `top`, bracketed or not and in any case, is the top-level sentinel.
  it('substitutes a create parent leniently, reading top as the top level', () => {
    const create = (handle: string, parent?: string) => ({
      handle,
      name: handle,
      description: '',
      ...(parent !== undefined ? { parent } : {}),
    })
    const result = substitutePiggybackIds(
      assumeNormalized({
        newLocations: [
          create('new:a', 'l1'),
          create('new:b', '[l1]'),
          create('new:c', 'new:a'),
          create('new:d', '[new:a]'),
          create('new:e', 'l9'),
          create('new:g', '[l9]'),
          create('new:f'),
          create('new:h', 'top'),
          create('new:i', '[top]'),
          create('new:j', 'Top'),
        ],
      }),
      idMap(),
      FAIL,
    )
    expect(result.failures).toEqual([])
    expect(result.block.newLocations?.map((c) => c.parent)).toEqual([
      LOC,
      LOC,
      'new:a',
      'new:a',
      'l9',
      '[l9]',
      undefined,
      'top',
      'top',
      'top',
    ])
  })

  it('leaves names, descriptions and the item list as emitted, and the input untouched', () => {
    // A name or description that reads like a placeholder is text, never a ref.
    const placeholderish = { handle: 'new:c', name: 'c1', description: 'l1', parent: 'l1' }
    const block: ParsedStateBlock = { newLocations: [placeholderish], newItems: [key] }
    const result = substitutePiggybackIds(assumeNormalized(block), idMap(), FAIL)
    expect(result.block.newLocations).toEqual([{ ...placeholderish, parent: LOC }])
    expect(result.block.newItems).toEqual([key])
    expect(block.newLocations?.[0]?.parent).toBe('l1')
  })
})

describe('substitutePiggybackIds — kinds', () => {
  const LOC = 'loc_00000000-0000-4000-8000-000000000001'
  const CHAR = 'char_00000000-0000-4000-8000-000000000002'
  const ITEM = 'item_00000000-0000-4000-8000-000000000003'
  const LORE = 'lore_00000000-0000-4000-8000-000000000004'
  // Allocation order pins l1 / c1 / i1 / lo1; the lore entry has no entity row.
  const idMap = () => mapWith([LOC, CHAR, ITEM, LORE])
  const opts = (badRef: 'fail' | 'drop') => ({ entities: ROWS, badRef })
  const docks = { handle: 'new:docks', name: 'the Docks', description: 'a pier', parent: 'l1' }
  const key = { handle: 'new:key', name: 'rusted key', description: 'an iron key' }
  const toHero = (id: string, seq = 0) => ({ id, slot: 'inventory' as const, to: 'c1', seq })

  const notItems: [string, string, string, Entity['kind'] | null][] = [
    ["a new place's handle", 'new:docks', 'new:docks', 'location'],
    ["an existing place's id", 'l1', LOC, 'location'],
    ["a character's id", 'c1', CHAR, 'character'],
    ["a lore entry's id", 'lo1', LORE, null],
  ]
  const transferring = (ref: string) =>
    assumeNormalized({
      newLocations: [docks],
      newItems: [key],
      currentLocation: 'new:docks',
      transfers: {
        items: [toHero('new:key', 0), toHero(ref, 1), toHero('i1', 2)],
        stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
        drops: [],
      },
    })

  it.each(notItems)('fails transfers on %s as the item, like an unknown id', (_label, ref) => {
    const result = substitutePiggybackIds(transferring(ref), idMap(), opts('fail'))
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([
      { field: 'transfers', detail: expect.stringContaining('not an item') },
    ])
    expect(result.droppedRefs).toEqual([])
  })

  const keptTransfers = {
    items: [
      { id: 'new:key', slot: 'inventory', to: CHAR, seq: 0 },
      { id: ITEM, slot: 'inventory', to: CHAR, seq: 2 },
    ],
    stackables: [{ key: 'gold', amount: 5, to: CHAR }],
    drops: [],
  }

  it.each(notItems)(
    'drops only the transfer naming %s, keeping the rest of the field',
    (_l, ref) => {
      const result = substitutePiggybackIds(transferring(ref), idMap(), opts('drop'))
      expect(result.failures).toEqual([])
      expect(result.block.transfers).toEqual(keptTransfers)
      expect(result.droppedRefs).toEqual([
        {
          field: 'transfers',
          ref,
          reason: 'wrong-kind',
          detail: expect.stringContaining('not an item'),
        },
      ])
    },
  )

  // A drop's item is resolved and kind-checked as an item transfer's is.
  const dropping = (ref: string) =>
    assumeNormalized({
      newLocations: [docks],
      newItems: [key],
      currentLocation: 'new:docks',
      transfers: {
        items: [toHero('new:key', 0)],
        stackables: [],
        drops: [
          { id: ref, seq: 1 },
          { id: 'i1', from: 'c1', seq: 2 },
        ],
      },
    })

  it.each(notItems)('fails transfers on %s as a drop’s item when wrong refs fail', (_l, ref) => {
    const result = substitutePiggybackIds(dropping(ref), idMap(), opts('fail'))
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([
      { field: 'transfers', detail: expect.stringContaining('not an item') },
    ])
  })

  it.each(notItems)('drops only the drop naming %s when wrong refs drop', (_l, ref) => {
    const result = substitutePiggybackIds(dropping(ref), idMap(), opts('drop'))
    expect(result.failures).toEqual([])
    expect(result.block.transfers).toEqual({
      items: [{ id: 'new:key', slot: 'inventory', to: CHAR, seq: 0 }],
      stackables: [],
      drops: [{ id: ITEM, from: CHAR, seq: 2 }],
    })
    expect(result.droppedRefs).toEqual([
      {
        field: 'transfers',
        ref,
        reason: 'wrong-kind',
        detail: expect.stringContaining('not an item'),
      },
    ])
  })

  // One transfer's bad ref, beside a transfer list that otherwise resolves.
  const unresolved: [string, Partial<ParsedTransfers>, string][] = [
    ['an unknown item id', { items: [toHero('i9', 1)] }, 'i9'],
    ['an undeclared handle as the item', { items: [toHero('new:ghost', 1)] }, 'new:ghost'],
    ['an unknown holder', { items: [{ id: 'i1', slot: 'inventory', from: 'c9', seq: 1 }] }, 'c9'],
    ['an unknown dropped item', { drops: [{ id: 'i9', seq: 1 }] }, 'i9'],
    ['an unknown stackable holder', { stackables: [{ key: 'silver', amount: 2, to: 'c9' }] }, 'c9'],
    [
      'a handle as a stackable holder',
      { stackables: [{ key: 'silver', amount: 2, from: 'new:key' }] },
      'new:key',
    ],
  ]
  const withBad = (bad: Partial<ParsedTransfers>) => {
    const block = transferring('i1')
    block.transfers?.items.splice(1, 1)
    block.transfers?.items.push(...(bad.items ?? []))
    block.transfers?.stackables.push(...(bad.stackables ?? []))
    block.transfers?.drops.push(...(bad.drops ?? []))
    return block
  }
  it.each(unresolved)('drops only a transfer with %s when wrong refs drop', (_l, bad, ref) => {
    const result = substitutePiggybackIds(withBad(bad), idMap(), opts('drop'))
    expect(result.failures).toEqual([])
    expect(result.block.transfers).toEqual(keptTransfers)
    expect(result.droppedRefs).toEqual([
      { field: 'transfers', ref, reason: 'unknown', detail: expect.stringContaining(ref) },
    ])
  })

  it.each(unresolved)('fails the whole transfers field on %s when wrong refs fail', (_l, bad) => {
    const result = substitutePiggybackIds(withBad(bad), idMap(), opts('fail'))
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['transfers'])
    expect(result.droppedRefs).toEqual([])
  })

  it("fails currentLocation on a new item's handle", () => {
    const result = substitutePiggybackIds(
      assumeNormalized({ newItems: [key], currentLocation: 'new:key', sceneEntities: ['c1'] }),
      idMap(),
      opts('fail'),
    )
    expect(result.block.currentLocation).toBeUndefined()
    expect(result.block.sceneEntities).toEqual([CHAR])
    expect(result.failures).toEqual([
      { field: 'currentLocation', detail: expect.stringContaining('not a location') },
    ])
  })

  // The planner and apply.ts reject it as they reject an item's id there.
  it("passes a new item's handle through as currentLocation when wrong kinds drop", () => {
    const result = substitutePiggybackIds(
      assumeNormalized({ newItems: [key], currentLocation: 'new:key' }),
      idMap(),
      opts('drop'),
    )
    expect(result.failures).toEqual([])
    expect(result.block.currentLocation).toBe('new:key')
  })

  it.each(['fail', 'drop'] as const)(
    "leaves an existing item's id as currentLocation for apply.ts to reject (%s)",
    (badRef) => {
      const result = substitutePiggybackIds(
        assumeNormalized({ currentLocation: 'i1' }),
        idMap(),
        opts(badRef),
      )
      expect(result.failures).toEqual([])
      expect(result.block.currentLocation).toBe(ITEM)
    },
  )
})

describe('substitutePiggybackIds input', () => {
  it('takes only a normalized block, never a hand-built or an already substituted one', () => {
    const idMap = new IdBiMap()
    const substituted = substitutePiggybackIds(assumeNormalized({}), idMap, FAIL).block
    // @ts-expect-error a hand-built block has not passed normalizeCreates
    const raw = () => substitutePiggybackIds({ sceneEntities: ['c1'] }, idMap, FAIL)
    // @ts-expect-error its placeholders are already ids
    const twice = () => substitutePiggybackIds(substituted, idMap, FAIL)
    expect([raw, twice].map((call) => typeof call)).toEqual(['function', 'function'])
  })
})

// piggyback.md → A bad ref in the two writers: the fallback, which nothing rereads, drops a bad
// entry alone and records it; the narrative fold fails the field, which fires the fallback.
describe('substitutePiggybackIds — per-entry drops', () => {
  const LOC = 'loc_00000000-0000-4000-8000-000000000001'
  const CHAR = 'char_00000000-0000-4000-8000-000000000002'
  const ITEM = 'item_00000000-0000-4000-8000-000000000003'
  // Allocation order pins l1 / c1 / i1.
  const idMap = () => mapWith([LOC, CHAR, ITEM])
  const opts = (badRef: 'fail' | 'drop') => ({ entities: ROWS, badRef })
  const key = { handle: 'new:key', name: 'rusted key', description: 'an iron key' }
  const docks = { handle: 'new:docks', name: 'the Docks', description: 'a pier' }

  const sceneCases: [string, string, 'unknown' | 'wrong-kind'][] = [
    ['an unknown id', 'c9', 'unknown'],
    ['an undeclared handle', 'new:ghost', 'unknown'],
    ["a place's id", 'l1', 'wrong-kind'],
    ["a new place's handle", 'new:docks', 'wrong-kind'],
  ]

  it.each(sceneCases)('drops only the scene entry naming %s', (_l, ref, reason) => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        newLocations: [docks],
        newItems: [key],
        sceneEntities: ['c1', ref, 'i1', 'new:key'],
      }),
      idMap(),
      opts('drop'),
    )
    expect(result.block.sceneEntities).toEqual([CHAR, ITEM, 'new:key'])
    expect(result.failures).toEqual([])
    expect(result.droppedRefs).toEqual([
      { field: 'sceneEntities', ref, reason, detail: expect.stringContaining(ref) },
    ])
  })

  it.each(sceneCases)('fails the scene list on %s when wrong refs fail', (_l, ref) => {
    const result = substitutePiggybackIds(
      assumeNormalized({ newLocations: [docks], sceneEntities: ['c1', ref] }),
      idMap(),
      opts('fail'),
    )
    expect(result.block.sceneEntities).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['sceneEntities'])
    expect(result.droppedRefs).toEqual([])
  })

  it.each([
    ['an unknown id', 'c9', 'unknown'],
    ["a place's id", 'l1', 'wrong-kind'],
    ["an item's id", 'i1', 'wrong-kind'],
  ] as const)('drops only the visual change naming %s', (_l, ref, reason) => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        visualChanges: [
          { id: ref, type: 'attire', text: 'soaked' },
          { id: 'c1', type: 'hair', text: 'wet' },
        ],
      }),
      idMap(),
      opts('drop'),
    )
    expect(result.block.visualChanges).toEqual([{ id: CHAR, type: 'hair', text: 'wet' }])
    expect(result.droppedRefs).toEqual([
      { field: 'visualChanges', ref, reason, detail: expect.stringContaining(ref) },
    ])
  })

  it("fails visual changes on a place's id when wrong refs fail", () => {
    const result = substitutePiggybackIds(
      assumeNormalized({ visualChanges: [{ id: 'l1', type: 'attire', text: 'soaked' }] }),
      idMap(),
      opts('fail'),
    )
    expect(result.block.visualChanges).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['visualChanges'])
  })

  it('drops only the condition naming an unknown id', () => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        conditions: [
          { id: 'l9', text: 'flooded' },
          { id: 'i1', text: 'bent' },
        ],
      }),
      idMap(),
      opts('drop'),
    )
    expect(result.block.conditions).toEqual([{ id: ITEM, text: 'bent' }])
    expect(result.droppedRefs).toEqual([
      { field: 'conditions', ref: 'l9', reason: 'unknown', detail: expect.stringContaining('l9') },
    ])
  })

  it('records an unknown current location and leaves it omitted', () => {
    const block = assumeNormalized({ currentLocation: 'l9', sceneEntities: ['c1'] })
    const dropped = substitutePiggybackIds(block, idMap(), opts('drop'))
    expect(dropped.block).not.toHaveProperty('currentLocation')
    expect(dropped.block.sceneEntities).toEqual([CHAR])
    expect(dropped.failures).toEqual([])
    expect(dropped.droppedRefs).toEqual([
      {
        field: 'currentLocation',
        ref: 'l9',
        reason: 'unknown',
        detail: expect.stringContaining('l9'),
      },
    ])

    const failed = substitutePiggybackIds(block, idMap(), opts('fail'))
    expect(failed.block).not.toHaveProperty('currentLocation')
    expect(failed.failures.map((f) => f.field)).toEqual(['currentLocation'])
    expect(failed.droppedRefs).toEqual([])
  })
})

describe('substitutePiggybackIds — a drop names its holder for the record only', () => {
  const CHAR = 'char_00000000-0000-4000-8000-000000000002'
  const ITEM = 'item_00000000-0000-4000-8000-000000000003'
  const idMap = () => mapWith([CHAR, ITEM])

  it.each([
    ['an unknown id', 'c9', 'fail'],
    ['an unknown id', 'c9', 'drop'],
    ["a new item's handle", 'new:key', 'fail'],
    ["a new item's handle", 'new:key', 'drop'],
  ] as const)(
    'keeps a drop whose holder is %s, without the holder, when wrong refs %s',
    (_label, from, badRef) => {
      const result = substitutePiggybackIds(
        assumeNormalized({
          newItems: [{ handle: 'new:key', name: 'rusted key', description: 'an iron key' }],
          transfers: { items: [], stackables: [], drops: [{ id: 'i1', from, seq: 0 }] },
        }),
        idMap(),
        { entities: ROWS, badRef },
      )
      expect(result.block.transfers?.drops).toEqual([{ id: ITEM, seq: 0 }])
      expect(result.failures).toEqual([])
      expect(result.droppedRefs).toEqual([])
    },
  )
})
