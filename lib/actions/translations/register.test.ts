import { and, eq } from 'drizzle-orm'
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
import type { PipelineAction } from '../types'

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
    expect(translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es')).toBe(
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
    expect(translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es')).toBe(
      'Hola de nuevo',
    )

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect((await rowFor(db, 'tr_1')).translatedText).toBe('Hola mundo')
    expect(translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es')).toBe(
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
      translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es'),
    ).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'tr_1')).translatedText).toBe('Hola mundo')
    expect(translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es')).toBe(
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
    expect(translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es')).toBe(
      'Hola mundo',
    )
    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(
      translationsStore.getTranslation('br_1', 'entity', 'char_1', 'description', 'es'),
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

    expect(result).toEqual({ status: 'rejected', reason: MISSING_REF.reason, code: 'noop' })
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

// Translation ids repeat across branches (key: branch and id), so every read and write is scoped.
describe('branch scope', () => {
  const MAIN: NewTranslation = {
    id: 'tr_1',
    branchId: 'br_1',
    targetKind: 'entity',
    targetId: 'char_1',
    field: 'description',
    language: 'es',
    translatedText: 'Hola desde main',
    createdAt: 1,
    updatedAt: 1,
  }
  const FORK: NewTranslation = {
    id: 'tr_1',
    branchId: 'br_2',
    targetKind: 'entity',
    targetId: 'char_2',
    field: 'name',
    language: 'de',
    translatedText: 'Hallo vom Zweig',
    createdAt: 2,
    updatedAt: 2,
  }

  type Fixture = Awaited<ReturnType<typeof setup>>

  // An id-only read scans in insertion order, so the sibling's row goes in first.
  async function forked({ written }: { written: boolean }) {
    const fixture = await setup()
    await fixture.db
      .insert(branches)
      .values({ id: 'br_2', storyId: 'story_1', name: 'fork', createdAt: 2 })
    await fixture.db.insert(entities).values([
      { ...character('char_1'), branchId: 'br_2' },
      { ...character('char_2'), branchId: 'br_2' },
    ])
    await fixture.db.insert(translations).values([MAIN, ...(written ? [FORK] : [])])
    return fixture
  }

  const translationOn = async (db: Fixture['db'], branchId: 'br_1' | 'br_2') =>
    (
      await db
        .select()
        .from(translations)
        .where(and(eq(translations.branchId, branchId), eq(translations.id, 'tr_1')))
    )[0]

  const undoPayloadsOf = async (db: Fixture['db'], actionId: string) =>
    (await db.select().from(deltas).where(eq(deltas.actionId, actionId))).map(
      (delta) => delta.undoPayload,
    )

  const onFork = (ctx: Fixture['ctx'], action: PipelineAction, actionId: string) =>
    applyDeltaAction({ action, actionId, branchId: 'br_2' }, ctx)

  it("createTranslation pair: creates the row on its own branch beside another branch's same id, and its reversal removes only that row", async () => {
    const { db, ctx } = await forked({ written: false })
    const create: PipelineAction = {
      kind: 'createTranslation',
      source: 'ai_classifier',
      payload: { entry: FORK },
    }
    expect(await onFork(ctx, create, 'act_c')).toMatchObject({ status: 'ok' })
    expect(await translationOn(db, 'br_2')).toEqual(FORK)
    expect(await translationOn(db, 'br_1')).toEqual(MAIN)

    expect(await reverseReplayDeltas('act_c', ctx)).toBe(1)
    expect(await translationOn(db, 'br_2')).toBeUndefined()
    expect(await translationOn(db, 'br_1')).toEqual(MAIN)
  })

  it("updateTranslation pair: updates only its own branch's row, recording that row's priors, and its reversal restores it", async () => {
    const { db, ctx } = await forked({ written: true })
    const update: PipelineAction = {
      kind: 'updateTranslation',
      source: 'ai_classifier',
      payload: { branchId: 'br_2', id: 'tr_1', patch: { translatedText: 'Hallo erneut' } },
    }
    expect(await onFork(ctx, update, 'act_u')).toMatchObject({ status: 'ok' })
    expect(await translationOn(db, 'br_2')).toEqual({ ...FORK, translatedText: 'Hallo erneut' })
    expect(await translationOn(db, 'br_1')).toEqual(MAIN)
    expect(await undoPayloadsOf(db, 'act_u')).toEqual([{ translatedText: 'Hallo vom Zweig' }])

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    expect(await translationOn(db, 'br_2')).toEqual(FORK)
    expect(await translationOn(db, 'br_1')).toEqual(MAIN)
  })

  it("deleteTranslation pair: deletes only its own branch's row, and its reversal restores that row", async () => {
    const { db, ctx } = await forked({ written: true })
    const remove: PipelineAction = {
      kind: 'deleteTranslation',
      source: 'ai_classifier',
      payload: { branchId: 'br_2', id: 'tr_1' },
    }
    expect(await onFork(ctx, remove, 'act_d')).toMatchObject({ status: 'ok' })
    expect(await translationOn(db, 'br_2')).toBeUndefined()
    expect(await translationOn(db, 'br_1')).toEqual(MAIN)

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect(await translationOn(db, 'br_2')).toEqual(FORK)
    expect(await translationOn(db, 'br_1')).toEqual(MAIN)
  })

  const PAYLOAD_CASES: { action: PipelineAction; reason: string }[] = [
    {
      action: {
        kind: 'createTranslation',
        source: 'ai_classifier',
        payload: {
          entry: {
            ...MAIN,
            id: 'tr_2',
            field: 'name',
            language: 'fr',
            translatedText: 'Bonjour',
          },
        },
      },
      reason: 'branch mismatch: delta br_2 vs entry br_1',
    },
    {
      action: {
        kind: 'updateTranslation',
        source: 'ai_classifier',
        payload: { branchId: 'br_1', id: 'tr_1', patch: { translatedText: 'Hola de nuevo' } },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
    {
      action: {
        kind: 'deleteTranslation',
        source: 'ai_classifier',
        payload: { branchId: 'br_1', id: 'tr_1' },
      },
      reason: 'branch mismatch: delta br_2 vs target br_1',
    },
  ]

  it.each(PAYLOAD_CASES.map((c) => [c.action.kind, c] as const))(
    '%s payload: refuses a payload naming another branch and writes neither branch',
    async (_kind, { action, reason }) => {
      const { db, ctx } = await forked({ written: true })
      expect(await onFork(ctx, action, 'act_p')).toEqual({ status: 'rejected', reason })
      expect(await translationOn(db, 'br_1')).toEqual(MAIN)
      expect(await translationOn(db, 'br_2')).toEqual(FORK)
      expect(await db.select().from(translations).where(eq(translations.id, 'tr_2'))).toEqual([])
      expect(await undoPayloadsOf(db, 'act_p')).toEqual([])
    },
  )
})
