import { describe, expect, it } from 'vitest'

import { characterRelationships, entities, entityStateColumnSchema } from '@/lib/db'

import { __resetRegistry, register, resolveByActionKind, resolveByTable } from './registry'
import type { ActionHandler } from './registry'

describe('delta registry', () => {
  it('resolves a handler by action kind and a descriptor by table', () => {
    __resetRegistry()
    const handler: ActionHandler = async () => ({
      status: 'ok',
      targetTable: 'fixtures',
      targetId: 'x',
      op: 'create',
      undoPayload: null,
      ops: [],
      patch: null,
    })
    register({
      table: 'fixtures',
      descriptor: { table: {} as never, idCol: {} as never },
      columnSchemas: {},
      handlers: { fixtureCreate: handler },
    })
    expect(resolveByActionKind('fixtureCreate')?.handler).toBe(handler)
    expect(resolveByActionKind('fixtureCreate')?.table).toBe('fixtures')
    expect(resolveByTable('fixtures')?.table).toBe('fixtures')
    expect(resolveByTable('nope')).toBeUndefined()
  })

  it('refuses a row-keeping column the table does not have', () => {
    __resetRegistry()
    const reg = (rowKeepingColumns: [string, ...string[]]) => () =>
      register({
        table: 'character_relationships',
        descriptor: { table: characterRelationships, idCol: characterRelationships.id },
        columnSchemas: {},
        handlers: {},
        rowKeepingColumns,
      })
    expect(reg(['kind', 'inverse_kind'])).toThrow(/inverse_kind/)
    expect(resolveByTable('character_relationships')).toBeUndefined()
    expect(reg(['kind', 'inverseKind'])).not.toThrow()
  })

  // Every row would read as keeping none, so each update reversal would delete its row.
  it('refuses an empty row-keeping list', () => {
    __resetRegistry()
    const empty = [] as unknown as [string, ...string[]]
    expect(() =>
      register({
        table: 'character_relationships',
        descriptor: { table: characterRelationships, idCol: characterRelationships.id },
        columnSchemas: {},
        handlers: {},
        rowKeepingColumns: empty,
      }),
    ).toThrow(/no row-keeping column/)
    expect(resolveByTable('character_relationships')).toBeUndefined()
  })

  it('refuses rowKeepingColumns on embedded tables; a tombstone reversal would orphan vectors', () => {
    __resetRegistry()
    expect(() =>
      register({
        table: 'entities',
        descriptor: { table: entities, idCol: entities.id, branchCol: entities.branchId },
        columnSchemas: {},
        handlers: {},
        rowKeepingColumns: ['name'],
      }),
    ).toThrow(/tombstone reversal would orphan/)
    expect(resolveByTable('entities')).toBeUndefined()
  })
})

// generation-pipeline.md → Reverse-replay: a list left undeclared would undo as a whole value.
describe('field kinds a reversal undoes by', () => {
  const STATE_LISTS = ['traits', 'drives', 'agenda', 'inventory', 'equipped_items']
  const entitiesWith =
    (fields: Pick<Parameters<typeof register>[0], 'termLists' | 'counter'>) => () =>
      register({
        table: 'entities',
        descriptor: { table: entities, idCol: entities.id },
        columnSchemas: { state: entityStateColumnSchema },
        handlers: {},
        ...fields,
      })
  const stateLists = (keys: readonly string[]) =>
    keys.map((key) => ({ column: 'state', path: [key], match: 'exact' as const }))

  it('takes every array of a schema-backed column, declared', () => {
    __resetRegistry()
    expect(
      entitiesWith({
        termLists: [{ column: 'keywords', match: 'normalized' }, ...stateLists(STATE_LISTS)],
      }),
    ).not.toThrow()
  })

  it('refuses a schema-backed column with an array left undeclared', () => {
    __resetRegistry()
    expect(entitiesWith({ termLists: stateLists(STATE_LISTS.slice(1)) })).toThrow(
      /state\.traits is an undeclared list/,
    )
    expect(resolveByTable('entities')).toBeUndefined()
  })

  it('refuses a declared path that is not an array', () => {
    __resetRegistry()
    expect(entitiesWith({ termLists: stateLists([...STATE_LISTS, 'voice']) })).toThrow(
      /state\.voice is not an array/,
    )
  })

  it('refuses a list in a column the table lacks, or a whole schema-backed column', () => {
    __resetRegistry()
    expect(entitiesWith({ termLists: [{ column: 'aliases', match: 'exact' }] })).toThrow(/aliases/)
    expect(entitiesWith({ termLists: [{ column: 'state', match: 'exact' }] })).toThrow(
      /declare its array paths/,
    )
  })

  it('refuses a counter the table has no plain column for', () => {
    __resetRegistry()
    const counter = (column: string) => ({ column, isRelative: () => true })
    expect(entitiesWith({ counter: counter('retrievalCount') })).toThrow(/retrievalCount/)
    expect(entitiesWith({ counter: counter('state') })).toThrow(/state/)
    expect(entitiesWith({ counter: counter('priority') })).not.toThrow()
  })
})
