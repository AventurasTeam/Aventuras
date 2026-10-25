import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, deltas, stories, type ClassifierStatus } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { readHeldClassifierStoryIds, resetStuckClassifierRunState } from './deps'

async function seed(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  branchId: string,
  classifierStatus: ClassifierStatus | null,
) {
  await db.insert(branches).values({
    id: branchId,
    storyId: 's1',
    name: branchId,
    createdAt: 1,
    classifierStatus,
  })
}

async function seedDelta(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  branchId: string,
  actionId: string,
  logPosition = 1,
) {
  await db.insert(deltas).values({
    id: `d_${branchId}_${actionId}`,
    branchId,
    entryId: null,
    actionId,
    logPosition,
    source: 'ai_classifier',
    targetTable: 'happenings',
    targetId: 'hap_1',
    op: 'create',
    undoPayload: null,
    encodingVersion: 1,
    createdAt: 1,
  })
}

async function readStatus(
  db: Awaited<ReturnType<typeof createTestDb>>['db'],
  branchId: string,
): Promise<ClassifierStatus | null> {
  const [row] = await db
    .select({ classifierStatus: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, branchId))
  return row?.classifierStatus ?? null
}

describe('resetStuckClassifierRunState', () => {
  it('resets a running branch to idle, leaving every other key byte-identical', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: 111,
      lastError: null,
      processedThrough: 7,
    }
    await seed(db, 'b1', running)

    await resetStuckClassifierRunState({ db, runInTransaction }, [])

    expect(await readStatus(db, 'b1')).toEqual({ ...running, state: 'idle' })
  })

  // classifier.md → Failure policy: a failed branch's next Send runs the pass; boot resets nothing.
  it('leaves a failed branch completely alone', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const failed: ClassifierStatus = {
      state: 'failed',
      lastSuccessAt: null,
      lastError: 'boom',
      processedThrough: 3,
    }
    await seed(db, 'b-failed', failed)

    await resetStuckClassifierRunState({ db, runInTransaction }, [])

    expect(await readStatus(db, 'b-failed')).toEqual(failed)
  })

  it('leaves a branch with no classifier_status (NULL) untouched', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await seed(db, 'b-null', null)

    await resetStuckClassifierRunState({ db, runInTransaction }, [])

    expect(await readStatus(db, 'b-null')).toBeNull()
  })

  it("leaves a branch holding the pass's unreversed orphan running, reconciling its peers", async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 4,
    }
    await seed(db, 'b-hazard', running)
    await seed(db, 'b-clean', running)
    await seedDelta(db, 'b-hazard', 'act_failed')
    // A second branch's orphan that DID reverse: its id is absent from the argument,
    // so its surviving deltas must not quarantine it.
    await seedDelta(db, 'b-clean', 'act_reversed')

    await resetStuckClassifierRunState({ db, runInTransaction }, [
      { kind: PERIODIC_CLASSIFIER_KIND, actionId: 'act_failed' },
    ])

    expect(await readStatus(db, 'b-hazard')).toEqual(running)
    expect(await readStatus(db, 'b-clean')).toEqual({ ...running, state: 'idle' })
  })

  // generation-pipeline.md → Recovery-failure policy: only a pass's failure promises a stop.
  it("frees a branch whose only surviving orphan is another kind's", async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 4,
    }
    await seed(db, 'b1', running)
    await seedDelta(db, 'b1', 'act_turn')

    await resetStuckClassifierRunState({ db, runInTransaction }, [
      { kind: 'per-turn', actionId: 'act_turn' },
    ])

    expect(await readStatus(db, 'b1')).toEqual({ ...running, state: 'idle' })
  })

  it("holds a branch carrying both a turn's and the pass's surviving orphans", async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 4,
    }
    await seed(db, 'b1', running)
    await seedDelta(db, 'b1', 'act_turn', 1)
    await seedDelta(db, 'b1', 'act_pass', 2)

    await resetStuckClassifierRunState({ db, runInTransaction }, [
      { kind: 'per-turn', actionId: 'act_turn' },
      { kind: PERIODIC_CLASSIFIER_KIND, actionId: 'act_pass' },
    ])

    expect(await readStatus(db, 'b1')).toEqual(running)
  })

  it('reconciles a failed orphan that left no deltas behind', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 4,
    }
    await seed(db, 'b1', running)

    await resetStuckClassifierRunState({ db, runInTransaction }, [
      { kind: PERIODIC_CLASSIFIER_KIND, actionId: 'act_no_deltas' },
    ])

    expect(await readStatus(db, 'b1')).toEqual({ ...running, state: 'idle' })
  })

  it('leaves an idle branch alone (no-op, not just a matching outcome)', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const idle: ClassifierStatus = {
      state: 'idle',
      lastSuccessAt: 42,
      lastError: null,
      processedThrough: 5,
    }
    await seed(db, 'b-idle', idle)

    await resetStuckClassifierRunState({ db, runInTransaction }, [])

    expect(await readStatus(db, 'b-idle')).toEqual(idle)
  })
})

describe('readHeldClassifierStoryIds', () => {
  it('lists a story once, however many of its branches are running', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const running: ClassifierStatus = {
      state: 'running',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: 0,
    }
    await seed(db, 'b1', running)
    await seed(db, 'b2', running)
    await seed(db, 'b-idle', { ...running, state: 'idle' })

    expect(await readHeldClassifierStoryIds({ db, runInTransaction })).toEqual(['s1'])
  })
})
