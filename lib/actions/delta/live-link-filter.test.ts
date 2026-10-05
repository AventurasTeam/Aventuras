import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  entities,
  lore,
  stories,
  storyEntries,
  type CharacterRelationship,
  type Delta,
  type NewEntity,
  type Translation,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { capturedChildren } from './delete-cascade'
import { liveLinkFilter } from './live-link-filter'
import { __resetRegistrationGuard, registerAllDomains } from './registrations'
import { __resetRegistry, resolveByTable } from './registry'
import { registerEntities } from '../entities/register'
import type { DbCtx } from '../types'

let ctx: DbCtx

const delta = (
  id: string,
  logPosition: number,
  over: Partial<Delta> & Pick<Delta, 'targetTable' | 'targetId'>,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: `act_${id}`,
  op: 'delete',
  entryId: null,
  source: 'user_edit',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

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

const relationship = (id: string, aId: string, bId: string): CharacterRelationship => ({
  id,
  branchId: 'b1',
  aId,
  bId,
  kind: 'ally',
  inverseKind: null,
  createdAt: 1,
  updatedAt: 1,
})

const translation = (
  id: string,
  targetKind: Translation['targetKind'],
  targetId: string,
): Translation => ({
  id,
  branchId: 'b1',
  targetKind,
  targetId,
  field: 'name',
  language: 'es',
  translatedText: 'x',
  createdAt: 1,
  updatedAt: 1,
})

function entityDelete(captured: {
  relationships?: CharacterRelationship[]
  translations?: Translation[]
}): Delta {
  return delta('d_del', 3, {
    targetTable: 'entities',
    targetId: 'char_k',
    undoPayload: {
      ...character('char_k'),
      involvements: [],
      awareness: [],
      relationships: captured.relationships ?? [],
      translations: captured.translations ?? [],
    },
  })
}

function capturedBy(d: Delta) {
  return capturedChildren(resolveByTable(d.targetTable)?.cascade, d.undoPayload ?? {}).children
}

const ids = (children: ReturnType<typeof capturedBy>) =>
  Object.fromEntries(children.map(({ table, rows }) => [table, rows.map((row) => row.id)]))

beforeEach(async () => {
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db.insert(entities).values(character('char_x'))
})

describe('liveLinkFilter', () => {
  it('keeps a translation of a relationship the same undo restores', async () => {
    const del = entityDelete({
      relationships: [relationship('rel_1', 'char_k', 'char_x')],
      translations: [
        translation('tr_rel', 'character_relationship', 'rel_1'),
        translation('tr_own', 'entity', 'char_k'),
      ],
    })

    const filter = await liveLinkFilter([del], ctx)

    expect(ids(filter('b1', capturedBy(del)))).toMatchObject({
      character_relationships: ['rel_1'],
      translations: ['tr_rel', 'tr_own'],
    })
  })

  it('drops a captured row naming a dead row of any registered table, then rows naming it', async () => {
    await ctx.db.insert(lore).values({
      id: 'lore_live',
      branchId: 'b1',
      title: 'Aether',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    const del = entityDelete({
      relationships: [relationship('rel_dead', 'char_gone', 'char_k')],
      translations: [
        translation('tr_rel_dead', 'character_relationship', 'rel_dead'),
        translation('tr_lore_live', 'lore', 'lore_live'),
        translation('tr_lore_gone', 'lore', 'lore_gone'),
      ],
    })

    const filter = await liveLinkFilter([del], ctx)

    expect(ids(filter('b1', capturedBy(del)))).toMatchObject({
      character_relationships: [],
      translations: ['tr_lore_live'],
    })
  })

  it('judges a story entry by its fate in the plan before the database', async () => {
    await ctx.db.insert(storyEntries).values({
      id: 'entry_new',
      branchId: 'b1',
      position: 1,
      kind: 'ai_reply',
      content: 'new',
      createdAt: 1,
    })
    const create = delta('d_entry_new', 1, {
      op: 'create',
      source: 'per_turn_classifier',
      targetTable: 'story_entries',
      targetId: 'entry_new',
    })
    const restore = delta('d_entry_old', 2, {
      targetTable: 'story_entries',
      targetId: 'entry_old',
      undoPayload: {
        id: 'entry_old',
        branchId: 'b1',
        position: 2,
        kind: 'ai_reply',
        content: 'old',
        createdAt: 1,
      },
    })
    const del = entityDelete({
      translations: [
        translation('tr_new', 'story_entry', 'entry_new'),
        translation('tr_old', 'story_entry', 'entry_old'),
      ],
    })

    const filter = await liveLinkFilter([del, restore, create], ctx)

    // entry_new is live now but the plan's create removes it; entry_old is gone but its delete
    // in the plan restores it.
    expect(ids(filter('b1', capturedBy(del)))).toMatchObject({ translations: ['tr_old'] })
  })

  it('throws for a captured row naming a table nothing registered', async () => {
    const del = entityDelete({ translations: [translation('tr_lore', 'lore', 'lore_1')] })
    __resetRegistry()
    // Only the deleted row's table stays registered, so its cascade still captures the translation.
    registerEntities()
    try {
      await expect(liveLinkFilter([del], ctx)).rejects.toThrow(
        'liveLinkFilter: lore is not a registered table',
      )
    } finally {
      __resetRegistrationGuard()
      registerAllDomains()
    }
  })
})
