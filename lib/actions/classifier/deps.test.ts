import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, stories, type ClassifierStatus } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { resetStuckClassifierRunState } from './deps'

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
      retryCount: 0,
      processedThrough: 7,
    }
    await seed(db, 'b1', running)

    await resetStuckClassifierRunState({ db, runInTransaction })

    expect(await readStatus(db, 'b1')).toEqual({ ...running, state: 'idle' })
  })

  it('leaves retrying and failed-persistent branches completely alone', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const retrying: ClassifierStatus = {
      state: 'retrying',
      lastSuccessAt: null,
      lastError: 'boom',
      retryCount: 1,
      processedThrough: 3,
    }
    const failedPersistent: ClassifierStatus = {
      state: 'failed-persistent',
      lastSuccessAt: null,
      lastError: 'boom again',
      retryCount: 3,
      processedThrough: 3,
    }
    await seed(db, 'b-retrying', retrying)
    await seed(db, 'b-failed', failedPersistent)

    await resetStuckClassifierRunState({ db, runInTransaction })

    expect(await readStatus(db, 'b-retrying')).toEqual(retrying)
    expect(await readStatus(db, 'b-failed')).toEqual(failedPersistent)
  })

  it('leaves a branch with no classifier_status (NULL) untouched', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await seed(db, 'b-null', null)

    await resetStuckClassifierRunState({ db, runInTransaction })

    expect(await readStatus(db, 'b-null')).toBeNull()
  })

  it('leaves an idle branch alone (no-op, not just a matching outcome)', async () => {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    const idle: ClassifierStatus = {
      state: 'idle',
      lastSuccessAt: 42,
      lastError: null,
      retryCount: 0,
      processedThrough: 5,
    }
    await seed(db, 'b-idle', idle)

    await resetStuckClassifierRunState({ db, runInTransaction })

    expect(await readStatus(db, 'b-idle')).toEqual(idle)
  })
})
