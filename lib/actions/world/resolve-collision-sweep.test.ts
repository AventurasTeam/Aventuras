import { eq, ne } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  stories,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import {
  characterRelationshipsStore,
  entitiesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
  resetAllStores,
} from '@/lib/stores'

import { resolveCollision } from './resolve-collision'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetBranchWriteLocks } from '../delta/branch-write-lock'
import { prepareUndo } from '../delta/redo'
import { selectReversalSet } from '../delta/row-closure'
import { rollbackToEntry, updateStoryEntryContent } from '../story-entries/operational'
import type { DbCtx, PipelineAction } from '../types'

// generation-pipeline.md and world.md → Reversibility: the merge's link copies are user creates, so
// a prose-edit sweep of the pass behind the originals keeps them, unless they name a row it created.

let ctx: DbCtx

function character(id: string, createdAt: number, flagged: 0 | 1): NewEntity {
  return {
    id,
    branchId: 'b1',
    kind: 'character',
    name: 'Brannoc',
    status: 'active',
    injectionMode: 'auto',
    state: emptyEntityState('character'),
    embeddingStale: 0,
    nameCollisionFlag: flagged,
    createdAt,
    updatedAt: createdAt,
  }
}

async function apply(action: PipelineAction, actionId: string, entryId?: string): Promise<void> {
  const result = await applyDeltaAction({ action, actionId, branchId: 'b1', entryId }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

const entry = (id: string, position: number, kind: 'user_action' | 'ai_reply'): PipelineAction => ({
  kind: 'createStoryEntry',
  source: 'user_edit',
  payload: {
    entry: { id, branchId: 'b1', position, kind, content: `${id} prose`, createdAt: position },
  },
})

const HAPPENING = { id: 'hap_h', branchId: 'b1', title: 'Fire', createdAt: 1, updatedAt: 1 }

// The classifier pass behind the loser's links, anchored to the reply as the pipeline writes it.
async function classifierPass(createsHappening: boolean): Promise<void> {
  if (createsHappening)
    await apply(
      { kind: 'createHappening', source: 'periodic_classifier', payload: { entry: HAPPENING } },
      'act_pass_h',
      'e_reply',
    )
  await apply(
    {
      kind: 'upsertHappeningAwareness',
      source: 'periodic_classifier',
      payload: { branchId: 'b1', characterId: 'char_b', happeningId: 'hap_h' },
    },
    'act_pass_aw',
    'e_reply',
  )
  await apply(
    {
      kind: 'createHappeningInvolvement',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id: 'hinv_b',
          branchId: 'b1',
          happeningId: 'hap_h',
          entityId: 'char_b',
          role: 'witness',
        },
      },
    },
    'act_pass_inv',
    'e_reply',
  )
}

async function passThenMerge(createsHappening: boolean): Promise<void> {
  if (!createsHappening) await ctx.db.insert(happenings).values(HAPPENING)
  happeningsStore.hydrate('b1', await ctx.db.select().from(happenings))
  await classifierPass(createsHappening)

  expect(
    await resolveCollision(
      'b1',
      {
        mode: 'merge',
        canonicalId: 'char_a',
        loserId: 'char_b',
        fromLoser: [],
        tags: [],
        keywords: [],
      },
      ctx,
    ),
  ).toEqual({ status: 'ok' })
  expect(await linksOn('char_a')).toEqual({ awareness: ['hap_h'], involvements: ['hap_h'] })
}

async function mergeThenEditTheReply(createsHappening: boolean): Promise<void> {
  await passThenMerge(createsHappening)
  expect(await updateStoryEntryContent('b1', 'e_reply', 'rewritten', ctx)).toEqual({
    status: 'ok',
  })
}

// CTRL-Z of what is left of the merge's group after the sweep.
async function undoTheMerge(): Promise<void> {
  const left = (await ctx.db
    .select()
    .from(deltas)
    .where(ne(deltas.targetTable, 'story_entries'))) as Delta[]
  const { reverse } = await prepareUndo(
    await selectReversalSet(ctx, { branchId: 'b1', target: left }),
    ctx,
  )
  await reverse()
}

async function entityIds(): Promise<string[]> {
  return (await ctx.db.select().from(entities)).map((r) => r.id).sort()
}

async function linksOn(id: string) {
  const awareness = await ctx.db
    .select()
    .from(happeningAwareness)
    .where(eq(happeningAwareness.characterId, id))
  const involvements = await ctx.db
    .select()
    .from(happeningInvolvements)
    .where(eq(happeningInvolvements.entityId, id))
  return {
    awareness: awareness.map((r) => r.happeningId),
    involvements: involvements.map((r) => r.happeningId),
  }
}

beforeEach(async () => {
  resetAllStores()
  __resetBranchWriteLocks()
  const test = await createTestDb()
  ctx = { db: test.db, runInTransaction: test.runInTransaction }
  await ctx.db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await ctx.db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
  await ctx.db.insert(entities).values([character('char_a', 1, 0), character('char_b', 2, 1)])
  entitiesStore.hydrate('b1', (await ctx.db.select().from(entities)) as never)
  happeningAwarenessStore.hydrate('b1', [])
  happeningInvolvementsStore.hydrate('b1', [])
  characterRelationshipsStore.hydrate('b1', [])
  await apply(entry('e_action', 1, 'user_action'), 'act_e1')
  await apply(entry('e_reply', 2, 'ai_reply'), 'act_e2')
})

describe('resolveCollision — merge link copies across a prose-edit sweep', () => {
  it("keeps the canonical's copies when the swept pass only linked the loser to a standing happening", async () => {
    await mergeThenEditTheReply(false)

    expect(await linksOn('char_a')).toEqual({ awareness: ['hap_h'], involvements: ['hap_h'] })
    expect(await entityIds()).toEqual(['char_a'])

    // The sweep pruned the pass's rows from the loser's delete payload, so CTRL-Z leaves them out.
    await undoTheMerge()

    expect(await entityIds()).toEqual(['char_a', 'char_b'])
    expect(await linksOn('char_a')).toEqual({ awareness: [], involvements: [] })
    expect(await linksOn('char_b')).toEqual({ awareness: [], involvements: [] })
  })

  it('takes the copies with a happening the swept pass created', async () => {
    await mergeThenEditTheReply(true)

    expect(await ctx.db.select().from(happenings)).toEqual([])
    expect(await linksOn('char_a')).toEqual({ awareness: [], involvements: [] })
    expect(await entityIds()).toEqual(['char_a'])

    await undoTheMerge()

    expect(await entityIds()).toEqual(['char_a', 'char_b'])
    expect(await linksOn('char_b')).toEqual({ awareness: [], involvements: [] })
  })

  it('rolls the merge back with the pass, restoring the loser as it stood before both', async () => {
    await passThenMerge(false)

    expect((await rollbackToEntry('b1', 'e_reply', ctx)).status).toBe('ok')

    expect(await entityIds()).toEqual(['char_a', 'char_b'])
    expect(await linksOn('char_a')).toEqual({ awareness: [], involvements: [] })
    expect(await linksOn('char_b')).toEqual({ awareness: [], involvements: [] })
  })
})
