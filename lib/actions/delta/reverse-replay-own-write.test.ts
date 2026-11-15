import { and, asc, desc, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import {
  branches,
  chapters,
  deltas,
  entities,
  happeningAwareness,
  happenings,
  stories,
  type CharacterState,
  type Delta,
  type NewChapter,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, entriesStore, undoRedoStore } from '@/lib/stores'

import { reverseRows } from './__tests__/reverse-rows'
import { applyDeltaAction } from './apply-delta-action'
import { keywordAuthors, protectedKeywordTerms } from './keyword-authors'
import { applyRedo, prepareUndo } from './redo'
import { buildReverseAndPrunePlan, reverseReplayDeltas } from './reverse-replay'
import { selectReversalSet } from './row-closure'
import { RESOLVED_PAIR_KEY } from '../entities/resolved-pair'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import type { DeltaSource, PipelineAction } from '../types'

// generation-pipeline.md → Reverse-replay, "An undo reverts only its own write".

afterEach(() => {
  entitiesStore.__reset()
  entriesStore.__reset()
})

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  entitiesStore.hydrate('b1', [])
  return { db, ctx: { db, runInTransaction } }
}

type Db = Awaited<ReturnType<typeof setup>>['db']
type Ctx = Awaited<ReturnType<typeof setup>>['ctx']

async function apply(ctx: Ctx, action: PipelineAction, actionId: string) {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1' }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function deltasOf(db: Db, ...actionIds: string[]): Promise<Delta[]> {
  const rows = (await db.select().from(deltas).orderBy(desc(deltas.logPosition))) as Delta[]
  return rows.filter((d) => actionIds.includes(d.actionId))
}

async function payloadOf(db: Db, actionId: string): Promise<Record<string, unknown> | null> {
  const [delta] = await deltasOf(db, actionId)
  return delta.undoPayload
}

const STATE: CharacterState = {
  visual: { attire: 'travel cloak' },
  traits: ['brave'],
  drives: [],
  voice: 'low and dry',
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const KAEL: NewEntity = {
  id: 'char_kael',
  branchId: 'b1',
  kind: 'character',
  name: 'Kael',
  description: 'a wandering knight',
  status: 'active',
  injectionMode: 'auto',
  keywords: ['the knight'],
  state: STATE,
  createdAt: 1,
  updatedAt: 1,
}

async function kael(db: Db) {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, 'b1'), eq(entities.id, 'char_kael')))
  return row
}

const createKael = (ctx: Ctx, over: Partial<NewEntity> = {}, source: DeltaSource = 'user_edit') =>
  apply(ctx, { kind: 'createEntity', source, payload: { entry: { ...KAEL, ...over } } }, 'act_0')

const patchKael = (source: DeltaSource, patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId: 'b1', id: 'char_kael', patch },
})

const append = (
  keywords: string[],
  source: DeltaSource = 'periodic_classifier',
): PipelineAction => ({
  kind: 'appendEntityKeywords',
  source,
  payload: { branchId: 'b1', id: 'char_kael', keywords, proseEntryId: null },
})

const setKeywords = (
  source: DeltaSource,
  add: string[],
  remove: string[] = [],
): PipelineAction => ({
  kind: 'setEntityKeywords',
  source,
  payload: { branchId: 'b1', id: 'char_kael', add, remove, proseEntryId: null },
})

const reverse = async (db: Db, ctx: Ctx, ...actionIds: string[]) =>
  reverseRows(await deltasOf(db, ...actionIds), ctx)

describe('a string list undoes term by term', () => {
  // Case 1: a reversal that spares a later-logged keyword write keeps its terms.
  it('keeps the terms of a later keyword write it spares', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, append(['the toll']), 'act_turn5')
    await apply(ctx, append(['ser kael']), 'act_turn3_pass')

    await reverse(db, ctx, 'act_turn5')

    expect((await kael(db)).keywords).toEqual(['the knight', 'ser kael'])
    expect(await payloadOf(db, 'act_turn3_pass')).toEqual({ keywords: ['the knight'] })
  })

  // Case 2: CTRL-Z of a user keyword edit under a later pass append keeps the pass's term.
  it("keeps a later pass's term over a reversed user edit", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, patchKael('user_edit', { keywords: ['the knight', 'ser kael'] }), 'act_u')
    await apply(ctx, append(['the wanderer']), 'act_pass')

    await reverseReplayDeltas('act_u', ctx)

    expect((await kael(db)).keywords).toEqual(['the knight', 'the wanderer'])
  })

  // Case 2b: CTRL-Z of a close's keyword write under a later pass append keeps the pass's term.
  it("keeps a later pass's term over a reversed close write", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx, {}, 'periodic_classifier')
    await apply(ctx, setKeywords('chapter_close', ['the oathbreaker'], ['the knight']), 'act_close')
    await apply(ctx, append(['the wanderer']), 'act_pass')

    await reverse(db, ctx, 'act_close')

    expect((await kael(db)).keywords).toEqual(['the knight', 'the wanderer'])
    expect(await payloadOf(db, 'act_pass')).toEqual({ keywords: ['the knight'] })
  })

  // The old whole-list restore credited a user's term to the pass, so a close could remove it.
  it("credits a term CTRL-Z puts back to the user who added it, so a close can't remove it", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, patchKael('user_edit', { keywords: ['the knight', 'ser kael'] }), 'act_u0')
    await apply(ctx, patchKael('user_edit', { keywords: ['the knight'] }), 'act_u1')
    await apply(ctx, append(['the wanderer']), 'act_pass')

    await reverseReplayDeltas('act_u1', ctx)

    const live = (await kael(db)).keywords
    expect(live).toEqual(['the knight', 'ser kael', 'the wanderer'])
    expect(
      Object.fromEntries(await keywordAuthors(ctx, 'b1', 'entities', 'char_kael', live)),
    ).toEqual({
      'the knight': 'user_edit',
      'ser kael': 'user_edit',
      'the wanderer': 'periodic_classifier',
    })
    expect(await protectedKeywordTerms(ctx, 'b1', 'entities', 'char_kael', live)).toContain(
      'ser kael',
    )
  })

  it('undoes a spelling-only change', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx, { keywords: ['spyglass'] })
    await apply(ctx, patchKael('periodic_classifier', { keywords: ['Spyglass'] }), 'act_spell')
    await apply(ctx, append(['the wanderer']), 'act_pass')

    await reverse(db, ctx, 'act_spell')

    expect((await kael(db)).keywords).toEqual(['spyglass', 'the wanderer'])
  })

  it('puts a removed term back at its place among the terms still present', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx, { keywords: ['a', 't', 'b'] }, 'periodic_classifier')
    await apply(ctx, setKeywords('chapter_close', [], ['t']), 'act_close')
    await apply(ctx, append(['x']), 'act_pass')

    await reverse(db, ctx, 'act_close')

    expect((await kael(db)).keywords).toEqual(['a', 't', 'b', 'x'])
    expect(await payloadOf(db, 'act_pass')).toEqual({ keywords: ['a', 't', 'b'] })
  })

  it('undoes a state list term by term, matching exactly', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(
      ctx,
      patchKael('chapter_close', { state: { ...STATE, traits: ['brave', 'oathbound'] } }),
      'act_close',
    )
    await apply(
      ctx,
      patchKael('periodic_classifier', {
        state: { ...STATE, traits: ['brave', 'oathbound', 'Weary'] },
      }),
      'act_pass',
    )

    await reverse(db, ctx, 'act_close')

    expect(((await kael(db)).state as CharacterState).traits).toEqual(['brave', 'Weary'])
    expect(await payloadOf(db, 'act_pass')).toEqual({ state: { traits: ['brave'] } })
  })

  it("undoes a chapter's keywords term by term", async () => {
    const { db, ctx } = await setup()
    const chapter: NewChapter = {
      id: 'chap_1',
      branchId: 'b1',
      sequenceNumber: 1,
      title: 'The Crossing',
      summary: 'Wren crosses at night.',
      theme: 'passage',
      keywords: ['ferry'],
      startEntryId: 'se_1',
      endEntryId: 'se_9',
      tokenCount: 100,
      closedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.insert(chapters).values(chapter)
    const keywords = (source: DeltaSource, list: string[]): PipelineAction => ({
      kind: 'updateChapter',
      source,
      payload: { branchId: 'b1', id: 'chap_1', patch: { keywords: list } },
    })
    await apply(ctx, keywords('chapter_close', ['ferry', 'night']), 'act_close')
    await apply(ctx, keywords('user_edit', ['ferry', 'night', 'Tobin']), 'act_u')

    await reverse(db, ctx, 'act_close')

    const [row] = await db.select().from(chapters).where(eq(chapters.id, 'chap_1'))
    expect(row.keywords).toEqual(['ferry', 'Tobin'])
    expect(await payloadOf(db, 'act_u')).toEqual({ keywords: ['ferry'] })
  })

  // The survivor's own change is read from the log as it stood before the reversal: re-read after
  // the newer reversed write had rewritten it into a restatement, its term would be lost.
  it("keeps a survivor's term that two reversed writes before it added and removed", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, append(['the toll']), 'act_x')
    await apply(ctx, setKeywords('periodic_classifier', [], ['the toll']), 'act_x')
    await apply(ctx, append(['the toll']), 'act_later')

    await reverse(db, ctx, 'act_x')

    expect((await kael(db)).keywords).toEqual(['the knight', 'the toll'])
    expect(await payloadOf(db, 'act_later')).toEqual({ keywords: ['the knight'] })
  })
})

describe('a field yields to a surviving later write from any source', () => {
  const withVoice = (voice: string) => ({ state: { ...STATE, voice } })

  it("keeps a later pass's value over a reversed close and gives it the close's prior", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, patchKael('chapter_close', withVoice('hoarse')), 'act_close')
    await apply(ctx, patchKael('periodic_classifier', withVoice('steady')), 'act_pass')

    await reverse(db, ctx, 'act_close')

    expect(((await kael(db)).state as CharacterState).voice).toBe('steady')
    expect(await payloadOf(db, 'act_pass')).toEqual({ state: { voice: 'low and dry' } })
  })

  // The double undo: the later write's own undo restores what preceded the reversed close.
  it("restores the value from before a reversed close on the later user edit's undo", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, patchKael('chapter_close', withVoice('hoarse')), 'act_close')
    await apply(ctx, patchKael('user_edit', withVoice('steady')), 'act_u')

    await reverse(db, ctx, 'act_close')
    await reverseReplayDeltas('act_u', ctx)

    expect(((await kael(db)).state as CharacterState).voice).toBe('low and dry')
  })

  // A payload's keys say who wrote a field: a user edit stays the user's.
  it('keeps the key of a survivor the rewrite leaves restating its field', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await apply(ctx, patchKael('periodic_classifier', { description: 'a sworn knight' }), 'act_c')
    await apply(ctx, patchKael('user_edit', { description: 'a wandering knight' }), 'act_u')

    await reverse(db, ctx, 'act_c')

    expect((await kael(db)).description).toBe('a wandering knight')
    expect(await payloadOf(db, 'act_u')).toEqual({ description: 'a wandering knight' })
  })

  // chapter-close.md → 3f: the user's answer outlives the rewrite of the flag it cleared, so the
  // re-run close doesn't ask about the pair again.
  it('keeps the meta key of a survivor whose prior flag it rewrites', async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await db.insert(entities).values({ ...KAEL, id: 'char_mira', name: 'Mira', keywords: [] })
    const duplicate: PipelineAction = {
      kind: 'raiseCollisionFlag',
      source: 'chapter_close',
      payload: {
        branchId: 'b1',
        id: 'char_kael',
        partnerId: 'char_mira',
        reason: 'duplicate',
        proseEntryId: null,
      },
    }
    await apply(ctx, duplicate, 'act_close')
    await apply(
      ctx,
      patchKael('user_edit', {
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
        nameCollisionReason: null,
      }),
      'act_u',
    )

    await reverse(db, ctx, 'act_close')

    expect(await payloadOf(db, 'act_u')).toEqual({
      nameCollisionFlag: 0,
      nameCollisionPartnerId: null,
      nameCollisionReason: null,
      [RESOLVED_PAIR_KEY]: 'char_mira',
    })
    expect(
      await applyDeltaAction({ action: duplicate, actionId: 'act_rerun', branchId: 'b1' }, ctx),
    ).toMatchObject({ status: 'rejected', reason: 'pair-resolved' })
  })

  it("keeps a close's normalized stackables in the survivor's prior when the record yields whole", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx, { state: { ...STATE, stackables: { Gold: 5, gold: 3 } } })
    await apply(
      ctx,
      {
        kind: 'updateEntityStackables',
        source: 'chapter_close',
        payload: { branchId: 'b1', id: 'char_kael', stackables: { gold: 8 } },
      },
      'act_close',
    )
    await apply(
      ctx,
      patchKael('periodic_classifier', { state: { ...STATE, stackables: { gold: 10 } } }),
      'act_pass',
    )
    const logged = await payloadOf(db, 'act_pass')

    await reverse(db, ctx, 'act_close')

    expect(((await kael(db)).state as CharacterState).stackables).toEqual({ gold: 10 })
    expect(await payloadOf(db, 'act_pass')).toEqual(logged)
  })
})

describe('retrieval_count undoes as a counter', () => {
  async function awareness(db: Db, retrievalCount: number): Promise<void> {
    await db.insert(entities).values(KAEL)
    await db
      .insert(happenings)
      .values({ id: 'hap_fire', branchId: 'b1', title: 'The fire', createdAt: 1, updatedAt: 1 })
    await db.insert(happeningAwareness).values({
      id: 'haw_kael',
      branchId: 'b1',
      characterId: 'char_kael',
      happeningId: 'hap_fire',
      retrievalCount,
    })
  }

  const count = (kind: 'bumpAwarenessRetrieval' | 'resetAwarenessRetrieval', priorCount: number) =>
    ({
      kind,
      source: kind === 'bumpAwarenessRetrieval' ? 'ai_classifier' : 'chapter_close',
      payload: { branchId: 'b1', id: 'haw_kael', priorCount },
    }) as PipelineAction

  async function retrievalCount(db: Db): Promise<number> {
    const [row] = await db
      .select({ count: happeningAwareness.retrievalCount })
      .from(happeningAwareness)
      .where(eq(happeningAwareness.id, 'haw_kael'))
    return row.count
  }

  async function countPayloads(db: Db): Promise<unknown[]> {
    const rows = await db
      .select({ payload: deltas.undoPayload })
      .from(deltas)
      .where(eq(deltas.targetId, 'haw_kael'))
      .orderBy(asc(deltas.logPosition))
    return rows.map((r) => r.payload)
  }

  // A turn past the chapter's end bumped before the close's reset landed.
  it("keeps the reset's 0 when a bump before it is rolled back", async () => {
    const { db, ctx } = await setup()
    await awareness(db, 2)
    await apply(ctx, count('bumpAwarenessRetrieval', 2), 'act_turn')
    await apply(ctx, count('resetAwarenessRetrieval', 3), 'act_close')

    await reverse(db, ctx, 'act_turn')

    expect(await retrievalCount(db)).toBe(0)
    expect(await countPayloads(db)).toEqual([{ retrievalCount: 2 }])
  })

  it("gives back the reset's prior count plus the bumps after it", async () => {
    const { db, ctx } = await setup()
    await awareness(db, 5)
    await apply(ctx, count('resetAwarenessRetrieval', 5), 'act_close')
    await apply(ctx, count('bumpAwarenessRetrieval', 0), 'act_t1')
    await apply(ctx, count('bumpAwarenessRetrieval', 1), 'act_t2')

    await reverse(db, ctx, 'act_close')

    expect(await retrievalCount(db)).toBe(7)
    expect(await countPayloads(db)).toEqual([{ retrievalCount: 5 }, { retrievalCount: 6 }])
  })

  it('subtracts only its own bump under a later bump', async () => {
    const { db, ctx } = await setup()
    await awareness(db, 2)
    await apply(ctx, count('bumpAwarenessRetrieval', 2), 'act_t1')
    await apply(ctx, count('bumpAwarenessRetrieval', 3), 'act_t2')

    await reverse(db, ctx, 'act_t1')

    expect(await retrievalCount(db)).toBe(3)
    expect(await countPayloads(db)).toEqual([{ retrievalCount: 2 }])
  })

  // Q5: a chain whole-value undos broke can ask for a count below zero.
  it('never takes a count below 0', async () => {
    const { db, ctx } = await setup()
    await awareness(db, 0)
    await apply(ctx, count('bumpAwarenessRetrieval', 0), 'act_t1')
    await db.update(happeningAwareness).set({ retrievalCount: 5 })
    await apply(ctx, count('bumpAwarenessRetrieval', 5), 'act_t2')
    await db.update(happeningAwareness).set({ retrievalCount: 1 })
    await apply(ctx, count('bumpAwarenessRetrieval', 1), 'act_t3')

    await reverse(db, ctx, 'act_t1')

    expect(await retrievalCount(db)).toBe(0)
    expect(await countPayloads(db)).toEqual([{ retrievalCount: 0 }, { retrievalCount: 0 }])
  })

  it('makes no other field yield', async () => {
    const { db, ctx } = await setup()
    await awareness(db, 1)
    await apply(
      ctx,
      {
        kind: 'upsertHappeningAwareness',
        source: 'periodic_classifier',
        payload: {
          branchId: 'b1',
          characterId: 'char_kael',
          happeningId: 'hap_fire',
          decayResistance: 0.9,
          proseEntryId: null,
        },
      },
      'act_pass',
    )
    await apply(ctx, count('bumpAwarenessRetrieval', 1), 'act_turn')

    await reverse(db, ctx, 'act_pass')

    const [row] = await db.select().from(happeningAwareness)
    expect(row).toMatchObject({ decayResistance: null, retrievalCount: 2 })
  })
})

describe('a survivor rewrite', () => {
  // The undo of the Mira view leaves the pair keeping no view, so the later write to Kael's view,
  // which ends the walk for the view it shares with the reversal, goes with the row.
  it('rewrites no survivor the reversal prunes with a row it leaves absent', async () => {
    const { db, ctx } = await setup()
    await db.insert(entities).values([KAEL, { ...KAEL, id: 'char_mira', name: 'Mira' }])
    const view = (subjectId: string, objectId: string, kind: string | null): PipelineAction => ({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', subjectId, objectId, kind, proseEntryId: null },
    })
    await apply(
      ctx,
      {
        kind: 'upsertCharacterRelationship',
        source: 'user_edit',
        payload: {
          branchId: 'b1',
          subjectId: 'char_kael',
          objectId: 'char_mira',
          kind: 'friend',
          inverseKind: null,
        },
      },
      'act_0',
    )
    await apply(ctx, view('char_mira', 'char_kael', 'wary'), 'act_c')
    await apply(ctx, view('char_kael', 'char_mira', 'ally'), 'act_c')
    await apply(ctx, view('char_kael', 'char_mira', null), 'act_x')
    const [later] = await deltasOf(db, 'act_x')

    const plan = await buildReverseAndPrunePlan(
      await selectReversalSet(ctx, { branchId: 'b1', target: await deltasOf(db, 'act_c') }),
      ctx,
      { keepRedoExact: false },
    )

    expect(plan.pruneOps.length, 'the pair goes, and its writes outside the set with it').toBe(4)
    expect(plan.survivorRewrites.map((r) => r.delta.id)).not.toContain(later.id)
  })
})

describe('redo after a survivor rewrite', () => {
  async function snapshot(db: Db) {
    return {
      rows: await db.select().from(entities).orderBy(asc(entities.id)),
      log: await db.select().from(deltas).orderBy(asc(deltas.logPosition)),
    }
  }

  it('leaves the database as it was, delta payloads included', async () => {
    const { db, ctx } = await setup()
    entriesStore.hydrate('b1', [])
    undoRedoStore.clear()
    await createKael(ctx)
    await apply(ctx, patchKael('user_edit', { keywords: ['the knight', 'ser kael'] }), 'act_u')
    await apply(ctx, append(['the wanderer']), 'act_pass')
    const before = await snapshot(db)

    expect(await undoLastAction('b1', ctx)).toEqual({ status: 'ok' })
    expect((await kael(db)).keywords).toEqual(['the knight', 'the wanderer'])
    expect(await payloadOf(db, 'act_pass')).toEqual({ keywords: ['the knight'] })
    expect(await redoLastAction('b1', ctx)).toEqual({ status: 'ok' })

    expect(await snapshot(db)).toEqual(before)
  })

  // Q7: redo leaves a sweep's row to re-derive, so a survivor there keeps the undo's rewrite.
  it("keeps the rewrite of a survivor on a row only the sweep's reversal reached", async () => {
    const { db, ctx } = await setup()
    await createKael(ctx)
    await db.insert(entities).values({ ...KAEL, id: 'char_mira', name: 'Mira', keywords: ['m'] })
    await apply(ctx, patchKael('user_edit', { description: 'a sworn knight' }), 'act_u')
    const mira = (keywords: string[]): PipelineAction => ({
      kind: 'appendEntityKeywords',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', id: 'char_mira', keywords, proseEntryId: null },
    })
    await apply(ctx, mira(['the swept']), 'act_swept')
    await apply(ctx, mira(['the later']), 'act_later')
    const set = await selectReversalSet(ctx, {
      branchId: 'b1',
      target: await deltasOf(db, 'act_u'),
      sweep: await deltasOf(db, 'act_swept'),
    })
    const { group, reverse: undo } = await prepareUndo(set, ctx)

    await undo()
    await applyRedo(group, ctx)

    expect(group.survivorPayloads).toEqual([])
    expect(await payloadOf(db, 'act_later')).toEqual({ keywords: ['m'] })
  })
})
