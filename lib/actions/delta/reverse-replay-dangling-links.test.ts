import { desc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { selectReversalSet } from './row-closure'
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

const linkToNew: PipelineAction = {
  kind: 'createHappeningInvolvement',
  source: 'user_edit',
  payload: { entry: { id: 'hinv_n', branchId: 'b1', happeningId: 'hap_n', entityId: 'char_x' } },
}

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
  const target = all.filter((d) => d.actionId === head)
  await reverseAndPruneDeltaRows(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx, {
    keepRedoExact: false,
  })
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

  it('skips a link whose far end survives only on a sibling branch under the same id', async () => {
    // A fork copies rows with their ids, so the far-end read must be branch-scoped.
    await ctx.db.insert(branches).values({ id: 'b2', storyId: 's1', name: 'fork', createdAt: 1 })
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_p', branchId: 'b2', title: 'Fire', createdAt: 1, updatedAt: 1 })
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
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    await reverseReplayDeltas('act_pass', ctx)
    await undoHead()

    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_x'))).toHaveLength(1)
    expect(
      await ctx.db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, 'b1')),
    ).toEqual([])
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

    const sweep = await resolveClassifierFactDeltas('b1', ['e5'], ctx)
    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target: [], sweep }),
      ctx,
      { keepRedoExact: false },
    )
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
    // Logged, not inserted raw: the closure reaches it through the relationship and refuses
    // a row with no create in the log (generation-pipeline.md → Reverse-replay).
    await passAction('act_tr')({
      kind: 'createTranslation',
      source: 'periodic_classifier',
      payload: { entry: translation('tr_rel', 'character_relationship', rel.id) },
    })
    await ctx.db.insert(translations).values(translation('tr_own', 'entity', 'char_x'))
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    await reverseReplayDeltas('act_pass', ctx)
    await undoHead()

    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
    const left = await ctx.db.select({ id: translations.id }).from(translations)
    expect(left).toEqual([{ id: 'tr_own' }])
  })

  it('restores the translations of a relationship the user kept, with the delete holding both', async () => {
    await passAction('act_c')({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: {
        branchId: 'b1',
        subjectId: 'char_lead',
        objectId: 'char_x',
        kind: 'rival',
        proseEntryId: null,
      },
    })
    const [rel] = await ctx.db.select().from(characterRelationships)
    await passAction('act_t')({
      kind: 'createTranslation',
      source: 'periodic_classifier',
      payload: { entry: translation('tr_1', 'character_relationship', rel.id) },
    })
    await passAction('act_u')({
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        subjectId: 'char_lead',
        objectId: 'char_x',
        kind: 'ally',
        inverseKind: null,
      },
    })
    await passAction('act_d')({
      kind: 'deleteEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_x' },
    })

    const target = (
      (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    ).filter((d) => d.actionId === 'act_d' || d.actionId === 'act_c')
    await reverseAndPruneDeltaRows(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx, {
      keepRedoExact: false,
    })

    expect(await ctx.db.select().from(characterRelationships)).toEqual([
      expect.objectContaining({ id: rel.id, kind: 'ally' }),
    ])
    expect(await ctx.db.select({ id: translations.id }).from(translations)).toEqual([
      { id: 'tr_1' },
    ])
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
    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target: both }),
      ctx,
      { keepRedoExact: false },
    )

    const inv = await ctx.db.select({ id: happeningInvolvements.id }).from(happeningInvolvements)
    expect(inv).toEqual([{ id: 'hinv_1' }])
  })

  it('skips a link naming a row an older create in the same plan removes', async () => {
    await passAction('act_old')({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: { entry: { id: 'hap_n', branchId: 'b1', title: 'New', createdAt: 2, updatedAt: 2 } },
    })
    // Logged, not inserted raw: the closure takes it with hap_n and refuses a row with no
    // create in the log (generation-pipeline.md → Reverse-replay).
    await passAction('act_link')(linkToNew)
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })

    const all = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target: all }),
      ctx,
      { keepRedoExact: false },
    )

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await danglingInvolvements()).toEqual([])
  })

  it('judges the named row by its oldest delta in the plan, not the first one reversed', async () => {
    await passAction('act_old')({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: { entry: { id: 'hap_n', branchId: 'b1', title: 'New', createdAt: 2, updatedAt: 2 } },
    })
    await passAction('act_link')(linkToNew)
    expect(await deleteEntityRow('b1', 'char_x', ctx)).toEqual({ status: 'ok' })
    expect(await deleteRow('happening', 'b1', 'hap_n', ctx)).toEqual({ status: 'ok' })

    const all = (await ctx.db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
    await reverseAndPruneDeltaRows(
      await selectReversalSet(ctx, { branchId: 'b1', target: all }),
      ctx,
      { keepRedoExact: false },
    )

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await danglingInvolvements()).toEqual([])
  })

  it('reads the named rows in one query per table, however many links the undo restores', async () => {
    const extras = ['char_a', 'char_b', 'char_c']
    await ctx.db.insert(entities).values(extras.map((id) => character(id, id)))
    await ctx.db.insert(happenings).values(
      ['hap_one', 'hap_many'].map((id) => ({
        id,
        branchId: 'b1',
        title: id,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
    await ctx.db.insert(happeningInvolvements).values([
      { id: 'hinv_one', branchId: 'b1', happeningId: 'hap_one', entityId: 'char_x' },
      ...['char_x', ...extras].map((entityId) => ({
        id: `hinv_${entityId}`,
        branchId: 'b1',
        happeningId: 'hap_many',
        entityId,
      })),
    ])
    const selectsToUndo = async (id: string): Promise<number> => {
      expect(await deleteRow('happening', 'b1', id, ctx)).toEqual({ status: 'ok' })
      const select = vi.spyOn(ctx.db, 'select')
      await undoHead()
      const count = select.mock.calls.length
      select.mockRestore()
      return count
    }

    expect(await selectsToUndo('hap_many')).toBe(await selectsToUndo('hap_one'))
    expect(await ctx.db.select().from(happeningInvolvements)).toHaveLength(5)
  })

  it('leaves the closure to the set: the anchored facts come back unclosed', async () => {
    await passAction(
      'act_pass',
      'e5',
    )({
      kind: 'createHappening',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hap_f', branchId: 'b1', title: 'Fact', createdAt: 2, updatedAt: 2 },
      },
    })
    // Awareness-style: the link anchors to another turn than its happening.
    await passAction(
      'act_pass2',
      'e4',
    )({
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: { id: 'hinv_e4', branchId: 'b1', happeningId: 'hap_f', entityId: 'char_x' },
      },
    })

    const facts = await resolveClassifierFactDeltas('b1', ['e5'], ctx)
    expect(facts.map((d) => d.targetId)).toEqual(['hap_f'])

    const set = await selectReversalSet(ctx, { branchId: 'b1', target: [], sweep: facts })
    await reverseAndPruneDeltaRows(set, ctx, { keepRedoExact: false })

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
  })
})
