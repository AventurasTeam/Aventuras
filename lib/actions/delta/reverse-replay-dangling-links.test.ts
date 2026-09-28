import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  translations,
  type Delta,
  type NewEntity,
  type NewTranslation,
  type StoryDefinition,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, generationStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import { reverseAndPruneDeltaRows, reverseReplayDeltas } from './reverse-replay'
import { deleteEntityRow } from '../row-delete/delete-entity'
import { deleteRow } from '../row-delete/delete-row'
import { resolveClassifierFactDeltas } from '../story-entries/classifier-facts'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const character = (id: string, name: string): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
})

const translation = (
  id: string,
  targetKind: NewTranslation['targetKind'],
  targetId: string,
): NewTranslation => ({
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

beforeEach(async () => {
  generationStore.__reset()
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({
    id: 's1',
    title: 'T',
    definition: { leadEntityId: 'char_lead' } as StoryDefinition,
    createdAt: 1,
    updatedAt: 1,
  })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db
    .insert(entities)
    .values([character('char_lead', 'Kael'), character('char_x', 'Mira')])
  entitiesStore.hydrate('b1', (await ctx.db.select().from(entities)) as never)
})

function passAction(actionId: string, entryId: string | null = null) {
  return (action: PipelineAction) =>
    applyDeltaAction({ action, actionId, branchId: 'b1', entryId }, ctx)
}

async function undoHead(): Promise<void> {
  const all = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
  const head = all[0].actionId
  await reverseAndPruneDeltaRows(
    all.filter((d) => d.actionId === head),
    ctx,
  )
}

async function danglingInvolvements(): Promise<unknown[]> {
  const [inv, hap, ent] = await Promise.all([
    ctx.db.select().from(happeningInvolvements),
    ctx.db.select({ id: happenings.id }).from(happenings),
    ctx.db.select({ id: entities.id }).from(entities),
  ])
  const ids = new Set([...hap, ...ent].map((row) => row.id))
  return inv.filter((row) => !ids.has(row.happeningId) || !ids.has(row.entityId))
}

describe('undoing a delete whose link names a row a later reversal removed', () => {
  it('skips an involvement whose pass-created happening the run abort removed', async () => {
    const pass = passAction('act_pass')
    await pass({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hap_p', branchId: 'b1', title: 'Fire', createdAt: 2, updatedAt: 2 },
      },
    })
    await pass({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_p', branchId: 'b1', happeningId: 'hap_p', entityId: 'char_x' },
      },
    })
    await pass({
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', happeningId: 'hap_p', characterId: 'char_x' },
    })
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    await reverseReplayDeltas('act_pass', ctx)
    await undoHead()

    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))).toHaveLength(1)
    expect(await danglingInvolvements()).toEqual([])
    expect(await ctx.db.select().from(happeningAwareness)).toEqual([])
  })

  it('skips an involvement whose pass-created entity the run abort removed', async () => {
    const pass = passAction('act_pass')
    await pass({
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character('char_p', 'Pass-made') },
    })
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_old', branchId: 'b1', title: 'Old', createdAt: 1, updatedAt: 1 })
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_kept', branchId: 'b1', happeningId: 'hap_old', entityId: 'char_x' })
    await pass({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_q', branchId: 'b1', happeningId: 'hap_old', entityId: 'char_p' },
      },
    })
    expect(await deleteRow('happening', 'b1', 'hap_old', ctx)).toEqual({ status: 'ok' })

    await reverseReplayDeltas('act_pass', ctx)
    await undoHead()

    expect(await danglingInvolvements()).toEqual([])
    const restored = await ctx.db
      .select({ id: happeningInvolvements.id })
      .from(happeningInvolvements)
    expect(restored).toEqual([{ id: 'hinv_kept' }])
  })

  it('skips an involvement whose happening a prose-edit invalidation removed', async () => {
    const pass = passAction('act_pass', 'e5')
    await pass({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hap_f', branchId: 'b1', title: 'Fact', createdAt: 2, updatedAt: 2 },
      },
    })
    await pass({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_f', branchId: 'b1', happeningId: 'hap_f', entityId: 'char_x' },
      },
    })
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    await reverseAndPruneDeltaRows(await resolveClassifierFactDeltas('b1', ['e5'], ctx), ctx)
    await undoHead()

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await danglingInvolvements()).toEqual([])
  })

  it("skips a relationship to a removed entity and that relationship's translations", async () => {
    const pass = passAction('act_pass')
    await pass({
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character('char_p', 'Pass-made') },
    })
    await pass({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        subjectId: 'char_x',
        objectId: 'char_p',
        kind: 'rival',
        proseEntryId: null,
      },
    })
    const [rel] = await ctx.db.select().from(characterRelationships)
    await ctx.db
      .insert(translations)
      .values([
        translation('tr_rel', 'character_relationship', rel.id),
        translation('tr_own', 'entity', 'char_x'),
      ])
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    await reverseReplayDeltas('act_pass', ctx)
    await undoHead()

    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
    const left = await ctx.db.select({ id: translations.id }).from(translations)
    expect(left).toEqual([{ id: 'tr_own' }])
  })

  it('restores a link naming a row an earlier-reversed delete in the same plan restores', async () => {
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_old', branchId: 'b1', title: 'Old', createdAt: 1, updatedAt: 1 })
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_1', branchId: 'b1', happeningId: 'hap_old', entityId: 'char_x' })
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })
    expect(await deleteRow('happening', 'b1', 'hap_old', ctx)).toEqual({ status: 'ok' })

    const both = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    await reverseAndPruneDeltaRows(both, ctx)

    const inv = await ctx.db.select({ id: happeningInvolvements.id }).from(happeningInvolvements)
    expect(inv).toEqual([{ id: 'hinv_1' }])
  })

  it('skips a link naming a row an older create in the same plan removes', async () => {
    await passAction('act_old')({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: { entry: { id: 'hap_n', branchId: 'b1', title: 'New', createdAt: 2, updatedAt: 2 } },
    })
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_n', branchId: 'b1', happeningId: 'hap_n', entityId: 'char_x' })
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    const both = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    await reverseAndPruneDeltaRows(both, ctx)

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await danglingInvolvements()).toEqual([])
  })

  it('judges the named row by its oldest delta in the plan, not the first one reversed', async () => {
    await passAction('act_old')({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: { entry: { id: 'hap_n', branchId: 'b1', title: 'New', createdAt: 2, updatedAt: 2 } },
    })
    await ctx.db
      .insert(happeningInvolvements)
      .values({ id: 'hinv_n', branchId: 'b1', happeningId: 'hap_n', entityId: 'char_x' })
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })
    expect(await deleteRow('happening', 'b1', 'hap_n', ctx)).toEqual({ status: 'ok' })

    const all = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    await reverseAndPruneDeltaRows(all, ctx)

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await danglingInvolvements()).toEqual([])
  })
})
