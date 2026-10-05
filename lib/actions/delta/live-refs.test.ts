import { getTableColumns } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { branches, entities, happenings, lore, stories, type NewEntity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import {
  isRefTable,
  missingRef,
  REF_COLUMNS,
  referrersOf,
  rowRefs,
  type RefColumn,
} from './live-refs'
import { __resetRegistrationGuard, registerAllDomains } from './registrations'
import { __resetRegistry, resolveByTable } from './registry'
import type { DbCtx } from '../types'

let ctx: DbCtx

const character = (id: string): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const loreRow = (id: string, branchId: string) => ({
  id,
  branchId,
  title: id,
  injectionMode: 'auto' as const,
  createdAt: 1,
  updatedAt: 1,
})

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values([
    { id: 'b1', storyId: 's1', name: 'main', createdAt: 1 },
    { id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 },
  ])
})

const describeRef = ({ table, ref }: { table: string; ref: RefColumn }) =>
  `${table}.${ref.column}${ref.when ? ` when ${ref.when.column}=${ref.when.value}` : ''}`

describe('rowRefs', () => {
  it("reads a link row's ends through its columns", () => {
    expect(
      rowRefs('happening_involvements', { id: 'hinv_1', happeningId: 'hap_1', entityId: 'char_1' }),
    ).toEqual([
      { table: 'happenings', id: 'hap_1' },
      { table: 'entities', id: 'char_1' },
    ])
    expect(rowRefs('happening_awareness', { happeningId: 'hap_1', characterId: 'char_1' })).toEqual(
      [
        { table: 'happenings', id: 'hap_1' },
        { table: 'entities', id: 'char_1' },
      ],
    )
    expect(rowRefs('character_relationships', { aId: 'char_a', bId: 'char_b' })).toEqual([
      { table: 'entities', id: 'char_a' },
      { table: 'entities', id: 'char_b' },
    ])
  })

  it("reads a translation's target in the table its target_kind selects, and no other", () => {
    // An independent oracle for TRANSLATION_TARGET_TABLE, not the constant itself.
    const tables: Record<string, string> = {
      entity: 'entities',
      lore: 'lore',
      thread: 'threads',
      happening: 'happenings',
      story_entry: 'story_entries',
      character_relationship: 'character_relationships',
      chapter: 'chapters',
    }
    for (const [targetKind, table] of Object.entries(tables)) {
      expect(rowRefs('translations', { targetKind, targetId: 'row_1' })).toEqual([
        { table, id: 'row_1' },
      ])
    }
  })

  it('names nothing through a missing column, a non-string id, an unknown kind or a plain table', () => {
    expect(rowRefs('happening_involvements', { happeningId: 'hap_1' })).toEqual([
      { table: 'happenings', id: 'hap_1' },
    ])
    expect(rowRefs('character_relationships', { aId: null, bId: 'char_b' })).toEqual([
      { table: 'entities', id: 'char_b' },
    ])
    expect(rowRefs('translations', { targetKind: 'bogus', targetId: 'row_1' })).toEqual([])
    expect(rowRefs('entities', { id: 'char_1', name: 'Kael' })).toEqual([])
  })
})

describe('referrersOf', () => {
  it('lists every column that can name an entity', () => {
    expect(referrersOf('entities').map(describeRef).sort()).toEqual([
      'character_relationships.aId',
      'character_relationships.bId',
      'happening_awareness.characterId',
      'happening_involvements.entityId',
      'translations.targetId when targetKind=entity',
    ])
  })

  it('lists only the matching translation discriminator for a story entry and a relationship', () => {
    expect(referrersOf('story_entries').map(describeRef)).toEqual([
      'translations.targetId when targetKind=story_entry',
    ])
    expect(referrersOf('character_relationships').map(describeRef)).toEqual([
      'translations.targetId when targetKind=character_relationship',
    ])
  })
})

describe('REF_COLUMNS', () => {
  it('names only registered tables, through columns those tables have', () => {
    const columnsOf = (table: string) => {
      const entry = resolveByTable(table)
      if (!entry) throw new Error(`${table} is not registered`)
      return Object.keys(getTableColumns(entry.descriptor.table))
    }
    for (const [table, refs] of Object.entries(REF_COLUMNS)) {
      const columns = columnsOf(table)
      for (const ref of refs) {
        expect(columns).toContain(ref.column)
        if (ref.when) expect(columns).toContain(ref.when.column)
        expect(columnsOf(ref.refTable)).toContain('id')
        expect(isRefTable(ref.refTable)).toBe(true)
      }
    }
    expect(isRefTable('happening_involvements')).toBe(false)
  })
})

describe('missingRef', () => {
  it('finds a lore row live on the branch', async () => {
    await ctx.db.insert(lore).values(loreRow('lore_1', 'b1'))

    expect(await missingRef(ctx, 'b1', [{ table: 'lore', id: 'lore_1' }])).toBe(false)
  })

  it('reports a lore row that is gone, or live only on another branch', async () => {
    await ctx.db.insert(lore).values(loreRow('lore_1', 'b2'))

    expect(await missingRef(ctx, 'b1', [{ table: 'lore', id: 'lore_1' }])).toBe(true)
    expect(await missingRef(ctx, 'b1', [{ table: 'lore', id: 'lore_gone' }])).toBe(true)
  })

  it('still checks an entity and a happening', async () => {
    await ctx.db.insert(entities).values(character('char_1'))
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })

    const refs = [
      { table: 'happenings', id: 'hap_1' },
      { table: 'entities', id: 'char_1' },
    ] as const
    expect(await missingRef(ctx, 'b1', refs)).toBe(false)
    expect(await missingRef(ctx, 'b1', [...refs, { table: 'entities', id: 'char_gone' }])).toBe(
      true,
    )
  })

  it('counts a row the same group creates', async () => {
    const group = { created: new Set(['lore:lore_new']) }

    expect(await missingRef(ctx, 'b1', [{ table: 'lore', id: 'lore_new' }], group)).toBe(false)
  })

  it('throws for a ref to a table nothing registered', async () => {
    __resetRegistry()
    try {
      await expect(missingRef(ctx, 'b1', [{ table: 'lore', id: 'lore_1' }])).rejects.toThrow(
        'missingRef: lore is not a registered table',
      )
    } finally {
      __resetRegistrationGuard()
      registerAllDomains()
    }
  })
})
