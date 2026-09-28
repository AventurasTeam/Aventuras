import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  emptyEntityState,
  ensureVecTablesSql,
  entities,
  happenings,
  lore,
  stories,
  threads,
  translations,
  type Delta,
  type NewEntity,
  type StoryDefinition,
  type Translation,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, generationStore } from '@/lib/stores'

import type { DbCtx } from '../types'
import { deleteEntityRow } from './delete-entity'
import { deleteRow, ROW_DELETE_REJECTION } from './delete-row'

let ctx: DbCtx

function blockGeneration(): void {
  generationStore.startRun({
    runId: 'r_block',
    kind: 'turn',
    gateBehavior: 'hard-gate',
    actionId: 'act_block',
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: 'commit',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

beforeEach(async () => {
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  for (const ddl of ensureVecTablesSql(8)) test.sqlite.exec(ddl)
  generationStore.__reset()
  const db = ctx.db
  await db.insert(stories).values({
    id: 's1',
    title: 'T',
    definition: { leadEntityId: null } as StoryDefinition,
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await db.insert(lore).values({
    id: 'lore_1',
    branchId: 'b1',
    title: 'Lore',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await db.insert(threads).values({
    id: 'thread_1',
    branchId: 'b1',
    title: 'Thread',
    status: 'active',
    injectionMode: 'auto',
    createdAt: 1,
    updatedAt: 1,
  })
  await db
    .insert(happenings)
    .values({ id: 'hap_1', branchId: 'b1', title: 'Happening', createdAt: 1, updatedAt: 1 })
  await db.insert(translations).values([
    {
      id: 'tr_lore',
      branchId: 'b1',
      targetKind: 'lore',
      targetId: 'lore_1',
      field: 'title',
      language: 'cs',
      translatedText: 'l',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'tr_thread',
      branchId: 'b1',
      targetKind: 'thread',
      targetId: 'thread_1',
      field: 'title',
      language: 'cs',
      translatedText: 't',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'tr_happening',
      branchId: 'b1',
      targetKind: 'happening',
      targetId: 'hap_1',
      field: 'title',
      language: 'cs',
      translatedText: 'h',
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  const character: NewEntity = {
    id: 'char_1',
    branchId: 'b1',
    kind: 'character',
    name: 'Extra',
    status: 'active',
    injectionMode: 'auto',
    state: emptyEntityState('character'),
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  await db.insert(entities).values(character)
  entitiesStore.hydrate('b1', (await db.select().from(entities)) as never)
})

async function translationCountFor(targetKind: Translation['targetKind']): Promise<number> {
  return (await ctx.db.select().from(translations).where(eq(translations.targetKind, targetKind)))
    .length
}

async function deltaActionIds(): Promise<Set<string>> {
  const rows = (await ctx.db.select().from(deltas)) as Delta[]
  return new Set(rows.map((r) => r.actionId))
}

describe('deleteRow — cascade by kind', () => {
  it('deletes a lore row and its translation under one action id', async () => {
    expect(await deleteRow('lore', 'b1', 'lore_1', ctx)).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(lore).where(eq(lore.id, 'lore_1'))).toEqual([])
    expect(await translationCountFor('lore')).toBe(0)
    expect((await deltaActionIds()).size).toBe(1)
  })

  it('deletes a thread row and its translation under one action id', async () => {
    expect(await deleteRow('thread', 'b1', 'thread_1', ctx)).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(threads).where(eq(threads.id, 'thread_1'))).toEqual([])
    expect(await translationCountFor('thread')).toBe(0)
    expect((await deltaActionIds()).size).toBe(1)
  })

  it('deletes a happening row and its translation under one action id', async () => {
    expect(await deleteRow('happening', 'b1', 'hap_1', ctx)).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(happenings).where(eq(happenings.id, 'hap_1'))).toEqual([])
    expect(await translationCountFor('happening')).toBe(0)
    expect((await deltaActionIds()).size).toBe(1)
  })
})

describe('commitRowDelete — in-flight refusal writes nothing', () => {
  it('deleteRow refuses while a hard-gate run holds the pipeline', async () => {
    blockGeneration()
    expect(await deleteRow('lore', 'b1', 'lore_1', ctx)).toEqual({
      status: 'rejected',
      reason: 'generation in flight',
      code: ROW_DELETE_REJECTION.inFlight,
    })
    expect(await ctx.db.select().from(lore).where(eq(lore.id, 'lore_1'))).toHaveLength(1)
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('deleteEntityRow refuses while a hard-gate run holds the pipeline', async () => {
    blockGeneration()
    expect(await deleteEntityRow('b1', 'char_1', ctx)).toEqual({
      status: 'rejected',
      reason: 'generation in flight',
      code: ROW_DELETE_REJECTION.inFlight,
    })
    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_1'))).toHaveLength(1)
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })
})

describe('deleteEntityRow — missing target', () => {
  it('refuses a nonexistent entity with not-found and writes nothing', async () => {
    expect(await deleteEntityRow('b1', 'char_ghost', ctx)).toEqual({
      status: 'rejected',
      reason: 'entity char_ghost not found',
      code: ROW_DELETE_REJECTION.notFound,
    })
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })
})
