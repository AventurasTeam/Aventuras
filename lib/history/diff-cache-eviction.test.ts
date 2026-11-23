import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { applyDeltaAction, undoLastAction, type PipelineAction } from '@/lib/actions'
import {
  branches,
  deltas,
  stories,
  type CharacterState,
  type Delta,
  type NewEntity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { __setDiffCacheDbForTest, diffCache } from '@/lib/history'
import { entitiesStore, entriesStore, resetAllStores, undoRedoStore } from '@/lib/stores'

// The cache as History's host imports it: nothing here registers with the action layer's hook.

const BRANCH = 'b1'

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
  branchId: BRANCH,
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

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: BRANCH, storyId: 's1', name: 'm', createdAt: 1 })
  entitiesStore.hydrate(BRANCH, [])
  entriesStore.hydrate(BRANCH, [])
  undoRedoStore.clear(BRANCH)
  __setDiffCacheDbForTest(db)
  return { db, runInTransaction }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function apply(ctx: Ctx, action: PipelineAction, actionId: string) {
  const result = await applyDeltaAction({ action, actionId, branchId: BRANCH }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function kaelUpdateOf(ctx: Ctx, actionId: string): Promise<Delta> {
  const rows = (await ctx.db
    .select()
    .from(deltas)
    .where(
      and(
        eq(deltas.branchId, BRANCH),
        eq(deltas.actionId, actionId),
        eq(deltas.targetId, 'char_kael'),
      ),
    )) as Delta[]
  expect(rows.map((row) => row.op)).toEqual(['update'])
  return rows[0]
}

async function walkedValues(delta: Delta) {
  const outcome = await diffCache.populate(delta)
  if (outcome.kind !== 'entry') throw new Error(`expected an entry, got ${outcome.kind}`)
  return { old: outcome.entry.old, new: outcome.entry.new }
}

afterEach(() => {
  diffCache.evictBranch(BRANCH)
  __setDiffCacheDbForTest(null)
  resetAllStores()
  undoRedoStore.clear(BRANCH)
})

describe('the app diff cache, as the History barrel registers it', () => {
  it("drops a survivor's entry on a shipped CTRL-Z, and the next populate walks its rewritten old", async () => {
    const ctx = await setup()
    await apply(
      ctx,
      { kind: 'createEntity', source: 'user_edit', payload: { entry: KAEL } },
      'act_0',
    )
    await apply(
      ctx,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: BRANCH,
          id: 'char_kael',
          patch: { keywords: ['the knight', 'ser kael'] },
        },
      },
      'act_u',
    )
    await apply(
      ctx,
      {
        kind: 'appendEntityKeywords',
        source: 'periodic_classifier',
        payload: {
          branchId: BRANCH,
          id: 'char_kael',
          keywords: ['the wanderer'],
          proseEntryId: null,
        },
      },
      'act_pass',
    )
    const survivor = await kaelUpdateOf(ctx, 'act_pass')

    expect(await walkedValues(survivor)).toEqual({
      old: { keywords: ['the knight', 'ser kael'] },
      new: { keywords: ['the knight', 'ser kael', 'the wanderer'] },
    })
    expect(diffCache.peek(BRANCH, survivor.id)?.old, 'the walk cached the entry').toEqual({
      keywords: ['the knight', 'ser kael'],
    })

    expect(await undoLastAction(BRANCH, ctx)).toEqual({ status: 'ok' })

    expect(diffCache.peek(BRANCH, survivor.id), 'the undo evicted the branch').toBeUndefined()
    const rewritten = await kaelUpdateOf(ctx, 'act_pass')
    expect(rewritten.id).toBe(survivor.id)
    expect(await walkedValues(rewritten)).toEqual({
      old: { keywords: ['the knight'] },
      new: { keywords: ['the knight', 'the wanderer'] },
    })
  })
})
