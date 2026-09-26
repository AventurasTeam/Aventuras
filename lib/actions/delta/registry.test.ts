import { describe, expect, it } from 'vitest'

import { characterRelationships } from '@/lib/db'

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
    const reg = (rowKeepingColumns: string[]) => () =>
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
})
