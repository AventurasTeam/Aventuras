// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readEntriesBefore } from '@/lib/actions'
import { branches, stories, storyEntries, type DbCtx, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { entriesStore, resetAllStores } from '@/lib/stores'

import { useLoadOlderEntries } from './use-load-older-entries'

// Wrapped, not replaced: the read runs for real over the test db, and a test can hold one open.
vi.mock('@/lib/actions', async (importOriginal) => {
  const actual = await importOriginal<{ readEntriesBefore: typeof readEntriesBefore }>()
  return { ...actual, readEntriesBefore: vi.fn(actual.readEntriesBefore) }
})

const BRANCH = 'br_main'
const OTHER = 'br_other'
const TOTAL = 200

function row(position: number, branchId = BRANCH): StoryEntry {
  return {
    id: `e${position}`,
    branchId,
    position,
    kind: 'user_action',
    content: `entry ${position}`,
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

const span = (from: number, through: number, branchId = BRANCH): StoryEntry[] =>
  Array.from({ length: through - from + 1 }, (_, i) => row(from + i, branchId))

const loadedPositions = () =>
  [...entriesStore.getEntries().values()].map((r) => r.position).sort((a, b) => a - b)

function holdNextRead(failWith?: Error) {
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  const actual = vi.mocked(readEntriesBefore).getMockImplementation()!
  vi.mocked(readEntriesBefore).mockImplementationOnce(async (...args) => {
    await gate
    if (failWith) throw failWith
    return actual(...args)
  })
  return open
}

describe('useLoadOlderEntries', () => {
  let db: DbCtx['db']
  const onBoundary = vi.fn<(hasOlder: boolean) => void>()

  const loadOlder = () =>
    renderHook(() => useLoadOlderEntries(BRANCH, db, onBoundary)).result.current

  beforeEach(async () => {
    ;({ db } = await createTestDb())
    await db.insert(stories).values({ id: 's1', title: 'S', createdAt: 0, updatedAt: 0 })
    await db.insert(branches).values([
      { id: BRANCH, storyId: 's1', name: 'Main', createdAt: 0 },
      { id: OTHER, storyId: 's1', name: 'Other', createdAt: 0 },
    ])
    await db.insert(storyEntries).values([...span(1, TOTAL), ...span(1, 60, OTHER)])

    resetAllStores()
    entriesStore.hydrate(BRANCH, span(151, TOTAL))
    onBoundary.mockReset()
    vi.mocked(readEntriesBefore).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('loads the page above the window and reports a full page as more above', async () => {
    await loadOlder()()

    expect(loadedPositions()).toEqual(span(101, TOTAL).map((r) => r.position))
    expect(onBoundary).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('reports the top once a page comes back short', async () => {
    entriesStore.hydrate(BRANCH, span(31, TOTAL))

    await loadOlder()()

    expect(loadedPositions()).toEqual(span(1, TOTAL).map((r) => r.position))
    expect(onBoundary).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('reads again from the new top when a reload shrinks the window during the read', async () => {
    entriesStore.hydrate(BRANCH, span(101, TOTAL))
    const release = holdNextRead()
    const done = loadOlder()()

    entriesStore.hydrate(BRANCH, span(151, TOTAL))
    release()
    await done

    expect(loadedPositions()).toEqual(span(101, TOTAL).map((r) => r.position))
    expect(onBoundary).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('reports the top when a jump loads the branch top during the read', async () => {
    const release = holdNextRead()
    const done = loadOlder()()

    entriesStore.insertMany(BRANCH, span(1, 150))
    release()
    await done

    expect(loadedPositions()).toEqual(span(1, TOTAL).map((r) => r.position))
    expect(onBoundary).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('drops the read when the branch leaves during it', async () => {
    const release = holdNextRead()
    const done = loadOlder()()

    entriesStore.hydrate(OTHER, span(11, 60, OTHER))
    release()
    await done

    expect(loadedPositions()).toEqual(span(11, 60).map((r) => r.position))
    expect(onBoundary).not.toHaveBeenCalled()
  })

  it('starts no second load while one is reading', async () => {
    const load = loadOlder()
    const release = holdNextRead()
    const first = load()

    await load()
    expect(readEntriesBefore).toHaveBeenCalledTimes(1)

    release()
    await first
    await load()
    expect(readEntriesBefore).toHaveBeenCalledTimes(2)
  })

  it('logs a failed read, resolves, and lets the next load run', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const load = loadOlder()
    const release = holdNextRead(new Error('boom'))
    const failed = load()
    release()

    await expect(failed).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith('reader.load_older_failed', {
      branchId: BRANCH,
      error: 'boom',
    })
    expect(onBoundary).not.toHaveBeenCalled()

    await load()
    expect(loadedPositions()).toEqual(span(101, TOTAL).map((r) => r.position))
  })
})
