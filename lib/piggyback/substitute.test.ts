import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'
import { IdBiMap } from '@/lib/ids'

import { substitutePiggybackIds } from './substitute'
import type { NormalizedStateBlock, ParsedStateBlock } from './types'

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
const FAIL = { entities: ROWS, wrongKind: 'fail' } as const

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
        transfers: {
          items: [{ id: 'i1', slot: 'inventory', to: 'c1', from: 'c2' }],
          stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
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
      transfers: {
        items: [
          {
            id: 'item_00000000-0000-4000-8000-000000000004',
            slot: 'inventory',
            to: 'char_00000000-0000-4000-8000-000000000001',
            from: 'char_00000000-0000-4000-8000-000000000002',
          },
        ],
        stackables: [{ key: 'gold', amount: 5, to: 'char_00000000-0000-4000-8000-000000000001' }],
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
        transfers: { items: [{ id: 'i9', slot: 'inventory', to: 'c1' }], stackables: [] },
      }),
      idMap,
      FAIL,
    )
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([{ field: 'transfers', detail: expect.any(String) }])
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
        transfers: { items: [{ id: 'new:key', slot: 'inventory', to: 'c1' }], stackables: [] },
      }),
      idMap(),
      FAIL,
    )
    expect(result.failures).toEqual([])
    expect(result.block.sceneEntities).toEqual([CHAR, 'new:key'])
    expect(result.block.currentLocation).toBe('new:docks')
    expect(result.block.transfers?.items).toEqual([{ id: 'new:key', slot: 'inventory', to: CHAR }])
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
      { transfers: { items: [{ id: 'new:ghost', slot: 'inventory', to: 'c1' }], stackables: [] } },
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

  it('refuses a declared handle as a transfer holder or a visual change target', () => {
    const result = substitutePiggybackIds(
      assumeNormalized({
        newItems: [key],
        visualChanges: [{ id: 'new:key', type: 'attire', text: 'rusted' }],
        transfers: { items: [{ id: 'i1', slot: 'inventory', to: 'new:key' }], stackables: [] },
      }),
      idMap(),
      FAIL,
    )
    expect(result.block.visualChanges).toBeUndefined()
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['visualChanges', 'transfers'])
  })

  it.each([
    [
      'an item transfer from',
      { items: [{ id: 'i1', slot: 'inventory' as const, from: 'new:key' }] },
    ],
    ['a stackable to', { stackables: [{ key: 'gold', amount: 1, to: 'new:key' }] }],
    ['a stackable from', { stackables: [{ key: 'gold', amount: 1, from: 'new:key' }] }],
  ])('refuses a declared handle in %s', (_label, partial) => {
    const result = substitutePiggybackIds(
      assumeNormalized({ newItems: [key], transfers: { items: [], stackables: [], ...partial } }),
      idMap(),
      FAIL,
    )
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['transfers'])
  })

  it('substitutes a create parent leniently', () => {
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
  const opts = (wrongKind: 'fail' | 'drop') => ({ entities: ROWS, wrongKind })
  const docks = { handle: 'new:docks', name: 'the Docks', description: 'a pier', parent: 'l1' }
  const key = { handle: 'new:key', name: 'rusted key', description: 'an iron key' }
  const toHero = (id: string) => ({ id, slot: 'inventory' as const, to: 'c1' })

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
        items: [toHero('new:key'), toHero(ref), toHero('i1')],
        stackables: [{ key: 'gold', amount: 5, to: 'c1' }],
      },
    })

  it.each(notItems)('fails transfers on %s as the item, like an unknown id', (_label, ref) => {
    const result = substitutePiggybackIds(transferring(ref), idMap(), opts('fail'))
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures).toEqual([
      { field: 'transfers', detail: expect.stringContaining('not an item') },
    ])
    expect(result.droppedTransfers).toEqual([])
  })

  it.each(notItems)(
    'drops only the transfer naming %s, keeping the rest of the field',
    (_label, ref, id, kind) => {
      const result = substitutePiggybackIds(transferring(ref), idMap(), opts('drop'))
      expect(result.failures).toEqual([])
      expect(result.block.transfers).toEqual({
        items: [
          { id: 'new:key', slot: 'inventory', to: CHAR },
          { id: ITEM, slot: 'inventory', to: CHAR },
        ],
        stackables: [{ key: 'gold', amount: 5, to: CHAR }],
      })
      expect(result.droppedTransfers).toEqual([{ id, kind }])
    },
  )

  it('still fails the whole field on an unknown id beside a dropped one', () => {
    const block = transferring('l1')
    block.transfers?.items.push(toHero('i9'))
    const result = substitutePiggybackIds(block, idMap(), opts('drop'))
    expect(result.block.transfers).toBeUndefined()
    expect(result.failures.map((f) => f.field)).toEqual(['transfers'])
    expect(result.droppedTransfers).toEqual([])
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
    (wrongKind) => {
      const result = substitutePiggybackIds(
        assumeNormalized({ currentLocation: 'i1' }),
        idMap(),
        opts(wrongKind),
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
