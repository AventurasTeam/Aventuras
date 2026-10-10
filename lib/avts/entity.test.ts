import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'

import type { Entity, EntityKind } from '@/lib/db'

import {
  EntityImportSchema,
  entityExport,
  entityImportSchemaFor,
  type EntityImport,
} from './entity'

const EXPORTED_AT = new Date(Date.UTC(2026, 9, 7, 9, 30))

const ROW_BASE = {
  branchId: 'br_hero',
  description: null,
  status: 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 1,
  nameCollisionPartnerId: 'char_9b2e',
  nameCollisionReason: 'distinct',
  tags: [],
  keywords: [],
  priority: 0,
  embeddingStale: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
} satisfies Partial<Entity>

const KAEL: Entity = {
  ...ROW_BASE,
  id: 'char_0f3a',
  kind: 'character',
  name: 'Kael',
  description: 'A wandering swordsman.',
  tags: ['protagonist'],
  keywords: ['Kael', 'swordsman'],
  priority: 40,
  injectionMode: 'always',
  state: {
    visual: { hair: 'black, cropped', eyes: 'grey' },
    traits: ['stubborn'],
    drives: ['find his sister'],
    voice: 'clipped',
    current_location_id: 'loc_tavern',
    equipped_items: ['item_sword'],
    inventory: ['item_rope'],
    stackables: { coins: 12 },
    faction_id: 'fact_guild',
    lastSeenAt: { entryId: 'ent_9', locationId: 'loc_tavern', worldTime: 120 },
  },
}

const TAVERN: Entity = {
  ...ROW_BASE,
  id: 'loc_tavern',
  kind: 'location',
  name: 'The Rusty Anchor',
  state: { parent_location_id: 'loc_harbor', condition: 'smoky' },
}

const SWORD: Entity = {
  ...ROW_BASE,
  id: 'item_sword',
  kind: 'item',
  name: 'Ashen Blade',
  status: 'retired',
  retiredReason: 'Shattered at the gate.',
  state: { at_location_id: 'loc_tavern', condition: 'notched' },
}

const GUILD: Entity = {
  ...ROW_BASE,
  id: 'fact_guild',
  kind: 'faction',
  name: 'Lantern Guild',
  state: { standing: 'wary', agenda: ['control the harbor'] },
}

const MINIMAL = { name: 'Vael', status: 'staged', injectionMode: 'always' } as const

const DEFAULTS = {
  description: null,
  retiredReason: null,
  tags: [],
  keywords: [],
  priority: 0,
}

function payloadOf(row: Entity) {
  return JSON.parse(entityExport(row, EXPORTED_AT).contents).entity
}

function issuesOf(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value)
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
}

describe('entityExport', () => {
  it('writes a character as an aventuras-entity envelope of its portable fields only', () => {
    const file = entityExport(KAEL, EXPORTED_AT)
    const parsed = JSON.parse(file.contents)
    expect(parsed).toMatchObject({
      format: 'aventuras-entity',
      formatVersion: '1.0',
      exportedAt: '2026-10-07T09:30:00.000Z',
    })
    expect(parsed.entity).toEqual({
      kind: 'character',
      name: 'Kael',
      description: 'A wandering swordsman.',
      status: 'active',
      retiredReason: null,
      injectionMode: 'always',
      tags: ['protagonist'],
      keywords: ['Kael', 'swordsman'],
      priority: 40,
      state: {
        visual: { hair: 'black, cropped', eyes: 'grey' },
        traits: ['stubborn'],
        drives: ['find his sister'],
        voice: 'clipped',
        stackables: { coins: 12 },
      },
    })
    expect(file.fileName).toBe('character-kael.avts')
  })

  it.each([
    ['location', TAVERN, { condition: 'smoky' }, 'location-the-rusty-anchor.avts'],
    ['item', SWORD, { condition: 'notched' }, 'item-ashen-blade.avts'],
    [
      'faction',
      GUILD,
      { standing: 'wary', agenda: ['control the harbor'] },
      'faction-lantern-guild.avts',
    ],
  ])('writes a %s with its state refs removed', (_kind, row, state, fileName) => {
    const payload = payloadOf(row)
    expect(payload.kind).toBe(row.kind)
    expect(payload.state).toEqual(state)
    expect(entityExport(row, EXPORTED_AT).fileName).toBe(fileName)
  })

  it('writes a retired item with its status and reason', () => {
    expect(payloadOf(SWORD)).toEqual({
      kind: 'item',
      name: 'Ashen Blade',
      description: null,
      status: 'retired',
      retiredReason: 'Shattered at the gate.',
      injectionMode: 'auto',
      tags: [],
      keywords: [],
      priority: 0,
      state: { condition: 'notched' },
    })
  })

  it('writes the kind’s empty state for a row stored without one', () => {
    expect(payloadOf({ ...KAEL, state: null }).state).toEqual({
      visual: {},
      traits: [],
      drives: [],
    })
  })

  it.each([KAEL, TAVERN, SWORD, GUILD])(
    'leaves the collision flag, partner and reason out of a $kind export',
    (row) => {
      const payload = payloadOf(row)
      expect(payload).not.toHaveProperty('nameCollisionFlag')
      expect(payload).not.toHaveProperty('nameCollisionPartnerId')
      expect(payload).not.toHaveProperty('nameCollisionReason')
    },
  )

  it.each([KAEL, TAVERN, SWORD, GUILD])('re-imports a $kind export unchanged', (row) => {
    const payload = payloadOf(row)
    expect(EntityImportSchema.parse(payload)).toEqual(payload)
  })
})

describe('EntityImportSchema', () => {
  it.each([
    ['character', { visual: {}, traits: [], drives: [] }],
    ['location', {}],
    ['item', {}],
    ['faction', {}],
  ] as const)('reads a minimal %s with every default', (kind, state) => {
    expect(EntityImportSchema.parse({ kind, ...MINIMAL })).toEqual({
      kind,
      ...MINIMAL,
      ...DEFAULTS,
      state,
    })
  })

  it.each([{}, null])('fills a character state of %j', (state) => {
    expect(EntityImportSchema.parse({ kind: 'character', ...MINIMAL, state }).state).toEqual({
      visual: {},
      traits: [],
      drives: [],
    })
  })

  it('trims the name and reads blank optional text as null', () => {
    const entity = EntityImportSchema.parse({
      kind: 'faction',
      ...MINIMAL,
      name: '  Vael ',
      description: '   ',
      retiredReason: '',
    })
    expect(entity).toMatchObject({ name: 'Vael', description: null, retiredReason: null })
  })

  it('drops server-owned keys and every branch-local ref', () => {
    const entity = EntityImportSchema.parse({
      kind: 'character',
      ...MINIMAL,
      id: 'char_x',
      branchId: 'br_x',
      embeddingStale: 0,
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_y',
      nameCollisionReason: 'distinct',
      createdAt: 1,
      updatedAt: 2,
      state: {
        traits: ['calm'],
        current_location_id: 'loc_1',
        equipped_items: ['item_1'],
        inventory: ['item_2'],
        faction_id: 'fact_1',
        lastSeenAt: { entryId: 'ent_1', locationId: null, worldTime: 3 },
      },
    })
    expect(entity).toEqual({
      kind: 'character',
      ...MINIMAL,
      ...DEFAULTS,
      state: { visual: {}, traits: ['calm'], drives: [] },
    })
  })

  it.each([
    ['location', { parent_location_id: 'loc_1', condition: 'ruined' }, { condition: 'ruined' }],
    ['item', { at_location_id: 'loc_1', condition: 'rusted' }, { condition: 'rusted' }],
  ] as const)('drops the %s position ref', (kind, state, expected) => {
    expect(EntityImportSchema.parse({ kind, ...MINIMAL, state }).state).toEqual(expected)
  })

  it.each([
    ['a blank name', { name: '   ' }, ['name'], 'A name is required.'],
    ['a missing name', { name: undefined }, ['name'], 'A name is required.'],
    ['priority 101', { priority: 101 }, ['priority'], 'Enter a whole number from 0 to 100.'],
    [
      'a quantity named twice',
      { state: { stackables: { Rope: 1, rope: 2 } } },
      ['state', 'stackables', 'rope'],
      'This quantity is listed twice.',
    ],
    [
      'a blank quantity name',
      { state: { stackables: { ' ': 1 } } },
      ['state', 'stackables', ' '],
      'A quantity needs a name.',
    ],
    [
      'a 41-character quantity name',
      { state: { stackables: { ['k'.repeat(41)]: 1 } } },
      ['state', 'stackables', 'k'.repeat(41)],
      'This is longer than the field allows.',
    ],
    [
      'a quantity name 41 characters long once trimmed',
      { state: { stackables: { [` ${'k'.repeat(41)} `]: 1 } } },
      ['state', 'stackables', ` ${'k'.repeat(41)} `],
      'This is longer than the field allows.',
    ],
  ])('refuses %s with one issue and its copy', (_case, patch, path, message) => {
    expect(issuesOf(EntityImportSchema, { kind: 'character', ...MINIMAL, ...patch })).toEqual([
      { path, message },
    ])
  })

  it.each([
    ['a missing status', { status: undefined }, ['status']],
    ['an unknown status', { status: 'archived' }, ['status']],
    ['a missing injectionMode', { injectionMode: undefined }, ['injectionMode']],
    ['an unknown kind', { kind: 'dragon' }, ['kind']],
    ['a missing kind', { kind: undefined }, ['kind']],
    [
      '51 traits',
      { state: { traits: Array.from({ length: 51 }, (_, i) => `trait ${i}`) } },
      ['state', 'traits'],
    ],
    [
      'a 501-character hair',
      { state: { visual: { hair: 'x'.repeat(501) } } },
      ['state', 'visual', 'hair'],
    ],
    ['a 2001-character voice', { state: { voice: 'x'.repeat(2001) } }, ['state', 'voice']],
    [
      'a fractional quantity',
      { state: { stackables: { rope: 1.5 } } },
      ['state', 'stackables', 'rope'],
    ],
    [
      'a negative quantity',
      { state: { stackables: { rope: -1 } } },
      ['state', 'stackables', 'rope'],
    ],
    ['null quantities', { state: { stackables: null } }, ['state', 'stackables']],
  ])('refuses %s at its path', (_case, patch, path) => {
    const issues = issuesOf(EntityImportSchema, { kind: 'character', ...MINIMAL, ...patch })
    expect(issues.map((issue) => issue.path)).toEqual([path])
  })

  it('reads a quantity name as the pane does, 40 characters once trimmed', () => {
    const key = `  ${'k'.repeat(40)}`
    const entity = EntityImportSchema.parse({
      kind: 'character',
      ...MINIMAL,
      state: { stackables: { [key]: 3 } },
    })
    expect(entity).toMatchObject({ state: { stackables: { [key]: 3 } } })
  })

  it('bounds a quantity name by its normalized length, as storage does', () => {
    // 'İ' lowercases to two code units; NFC folds 'e' + U+0301 into one.
    const grows = 'İ'.repeat(21)
    const shrinks = 'e\u0301'.repeat(21)
    expect(
      issuesOf(EntityImportSchema, {
        kind: 'character',
        ...MINIMAL,
        state: { stackables: { [grows]: 1, [shrinks]: 2 } },
      }),
    ).toEqual([
      { path: ['state', 'stackables', grows], message: 'This is longer than the field allows.' },
    ])
  })

  it('keeps a quantity named __proto__ as data', () => {
    const entity = EntityImportSchema.parse({
      kind: 'character',
      ...MINIMAL,
      state: { stackables: JSON.parse('{"__proto__": 2, "rope": 1}') },
    })
    const stackables = (entity.state as { stackables: Record<string, number> }).stackables
    expect(Object.entries(stackables)).toEqual([
      ['__proto__', 2],
      ['rope', 1],
    ])
    expect(Object.getPrototypeOf(stackables)).toBe(Object.prototype)
  })

  it('reports a too-long quantity name and a repeated one in the same file', () => {
    const stackables = { ['k'.repeat(41)]: 1, Rope: 1, rope: 2 }
    expect(
      issuesOf(EntityImportSchema, { kind: 'character', ...MINIMAL, state: { stackables } }),
    ).toEqual([
      {
        path: ['state', 'stackables', 'k'.repeat(41)],
        message: 'This is longer than the field allows.',
      },
      { path: ['state', 'stackables', 'rope'], message: 'This quantity is listed twice.' },
    ])
  })

  it('reports a quantity name’s issues beside another quantity’s mistyped count', () => {
    const stackables = { ['k'.repeat(41)]: 1, Rope: 1, rope: '2' }
    const issues = issuesOf(EntityImportSchema, {
      kind: 'character',
      ...MINIMAL,
      state: { stackables },
    })
    expect(issues.map((issue) => issue.path)).toEqual([
      ['state', 'stackables', 'rope'],
      ['state', 'stackables', 'k'.repeat(41)],
      ['state', 'stackables', 'rope'],
    ])
    expect(issues.slice(1).map((issue) => issue.message)).toEqual([
      'This is longer than the field allows.',
      'This quantity is listed twice.',
    ])
  })

  it.each([
    ['location', { condition: 'x'.repeat(501) }, ['state', 'condition']],
    ['item', { condition: 'x'.repeat(501) }, ['state', 'condition']],
    ['faction', { agenda: Array.from({ length: 51 }, (_, i) => `aim ${i}`) }, ['state', 'agenda']],
  ] as const)('keeps the %s state bounds', (kind, state, path) => {
    const issues = issuesOf(EntityImportSchema, { kind, ...MINIMAL, state })
    expect(issues.map((issue) => issue.path)).toEqual([path])
  })
})

describe('entityImportSchemaFor', () => {
  it('refuses a valid location in the Characters slot with one issue at kind', () => {
    expect(issuesOf(entityImportSchemaFor('character'), payloadOf(TAVERN))).toEqual([
      { path: ['kind'], message: 'Expected a character.' },
    ])
  })

  it.each([
    ['location', KAEL, 'Expected a location.'],
    ['item', GUILD, 'Expected an item.'],
    ['faction', SWORD, 'Expected a faction.'],
  ] as const)('names %s as the expected kind', (kind, row, message) => {
    expect(issuesOf(entityImportSchemaFor(kind), payloadOf(row))).toEqual([
      { path: ['kind'], message },
    ])
  })

  it('names the expected kind even when the file has a type error too', () => {
    const issues = issuesOf(entityImportSchemaFor('character'), {
      kind: 'location',
      ...MINIMAL,
      name: 42,
    })
    expect(issues.map((issue) => issue.path)).toEqual([['name'], ['kind']])
    expect(issues[1].message).toBe('Expected a character.')
  })

  it('adds nothing at kind for its own kind with a type error', () => {
    const issues = issuesOf(entityImportSchemaFor('location'), {
      kind: 'location',
      ...MINIMAL,
      name: 42,
    })
    expect(issues.map((issue) => issue.path)).toEqual([['name']])
  })

  it('leaves an unknown kind to the union', () => {
    const issues = issuesOf(entityImportSchemaFor('character'), { kind: 'dragon', ...MINIMAL })
    expect(issues.map((issue) => issue.path)).toEqual([['kind']])
    expect(issues[0].message).not.toBe('Expected a character.')
  })

  it('reads its own kind as the full schema does', () => {
    const payload = payloadOf(SWORD)
    expect(entityImportSchemaFor('item').parse(payload)).toEqual(EntityImportSchema.parse(payload))
  })

  it('hands every caller the same schema for a kind', () => {
    expect(entityImportSchemaFor('location')).toBe(entityImportSchemaFor('location'))
  })

  it('types a literal slot’s payload as its own kind, a plain EntityKind’s as the union', () => {
    expectTypeOf(entityImportSchemaFor('item').parse).returns.toEqualTypeOf<
      Extract<EntityImport, { kind: 'item' }>
    >()
    expectTypeOf(
      entityImportSchemaFor<EntityKind>('item').parse,
    ).returns.toEqualTypeOf<EntityImport>()
  })
})
