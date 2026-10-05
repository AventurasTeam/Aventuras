import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  characterRelationships,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  stories,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { applyDeltaAction } from './apply-delta-action'
import {
  buildReverseAndPrunePlan,
  ReversalIntegrityError,
  reverseAndPruneDeltaRows,
  reverseReplayDeltas,
} from './reverse-replay'
import { selectReversalSet } from './row-closure'
import { undoLastAction } from '../story-entries/undo'
import type { DbCtx, PipelineAction } from '../types'

let ctx: DbCtx

const character = (id: string, over: Partial<NewEntity> = {}): NewEntity => ({
  id,
  branchId: 'b1',
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const raw = (
  id: string,
  logPosition: number,
  over: Partial<Delta> & Pick<Delta, 'targetTable' | 'targetId'>,
): Delta => ({
  id,
  branchId: 'b1',
  actionId: 'act_run',
  op: 'create',
  entryId: null,
  source: 'periodic_classifier',
  undoPayload: null,
  logPosition,
  encodingVersion: 1,
  createdAt: logPosition,
  ...over,
})

beforeEach(async () => {
  generationStore.__reset()
  const t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db
    .insert(entities)
    .values([character('char_x'), character('char_y'), character('char_z')])
})

afterEach(() => {
  entriesStore.__reset()
  undoRedoStore.clear()
})

async function act(actionId: string, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok')
    throw new Error(`${action.kind} did not land: ${JSON.stringify(result)}`)
}

async function deltasOf(actionId: string): Promise<Delta[]> {
  return (await ctx.db.select().from(deltas).where(eq(deltas.actionId, actionId))) as Delta[]
}

async function payloadOf(actionId: string): Promise<Record<string, unknown>> {
  const [holder] = await deltasOf(actionId)
  return holder.undoPayload ?? {}
}

async function planFor(target: readonly Delta[]) {
  return buildReverseAndPrunePlan(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx)
}

const isPayloadWrite = (op: { sql: string }) => /^update "deltas"/.test(op.sql)

const passView = (subjectId: string, objectId: string, kind: string): PipelineAction => ({
  kind: 'upsertCharacterRelationship',
  source: 'periodic_classifier',
  payload: { branchId: 'b1', subjectId, objectId, kind, proseEntryId: null },
})

const deleteEntity = (id: string): PipelineAction => ({
  kind: 'deleteEntity',
  source: 'user_edit',
  payload: { branchId: 'b1', id },
})

const deleteHappening = (id: string): PipelineAction => ({
  kind: 'deleteHappening',
  source: 'user_edit',
  payload: { branchId: 'b1', id },
})

const passHappening = (id: string): PipelineAction => ({
  kind: 'createHappening',
  source: 'periodic_classifier',
  payload: { entry: { id, branchId: 'b1', title: id, createdAt: 2, updatedAt: 2 } },
})

const passInvolvement = (id: string, happeningId: string, entityId: string): PipelineAction => ({
  kind: 'createHappeningInvolvement',
  source: 'periodic_classifier',
  payload: { entry: { id, branchId: 'b1', happeningId, entityId } },
})

// char_x < char_y: `kind` is char_x's view, `inverseKind` char_y's.
async function seedMentorPair(kind: string | null, inverseKind: string | null): Promise<void> {
  await ctx.db.insert(characterRelationships).values({
    id: 'rel_1',
    branchId: 'b1',
    aId: 'char_x',
    bId: 'char_y',
    kind,
    inverseKind,
    createdAt: 1,
    updatedAt: 1,
  })
}

describe('a reversal applies to rows a delete outside the set holds', () => {
  it("strips the pass's relationships from an entity delete in one payload write", async () => {
    await act('act_pass', passView('char_x', 'char_y', 'rival'))
    await act('act_pass', passView('char_x', 'char_z', 'ally'))
    await act('act_del', deleteEntity('char_x'))
    expect((await payloadOf('act_del')).relationships).toHaveLength(2)

    const plan = await planFor(await deltasOf('act_pass'))
    expect(plan.ops.filter(isPayloadWrite)).toHaveLength(1)
    expect(plan.patches).toEqual([])

    expect(await reverseReplayDeltas('act_pass', ctx)).toBe(2)

    expect((await payloadOf('act_del')).relationships).toEqual([])
    expect(await deltasOf('act_pass')).toEqual([])
    await reverseReplayDeltas('act_del', ctx)
    expect(
      await ctx.db.select({ id: entities.id }).from(entities).where(eq(entities.id, 'char_x')),
    ).toEqual([{ id: 'char_x' }])
    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
  })

  it("strips the pass's awareness from a happening delete", async () => {
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_1', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
    await act('act_pass', {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', happeningId: 'hap_1', characterId: 'char_x' },
    })
    await act('act_del', deleteHappening('hap_1'))
    expect((await payloadOf('act_del')).awareness).toHaveLength(1)

    await reverseReplayDeltas('act_pass', ctx)

    expect((await payloadOf('act_del')).awareness).toEqual([])
    await reverseReplayDeltas('act_del', ctx)
    expect(await ctx.db.select({ id: happenings.id }).from(happenings)).toEqual([{ id: 'hap_1' }])
    expect(await ctx.db.select().from(happeningAwareness)).toEqual([])
  })

  it('prunes the deletes of rows the pass created, so CTRL-Z reaches the group before them', async () => {
    entriesStore.hydrate('b1', [])
    await act('act_user0', {
      kind: 'createLore',
      source: 'user_edit',
      payload: {
        entry: {
          id: 'lore_u',
          branchId: 'b1',
          title: 'Vael',
          body: 'ash',
          injectionMode: 'auto',
          createdAt: 1,
          updatedAt: 1,
        },
      },
    })
    await act('act_pass', passHappening('hap_p'))
    await act('act_pass', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character('char_p') },
    })
    await act('act_del_h', deleteHappening('hap_p'))
    await act('act_del_e', deleteEntity('char_p'))

    expect(await reverseReplayDeltas('act_pass', ctx)).toBe(2)
    const left = await ctx.db.select({ actionId: deltas.actionId }).from(deltas)
    expect(left.map((d) => d.actionId)).toEqual(['act_user0'])

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(lore)).toEqual([])
    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await ctx.db.select().from(entities).where(eq(entities.id, 'char_p'))).toEqual([])
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('patches a captured relationship back to the view the pass overwrote', async () => {
    await seedMentorPair('ally', null)
    await act('act_pass', passView('char_x', 'char_y', 'rival'))
    await act('act_del', deleteEntity('char_x'))

    await reverseReplayDeltas('act_pass', ctx)

    expect((await payloadOf('act_del')).relationships).toEqual([
      expect.objectContaining({ id: 'rel_1', kind: 'ally', inverseKind: null }),
    ])
    await reverseReplayDeltas('act_del', ctx)
    const [rel] = await ctx.db.select().from(characterRelationships)
    expect(rel).toMatchObject({ id: 'rel_1', kind: 'ally', inverseKind: null })
  })

  it('composes two undos onto one held copy', async () => {
    await ctx.db.insert(entities).values(character('char_s', { status: 'staged', keywords: ['a'] }))
    await act('act_pass', {
      kind: 'promoteStagedEntity',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_s', proseEntryId: null },
    })
    await act('act_pass', {
      kind: 'appendEntityKeywords',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_s', keywords: ['b'], proseEntryId: null },
    })
    await act('act_del', deleteEntity('char_s'))

    await reverseReplayDeltas('act_pass', ctx)

    expect(await payloadOf('act_del')).toMatchObject({ status: 'staged', keywords: ['a'] })
  })

  it('keeps a later user write on the held copy and restores only what the user left', async () => {
    await ctx.db.insert(entities).values(character('char_s', { status: 'staged', keywords: ['a'] }))
    await act('act_pass', {
      kind: 'promoteStagedEntity',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_s', proseEntryId: null },
    })
    await act('act_pass', {
      kind: 'appendEntityKeywords',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_s', keywords: ['b'], proseEntryId: null },
    })
    await act('act_user', {
      kind: 'updateEntity',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_s', patch: { keywords: ['a', 'b', 'u'] } },
    })
    await act('act_del', deleteEntity('char_s'))

    await reverseReplayDeltas('act_pass', ctx)

    expect(await payloadOf('act_del')).toMatchObject({
      status: 'staged',
      keywords: ['a', 'b', 'u'],
    })
    expect(await deltasOf('act_pass')).toEqual([])
  })

  it('restores the state sub-field the reversed write changed, keeping the user one', async () => {
    const state = { ...emptyEntityState('character'), visual: { hair: 'black', attire: 'cloak' } }
    await ctx.db.insert(entities).values(character('char_v', { state }))
    await act('act_pass', {
      kind: 'updateEntityVisualState',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_v', visual: { hair: 'grey' } },
    })
    await act('act_user', {
      kind: 'updateEntityVisualState',
      source: 'user_edit',
      payload: { branchId: 'b1', id: 'char_v', visual: { attire: 'armor' } },
    })
    await act('act_del', deleteEntity('char_v'))

    await reverseReplayDeltas('act_pass', ctx)

    expect((await payloadOf('act_del')).state).toMatchObject({
      visual: { hair: 'black', attire: 'armor' },
    })
  })

  it('strips a held relationship that an update undo leaves with no view', async () => {
    await seedMentorPair(null, 'mentor')
    await act('act_pass', passView('char_x', 'char_y', 'rival'))
    await act('act_user', {
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        subjectId: 'char_x',
        objectId: 'char_y',
        kind: 'rival',
        inverseKind: null,
      },
    })
    await act('act_del', deleteEntity('char_x'))
    expect((await payloadOf('act_del')).relationships).toEqual([
      expect.objectContaining({ kind: 'rival', inverseKind: null }),
    ])

    await reverseReplayDeltas('act_pass', ctx)

    expect((await payloadOf('act_del')).relationships).toEqual([])
  })

  it('re-owns a held create a later user view keeps, so removing a character it names closes', async () => {
    await act('act_user0', {
      kind: 'createEntity',
      source: 'user_edit',
      payload: { entry: character('char_p') },
    })
    await act('act_pass', passView('char_p', 'char_y', 'rival'))
    await act('act_user', {
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        subjectId: 'char_p',
        objectId: 'char_y',
        kind: 'rival',
        inverseKind: 'mentor',
      },
    })
    await act('act_del', deleteEntity('char_p'))
    const [created] = await deltasOf('act_pass')

    expect(await reverseReplayDeltas('act_pass', ctx)).toBe(1)

    // The pass's view is nulled on the held copy; the row stays for the user's.
    expect((await payloadOf('act_del')).relationships).toEqual([
      expect.objectContaining({ kind: null, inverseKind: 'mentor' }),
    ])
    const [reowned] = await ctx.db.select().from(deltas).where(eq(deltas.id, created.id))
    expect(reowned).toMatchObject({ source: 'user_edit', entryId: null, actionId: 'act_user' })

    await reverseReplayDeltas('act_del', ctx)
    expect(await ctx.db.select().from(characterRelationships)).toEqual([
      expect.objectContaining({ kind: null, inverseKind: 'mentor' }),
    ])
    // Reached by reference through char_p, the row's create is in the log, so nothing refuses.
    await reverseReplayDeltas('act_user0', ctx)
    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('reverses the live row when its holder was undone after the set was selected', async () => {
    await seedMentorPair('ally', null)
    await act('act_pass', passView('char_x', 'char_y', 'rival'))
    await act('act_del', deleteEntity('char_x'))
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_pass') })
    await reverseReplayDeltas('act_del', ctx)

    await reverseAndPruneDeltaRows(set, ctx)

    const [rel] = await ctx.db.select().from(characterRelationships)
    expect(rel).toMatchObject({ id: 'rel_1', kind: 'ally' })
  })

  it('edits no payload when the holder is in the set: its undo puts the rows back first', async () => {
    await act('act_pass', passHappening('hap_p'))
    await act('act_pass', passInvolvement('hinv_p', 'hap_p', 'char_x'))
    await act('act_del', deleteHappening('hap_p'))
    const all = (await ctx.db.select().from(deltas)) as Delta[]
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: all })

    const plan = await buildReverseAndPrunePlan(set, ctx)
    expect(plan.ops.filter(isPayloadWrite)).toEqual([])
    expect(plan.pruneOps).toHaveLength(3)

    await reverseAndPruneDeltaRows(set, ctx)
    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('drops a strip on a delete the same reversal prunes', async () => {
    await act('act_pass', passHappening('hap_p'))
    await act('act_pass', passInvolvement('hinv_p', 'hap_p', 'char_x'))
    await act('act_del', deleteHappening('hap_p'))
    const [holder] = await deltasOf('act_del')

    const plan = await planFor(await deltasOf('act_pass'))

    expect(plan.ops.filter(isPayloadWrite)).toEqual([])
    expect(plan.pruneOps).toHaveLength(3)
    expect(plan.pruneOps.some((op) => op.params.includes(holder.id))).toBe(true)
  })

  it('composes an older undo onto a child the delete in the set restores', async () => {
    await seedMentorPair(null, 'mentor')
    await act('act_pass', passView('char_x', 'char_y', 'rival'))
    await act('act_user', {
      kind: 'upsertCharacterRelationship',
      source: 'user_edit',
      payload: {
        branchId: 'b1',
        subjectId: 'char_x',
        objectId: 'char_y',
        kind: 'rival',
        inverseKind: null,
      },
    })
    await act('act_del', deleteEntity('char_x'))
    const target = [...(await deltasOf('act_del')), ...(await deltasOf('act_pass'))]

    // The delete restores rel_1 as rival/null; the older pass undo then nulls `kind` on that
    // restored row, leaving no view, so the row is deleted rather than updated into the CHECK.
    await reverseAndPruneDeltaRows(await selectReversalSet(ctx, { branchId: 'b1', target }), ctx)

    expect(
      await ctx.db.select({ id: entities.id }).from(entities).where(eq(entities.id, 'char_x')),
    ).toEqual([{ id: 'char_x' }])
    expect(await ctx.db.select().from(characterRelationships)).toEqual([])
  })

  it("prunes the own delete of a child the closure takes through that delete's payload", async () => {
    await ctx.db
      .insert(happenings)
      .values({ id: 'hap_run', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 })
    const gone = {
      id: 'hinv_gone',
      branchId: 'b1',
      happeningId: 'hap_run',
      entityId: 'char_x',
      role: null,
    }
    await ctx.db.insert(deltas).values([
      raw('d_create', 1, { targetTable: 'happenings', targetId: 'hap_run' }),
      raw('d_gone_create', 2, {
        actionId: 'act_user',
        source: 'user_edit',
        targetTable: 'happening_involvements',
        targetId: 'hinv_gone',
      }),
      raw('d_gone_delete', 3, {
        actionId: 'act_user2',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'happening_involvements',
        targetId: 'hinv_gone',
        undoPayload: gone,
      }),
    ])

    expect(await reverseReplayDeltas('act_run', ctx)).toBe(2)

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await ctx.db.select().from(happeningInvolvements)).toEqual([])
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })
})

describe('the write-back refusal', () => {
  // Unreachable through the actions: the pass's create is reversed while a delete holds its
  // row, and that delete's group carries a state write naming it.
  async function seedWriteBack(): Promise<void> {
    await act('act_pass', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character('char_p') },
    })
    const [row] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_p'))
    await ctx.db.delete(entities).where(eq(entities.id, 'char_p'))
    await ctx.db.insert(deltas).values([
      raw('d_state', 2, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'update',
        targetTable: 'entities',
        targetId: 'char_x',
        undoPayload: { state: { faction_id: 'char_p' } },
      }),
      raw('d_del', 3, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_p',
        undoPayload: {
          ...row,
          involvements: [],
          awareness: [],
          relationships: [],
          translations: [],
        },
      }),
    ])
  }

  async function expectRefusedUnwritten(reverse: () => Promise<number>): Promise<void> {
    const before = {
      deltas: await ctx.db.select().from(deltas),
      entities: await ctx.db.select().from(entities),
    }

    const error: unknown = await reverse().catch((e: unknown) => e)

    // Unwrapped: a DeltaReplayError wrapper would hide the refusal kind.
    expect(error).toBeInstanceOf(ReversalIntegrityError)
    expect(error).toMatchObject({ refusal: 'write-back', committed: false })
    expect((error as Error).message).toContain('d_state')
    expect(await ctx.db.select().from(deltas)).toEqual(before.deltas)
    expect(await ctx.db.select().from(entities)).toEqual(before.entities)
  }

  it('refuses to prune a delete whose group would write the removed id back, writing nothing', async () => {
    await seedWriteBack()
    await expectRefusedUnwritten(() => reverseReplayDeltas('act_pass', ctx))
  })

  it("reads a group-mate's payload as this reversal leaves it, not as stored", async () => {
    // One action deletes char_y, capturing a relationship naming char_p, then char_p; the
    // reversal strips that relationship from char_y's delete, so nothing left names char_p.
    await act('act_pass', {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: { entry: character('char_p') },
    })
    await act('act_pass', passView('char_p', 'char_y', 'rival'))
    const [p] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_p'))
    const [y] = await ctx.db.select().from(entities).where(eq(entities.id, 'char_y'))
    const [rel] = await ctx.db.select().from(characterRelationships)
    await ctx.db.delete(characterRelationships)
    await ctx.db.delete(entities).where(eq(entities.id, 'char_p'))
    await ctx.db.delete(entities).where(eq(entities.id, 'char_y'))
    const captured = { involvements: [], awareness: [], translations: [] }
    await ctx.db.insert(deltas).values([
      raw('d_del_y', 10, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_y',
        undoPayload: { ...y, ...captured, relationships: [rel] },
      }),
      raw('d_del_p', 11, {
        actionId: 'act_del',
        source: 'user_edit',
        op: 'delete',
        targetTable: 'entities',
        targetId: 'char_p',
        undoPayload: { ...p, ...captured, relationships: [] },
      }),
    ])

    expect(await reverseReplayDeltas('act_pass', ctx)).toBe(2)

    expect((await payloadOf('act_del')).relationships).toEqual([])
    expect(await ctx.db.select({ id: deltas.id }).from(deltas)).toEqual([{ id: 'd_del_y' }])
  })

  it('reaches a caller of the closed-set reversal unwrapped too', async () => {
    await seedWriteBack()
    const set = await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf('act_pass') })
    await expectRefusedUnwritten(() => reverseAndPruneDeltaRows(set, ctx))
  })
})
