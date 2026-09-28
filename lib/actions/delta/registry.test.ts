import { describe, expect, it } from 'vitest'

import { characterRelationships, entities } from '@/lib/db'

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

  it('refuses rowKeepingColumns on embedded tables (vectors swept on reversal)', () => {
    __resetRegistry()
    expect(() =>
      register({
        table: 'entities',
        descriptor: { table: entities, idCol: entities.id, branchCol: entities.branchId },
        columnSchemas: {},
        handlers: {},
        rowKeepingColumns: ['name'],
      }),
    ).toThrow(/embedded.*cannot declare rowKeepingColumns/)
    expect(resolveByTable('entities')).toBeUndefined()
  })
})
