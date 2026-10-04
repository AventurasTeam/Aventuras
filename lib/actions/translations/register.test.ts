import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  entities,
  stories,
  translations,
  type NewEntity,
  type NewTranslation,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { translationsStore } from '@/lib/stores'

import { registerTranslations } from './register'
import { applyDeltaAction, applyDeltaActionGroup } from '../delta/apply-delta-action'
import { MISSING_REF } from '../delta/live-refs'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { registerEntities } from '../entities/register'

const character = (id: string): NewEntity => ({
  id,
  branchId: 'br_1',
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

async function setup() {
  __resetRegistry()
  // missingRef resolves a translation's target through the registry.
  registerEntities()
  registerTranslations()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(entities).values(character('char_1'))
  translationsStore.__reset()
  translationsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const TRANSLATION: NewTranslation = {
  id: 'tr_1',
  branchId: 'br_1',
  targetKind: 'entity',
  targetId: 'char_1',
  field: 'description',
  language: 'es',
  translatedText: 'Hola mundo',
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(translations).where(eq(translations.id, id))
  return r
}

describe('translations CRUD arms', () => {
  it('create writes the row + delta + maintains the composite index', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: TRANSLATION },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'tr_1')).translatedText).toBe('Hola mundo')
    expect((await db.select().from(deltas)).length).toBe(1)
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe(
      'Hola mundo',
    )
  })

  it('rejects an empty translatedText on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...TRANSLATION, translatedText: '' }
    const result = await applyDeltaAction(
      {
        action: { kind: 'createTranslation', source: 'ai_classifier', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'tr_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('UNIQUE(branch, kind, id, field, language) rejects a duplicate atomically', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: TRANSLATION },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const dup: NewTranslation = { ...TRANSLATION, id: 'tr_2', translatedText: 'Hola otra vez' }
    await expect(
      applyDeltaAction(
        {
          action: { kind: 'createTranslation', source: 'ai_classifier', payload: { entry: dup } },
          actionId: 'act_dup',
          branchId: 'br_1',
        },
        ctx,
      ),
    ).rejects.toThrow(/UNIQUE constraint failed/)
    expect(await rowFor(db, 'tr_2')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(1)
  })

  it('update translatedText; reverse-replay restores the prior text in DB + index', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: TRANSLATION },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateTranslation',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'tr_1', patch: { translatedText: 'Hola de nuevo' } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'tr_1')).translatedText).toBe('Hola de nuevo')
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe(
      'Hola de nuevo',
    )

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect((await rowFor(db, 'tr_1')).translatedText).toBe('Hola mundo')
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe(
      'Hola mundo',
    )
  })

  it('delete; reverse-replay re-inserts the row + restores the composite index', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: TRANSLATION },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteTranslation',
          source: 'ai_classifier',
          payload: { branchId: 'br_1', id: 'tr_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'tr_1')).toBeUndefined()
    expect(
      translationsStore.getTranslation('entity', 'char_1', 'description', 'es'),
    ).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'tr_1')).translatedText).toBe('Hola mundo')
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe(
      'Hola mundo',
    )
  })

  it('reverse-replay of a create evicts the composite index (delete-patch carries only the id)', async () => {
    const { ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: TRANSLATION },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(translationsStore.getTranslation('entity', 'char_1', 'description', 'es')).toBe(
      'Hola mundo',
    )
    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(
      translationsStore.getTranslation('entity', 'char_1', 'description', 'es'),
    ).toBeUndefined()
  })
  it('create no-ops when its target row is gone (no row, no delta)', async () => {
    const { db, ctx } = await setup()

    const result = await applyDeltaAction(
      {
        action: {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: { ...TRANSLATION, targetId: 'char_gone' } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    expect(result).toEqual(MISSING_REF)
    expect(await rowFor(db, 'tr_1')).toBeUndefined()
    expect(await db.select().from(deltas)).toEqual([])
  })

  it('create in a group counts a target the same group creates', async () => {
    const { db, ctx } = await setup()

    const result = await applyDeltaActionGroup(
      [
        {
          kind: 'createEntity',
          source: 'ai_classifier',
          payload: { entry: character('char_new') },
        },
        {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: { ...TRANSLATION, targetId: 'char_new' } },
        },
      ],
      { actionId: 'act_g', branchId: 'br_1' },
      ctx,
    )

    expect(result).toEqual({ status: 'ok' })
    expect((await rowFor(db, 'tr_1')).targetId).toBe('char_new')
  })

  it('create in a group writes nothing for a dead target', async () => {
    const { db, ctx } = await setup()

    const result = await applyDeltaActionGroup(
      [
        {
          kind: 'createTranslation',
          source: 'ai_classifier',
          payload: { entry: { ...TRANSLATION, targetId: 'char_gone' } },
        },
      ],
      { actionId: 'act_g', branchId: 'br_1' },
      ctx,
    )

    expect(result).toEqual({ status: 'ok' })
    expect(await rowFor(db, 'tr_1')).toBeUndefined()
    expect(await db.select().from(deltas)).toEqual([])
  })
})
