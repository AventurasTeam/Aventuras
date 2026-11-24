// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, stories, type DbCtx } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { currentStoryStore, resetAllStores } from '@/lib/stores'

import { branchesStore, readStoryBranches, refreshBranches, type BranchRow } from './branches'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Chain = {
  select: () => Chain
  from: () => Chain
  where: () => Chain
  orderBy: () => Promise<BranchRow[]>
}

// The read's builder chain, ending in a result the test settles.
function stubDb(result: Promise<BranchRow[]>): DbCtx['db'] {
  const chain: Chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => result,
  }
  return chain as unknown as DbCtx['db']
}

const row = (id: string): BranchRow => ({
  id,
  name: id,
  parentBranchId: null,
  forkEntryId: null,
  createdAt: 1,
})

const ids = (rows: readonly BranchRow[]) => rows.map((r) => r.id)

async function seed() {
  const { db } = await createTestDb()
  await db.insert(stories).values([
    { id: 's1', title: 'One', createdAt: 1, updatedAt: 1 },
    { id: 's2', title: 'Two', createdAt: 1, updatedAt: 1 },
  ])
  // Inserted out of the expected order; br_x, another story's, has the earliest created_at.
  await db.insert(branches).values([
    { id: 'br_b', storyId: 's1', name: 'Main', createdAt: 1 },
    { id: 'br_x', storyId: 's2', name: 'Elsewhere', createdAt: 0 },
    {
      id: 'br_c',
      storyId: 's1',
      name: 'The trap',
      parentBranchId: 'br_b',
      forkEntryId: 'e_4',
      createdAt: 2,
    },
    {
      id: 'br_a',
      storyId: 's1',
      name: 'The road',
      parentBranchId: 'br_b',
      forkEntryId: 'e_9',
      createdAt: 2,
    },
  ])
  return db
}

beforeEach(() => {
  resetAllStores()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('readStoryBranches', () => {
  it("returns one story's rows by created_at, then id, with no story open", async () => {
    const db = await seed()
    expect(currentStoryStore.getCurrentStory()).toBeNull()

    expect(await readStoryBranches(db, 's1')).toStrictEqual([
      { id: 'br_b', name: 'Main', parentBranchId: null, forkEntryId: null, createdAt: 1 },
      { id: 'br_a', name: 'The road', parentBranchId: 'br_b', forkEntryId: 'e_9', createdAt: 2 },
      { id: 'br_c', name: 'The trap', parentBranchId: 'br_b', forkEntryId: 'e_4', createdAt: 2 },
    ])
  })

  it('throws when the read fails', async () => {
    const read = deferred<BranchRow[]>()
    const pending = readStoryBranches(stubDb(read.promise), 's1')

    read.reject(new Error('boom'))

    await expect(pending).rejects.toThrow('boom')
  })

  it('types its rows read-only, since refreshBranches holds them as they are', () => {
    // Never called: the compiler is the check.
    const push = (rows: Awaited<ReturnType<typeof readStoryBranches>>) => {
      // @ts-expect-error -- the read's rows are read-only.
      rows.push(row('br_z'))
    }
    expect(push).toBeTypeOf('function')
  })
})

describe('branchesStore', () => {
  it('answers one shared empty list for a story it does not hold', () => {
    branchesStore.hydrate('s1', [row('br_b')])

    const empty = branchesStore.getBranches(null)
    expect(empty).toEqual([])
    expect(branchesStore.getBranches('s2')).toBe(empty)
    expect(branchesStore.getBranches('s3')).toBe(empty)
    expect(ids(branchesStore.getBranches('s1'))).toEqual(['br_b'])
  })

  it("re-renders with the held story's rows, and the shared empty list for another", () => {
    const { result } = renderHook(() => ({
      s1: branchesStore.useBranches('s1', (rows) => rows),
      s2: branchesStore.useBranches('s2', (rows) => rows),
    }))
    expect(result.current.s1).toEqual([])

    act(() => branchesStore.hydrate('s1', [row('br_b')]))
    expect(ids(result.current.s1)).toEqual(['br_b'])
    expect(result.current.s2).toBe(branchesStore.getBranches(null))

    act(() => branchesStore.hydrate('s2', [row('br_x')]))
    expect(result.current.s1).toBe(branchesStore.getBranches(null))
    expect(ids(result.current.s2)).toEqual(['br_x'])
  })

  it('empties on resetAllStores', () => {
    branchesStore.hydrate('s1', [row('br_b')])

    resetAllStores()

    expect(branchesStore.getBranches('s1')).toEqual([])
  })
})

describe('refreshBranches', () => {
  it('reads the story and replaces the one held', async () => {
    const db = await seed()
    branchesStore.hydrate('s1', [row('br_b')])

    await refreshBranches(db, 's2')

    expect(branchesStore.getBranches('s1')).toEqual([])
    expect(ids(branchesStore.getBranches('s2'))).toEqual(['br_x'])
  })

  it('drops a result that lands after a newer refresh has landed', async () => {
    const older = deferred<BranchRow[]>()
    const newer = deferred<BranchRow[]>()
    const first = refreshBranches(stubDb(older.promise), 's1')
    const second = refreshBranches(stubDb(newer.promise), 's1')

    newer.resolve([row('br_new')])
    await second
    older.resolve([row('br_old')])
    await first

    expect(ids(branchesStore.getBranches('s1'))).toEqual(['br_new'])
  })

  it('drops a result that lands while a newer refresh is still reading', async () => {
    const older = deferred<BranchRow[]>()
    const newer = deferred<BranchRow[]>()
    const first = refreshBranches(stubDb(older.promise), 's1')
    const second = refreshBranches(stubDb(newer.promise), 's1')

    older.resolve([row('br_old')])
    await first
    expect(branchesStore.getBranches('s1')).toEqual([])

    newer.resolve([row('br_new')])
    await second
    expect(ids(branchesStore.getBranches('s1'))).toEqual(['br_new'])
  })

  it('drops a refresh that was reading when the stores reset', async () => {
    const stale = deferred<BranchRow[]>()
    const fresh = deferred<BranchRow[]>()
    const first = refreshBranches(stubDb(stale.promise), 's1')
    resetAllStores()
    const second = refreshBranches(stubDb(fresh.promise), 's1')

    stale.resolve([row('br_old')])
    await first
    expect(branchesStore.getBranches('s1')).toEqual([])

    fresh.resolve([row('br_new')])
    await second
    expect(ids(branchesStore.getBranches('s1'))).toEqual(['br_new'])
  })

  it('drops a refresh still reading at a reset when no refresh starts after it', async () => {
    const read = deferred<BranchRow[]>()
    const pending = refreshBranches(stubDb(read.promise), 's1')
    resetAllStores()

    read.resolve([row('br_old')])
    await pending

    expect(branchesStore.getBranches('s1')).toEqual([])
  })

  it('resolves, warns and keeps the last rows when its read throws', async () => {
    const warn = vi.spyOn(logger, 'warn')
    branchesStore.hydrate('s1', [row('br_b')])
    const held = branchesStore.getBranches('s1')
    const read = deferred<BranchRow[]>()
    const refresh = refreshBranches(stubDb(read.promise), 's1')

    read.reject(new Error('disk gone'))

    await expect(refresh).resolves.toBeUndefined()
    expect(branchesStore.getBranches('s1')).toBe(held)
    expect(warn).toHaveBeenCalledWith('app.branches_refresh_failed', {
      storyId: 's1',
      error: 'disk gone',
    })
  })
})
